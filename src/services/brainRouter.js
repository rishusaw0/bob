// Gemini-only router and lightweight conversation-history compactor
import { isTextOrDocAttachment } from './docExtractor.js';


/**
 * Classifies requests for UI metadata. The App executes only explicitly supported deterministic PC actions offline;
 * every other online AI response is sent to Gemini.
 */
export function classifyQueryKind(cleanText, attachment = null) {
  const lower = String(cleanText || '').trim().toLowerCase();

  if (attachment && !isTextOrDocAttachment(attachment)) {
    return { queryKind: 'cloud_vision', isPcCommand: false, heavyReason: 'multimodal_attachment' };
  }
  if (
    /\b(generate image|create image|draw a|make a picture|photo banao|image banao)\b/i.test(lower) ||
    /^\/image\b/i.test(lower)
  ) {
    return { queryKind: 'cloud_vision', isPcCommand: false, heavyReason: 'image_generation' };
  }
  if (
    /\b(screenshot le lo aur|analyze screenshot|vision inspect|is photo mein|look at this screenshot)\b/i.test(lower)
  ) {
    return { queryKind: 'cloud_vision', isPcCommand: false, heavyReason: 'vision_screen_task' };
  }

  if (attachment && isTextOrDocAttachment(attachment)) {
    return { queryKind: 'document_local', isPcCommand: false, heavyReason: '' };
  }

  const looksLikeOpenOrPlay = /\b(open|kholo|chalao|play|bajao|lagao|youtube|spotify)\b/i.test(lower);
  if (
    /\b(weather|mausam|latest news|live score|cricket score|stock price today|current price|google search|search online|deep research)\b/i.test(
      lower
    ) ||
    (/https?:\/\//i.test(lower) && !looksLikeOpenOrPlay)
  ) {
    return { queryKind: 'cloud_web_heavy', isPcCommand: false, heavyReason: 'live_web_knowledge' };
  }

  if (
    cleanText.includes('```') ||
    cleanText.length > 600 ||
    /\b(write full app|full project|architecture design|refactor entire|multi-file|leetcode|algorithm proof)\b/i.test(lower)
  ) {
    return { queryKind: 'cloud_web_heavy', isPcCommand: false, heavyReason: 'heavy_coding_or_reasoning' };
  }

  const isQuestionPhrase =
    /\b(kya hota|what is|why|kyun|how does|kaise kaam|explain|samjhao|difference between|compare|meaning of|history of|who is|kaun hai)\b/i.test(
      lower
    );

  const pcActionVerbOrTarget =
    /\b(open|launch|start|close|quit|exit|kholo|chalao|bajao|lagao|band karo|volume|brightness|awaz|roshni|mute|unmute|wifi|bluetooth|dark mode|light mode|theme|screenshot|screen padh|screen read|read screen|click\b|scroll|copy karo|paste karo|save karo|undo karo|select all|press enter|enter dabao|type\b|likho|reminder|remind|yaad dilana|yaad dilao|timer|alarm|baje|downloads|desktop|documents|organize|clean temp|temp saaf|installed app|installed software|install\b|uninstall\b|winget|lock pc|sleep pc|restart pc|shutdown|maximize|minimize|snap left|snap right|running apps|clipboard|battery|ram status|cpu status|top process|pc health|system health|new tab|close tab|next tab|previous tab|incognito|skip ad|coding mode|night mode|kal maine kya|yaad rakho|remember that|settings kholo|vs code|vscode|github|git status|git log|git pull|git push|youtube)\b/i.test(
      lower
    ) ||
    /\.(pdf|docx|pptx|xlsx|txt|md)\b/i.test(lower) ||
    /स्क्रीन|वॉल्यूम|ब्राइटनेस|बैटरी|वाईफाई|क्लिक/i.test(cleanText);

  if (pcActionVerbOrTarget && !isQuestionPhrase) {
    return { queryKind: 'pc_command', isPcCommand: true, heavyReason: '' };
  }

  return { queryKind: 'general_qa', isPcCommand: false, heavyReason: '' };
}

/**
 * Removes legacy route prefixes and routes every online AI request to Gemini.
 */
export function assessQueryRouting(text, attachment = null, _mode = 'cloud', env = {}) {
  let cleanText = String(text || '').trim();
  cleanText = cleanText.replace(/^(?:@cloud|@gemini|\/cloud|\/gemini|@local|\/local)\b[:\s]*/i, '').trim();
  const online =
    typeof env.online === 'boolean'
      ? env.online
      : typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
        ? navigator.onLine
        : true;
  const effectiveText = cleanText || String(text || '').trim();
  const classification = classifyQueryKind(effectiveText, attachment);
  const { queryKind, isPcCommand, heavyReason } = classification;

  return {
    cleanText: effectiveText,
    mode: online ? 'cloud' : 'offline',
    online,
    batteryLow: Boolean(env.batteryLow),
    freeRamLow: false,
    queryKind,
    isPcCommand,
    strictNoApi: false,
    forceCloud: online,
    forceLocal: false,
    heavyReason,
    routeReason: online
      ? 'Gemini 3.5 Flash-Lite handles all AI replies'
      : 'Offline mode: deterministic PC utilities only; Gemini AI unavailable',
    shouldTryLocalFirst: false,
  };
}

/**
 * Local Context Compactor: summarizes older chat messages cleanly in 0ms before escalating to Gemini Cloud,
 * trimming token cost by ~60% on long threads.
 */
export function compactHistoryForCloud(messages = [], maxRecent = 4) {
  if (!Array.isArray(messages) || messages.length <= maxRecent) return '';
  const older = messages.slice(0, messages.length - maxRecent).filter((m) => m && m.text && !m.isError);
  if (older.length === 0) return '';

  const bullets = older.slice(-8).map((m) => {
    const speaker = m.role === 'user' ? 'User' : 'JEEVA';
    const compact = String(m.text).replace(/\s+/g, ' ').trim().slice(0, 120);
    return `- ${speaker}: ${compact}${m.text.length > 120 ? '...' : ''}`;
  });
  return `CONVERSATION CONTEXT DIGEST (${older.length} earlier turns compressed locally):\n${bullets.join('\n')}`;
}
