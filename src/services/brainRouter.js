// Hybrid Brain Router — Command-First Local Lock, Complexity Gatekeeper, History Compactor & Savings Telemetry
import { isTextOrDocAttachment } from './docExtractor.js';
import { getStrictLocalCommands } from './userPrefs.js';

const BRAIN_MODE_KEY = 'jeeva_brain_mode'; // 'auto' | 'offline' | 'cloud'
const BRAIN_STATS_KEY = 'jeeva_brain_stats';

function loadStats() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BRAIN_STATS_KEY) || '{}');
    return {
      localFast: Number(parsed.localFast) || 0,
      localIntent: Number(parsed.localIntent) || 0,
      localSlm: Number(parsed.localSlm) || 0,
      cloudCalls: Number(parsed.cloudCalls) || 0,
      estimatedTokensSaved: Number(parsed.estimatedTokensSaved) || 0,
    };
  } catch {
    return { localFast: 0, localIntent: 0, localSlm: 0, cloudCalls: 0, estimatedTokensSaved: 0 };
  }
}

export function getBrainMode() {
  try {
    const m = localStorage.getItem(BRAIN_MODE_KEY) || 'auto';
    return ['auto', 'offline', 'cloud'].includes(m) ? m : 'auto';
  } catch {
    return 'auto';
  }
}

export function setBrainMode(mode) {
  const clean = ['auto', 'offline', 'cloud'].includes(mode) ? mode : 'auto';
  try {
    localStorage.setItem(BRAIN_MODE_KEY, clean);
    window.dispatchEvent(new CustomEvent('jeeva-brain-mode-changed', { detail: clean }));
  } catch {}
  return clean;
}

export function getBrainStats() {
  const s = loadStats();
  const totalLocal = s.localFast + s.localIntent + s.localSlm;
  const totalAll = totalLocal + s.cloudCalls;
  const localPct = totalAll > 0 ? Math.round((totalLocal / totalAll) * 100) : 0;
  return { ...s, totalLocal, totalAll, localPct };
}

export function recordBrainUsage(tier, approxPromptChars = 120) {
  try {
    const stats = loadStats();
    const approxSaved = Math.max(350, Math.round(approxPromptChars / 3) + 650);
    if (tier === 'fast') {
      stats.localFast += 1;
      stats.estimatedTokensSaved += approxSaved;
    } else if (tier === 'intent') {
      stats.localIntent += 1;
      stats.estimatedTokensSaved += approxSaved;
    } else if (tier === 'local-slm') {
      stats.localSlm += 1;
      stats.estimatedTokensSaved += approxSaved + 450;
    } else if (tier === 'cloud') {
      stats.cloudCalls += 1;
    }
    localStorage.setItem(BRAIN_STATS_KEY, JSON.stringify(stats));
    window.dispatchEvent(new CustomEvent('jeeva-brain-stats-changed', { detail: getBrainStats() }));
  } catch {}
}

export function resetBrainStats() {
  try {
    localStorage.removeItem(BRAIN_STATS_KEY);
    window.dispatchEvent(new CustomEvent('jeeva-brain-stats-changed', { detail: getBrainStats() }));
  } catch {}
}

/**
 * Classifies prompt into PC command vs Local Document vs Cloud Vision/Web vs General Q&A
 * so PC commands stay 100% local (0 Gemini API calls) while Cloud handles visual/web/heavy tasks.
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
 * Strips explicit routing prefixes (@cloud, /gemini, @local) and determines routing constraints.
 */
export function assessQueryRouting(text, attachment = null, mode = getBrainMode(), env = {}) {
  let cleanText = String(text || '').trim();
  let forceCloud = false;
  let forceLocal = false;

  if (/^(?:@cloud|@gemini|\/cloud|\/gemini)\b/i.test(cleanText)) {
    forceCloud = true;
    cleanText = cleanText.replace(/^(?:@cloud|@gemini|\/cloud|\/gemini)\b[:\s]*/i, '').trim();
  } else if (/^(?:@local|\/local)\b/i.test(cleanText)) {
    forceLocal = true;
    cleanText = cleanText.replace(/^(?:@local|\/local)\b[:\s]*/i, '').trim();
  }

  const online =
    typeof env.online === 'boolean'
      ? env.online
      : typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
        ? navigator.onLine
        : true;
  const batteryLow = Boolean(env.batteryLow);
  const freeRamLow = Boolean(env.freeRamLow);
  const strictCommands =
    typeof env.strictLocalCommands === 'boolean' ? env.strictLocalCommands : getStrictLocalCommands();

  const effectiveText = cleanText || String(text || '').trim();
  const classification = classifyQueryKind(effectiveText, attachment);
  const { queryKind, isPcCommand, heavyReason } = classification;

  if (mode === 'cloud' && !(isPcCommand && strictCommands)) {
    forceCloud = true;
  }
  if (mode === 'offline' || (!online && mode === 'auto' && !forceCloud)) {
    forceLocal = true;
    forceCloud = false;
  }

  // PC Commands are locked to JEEVA's own Local AI unless user explicitly uses @gemini
  const strictNoApi = Boolean(isPcCommand && strictCommands && !forceCloud);
  if (strictNoApi) {
    forceLocal = true;
    forceCloud = false;
  }

  let routeReason = 'Auto Hybrid: running locally first to save API calls';
  if (strictNoApi) routeReason = 'Command-First Local Lock: executing locally (0 Gemini API calls)';
  else if (!online) routeReason = 'Auto-Switched to Local: internet offline detected';
  else if (forceCloud && mode === 'cloud') routeReason = 'Cloud Mode selected';
  else if (forceCloud) routeReason = 'Forced Cloud via @gemini tag';
  else if (heavyReason) routeReason = `Auto-Switched to Gemini: ${heavyReason.replace(/_/g, ' ')}`;
  else if (freeRamLow || batteryLow) routeReason = 'Low RAM/Battery Guard active — avoiding heavy SLM';

  return {
    cleanText: effectiveText,
    mode: !online && mode === 'auto' ? 'offline' : mode,
    online,
    batteryLow,
    freeRamLow,
    queryKind,
    isPcCommand,
    strictNoApi,
    forceCloud,
    forceLocal,
    heavyReason,
    routeReason,
    shouldTryLocalFirst: !forceCloud && (isPcCommand || ((!heavyReason && !freeRamLow) || forceLocal)),
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
