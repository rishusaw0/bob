// Deterministic Windows PC command adapter. This module does not contain or call an AI model.
import { tryFastVoiceAction, repairVoiceTranscript } from './voiceRouter.js';
import { tryLocalSlotAction } from './localSlotActions.js';
import { executeFunctionCall } from './tools.js';
import { rememberUserMemory, recallRelevantMemories } from './memoryRag.js';
import { isEpisodicHistoryQuery, parseEpisodicDateQuery } from './dateQueryParser.js';
import { queryEpisodicTimeline } from './episodicMemory.js';
import { detectCommandLanguage } from './voicePermissionPrompt.js';

function replyByLang(lang, en, hiMix, hi) {
  if (lang === 'english') return en;
  if (lang === 'hindi') return hi;
  return hiMix;
}

async function tryDirectMemoryRag(text, lang) {
  const clean = String(text || '').trim();
  const lower = clean.toLowerCase();
  const rememberMatch =
    clean.match(/^(?:yaad rakho|yaad rakhna|remember that|remember|note kar lo)\s+(?:ki\s+)?(.{4,300})$/i) ||
    clean.match(/^(?:mera naam|my name is|i am called)\s+([a-z\u0900-\u097f][a-z\u0900-\u097f\s]{1,40}?)(?:\s+hai)?$/i) ||
    clean.match(/^(?:main|i live in)\s+([a-z\u0900-\u097f][a-z\u0900-\u097f\s,]{1,45}?)(?:\s+(?:mein|me)\s+rehta\s+(?:hoon|hu|hun))?$/i);

  if (rememberMatch) {
    const isNameIntro = /\b(mera naam|my name is|i am called)\b/i.test(lower);
    const isCityIntro = /\b(i live in|rehta hoon|rehta hu|rehta hun)\b/i.test(lower);
    const rawFact = rememberMatch[1].trim();
    const fact = isNameIntro
      ? `User's name is ${rawFact}`
      : isCityIntro
        ? `User lives in ${rawFact}`
        : rawFact;
    const res = await rememberUserMemory(fact, 'preference');
    if (res?.success || res?.ok) {
      return {
        handled: true,
        tier: 'fast',
        modelLabel: 'Personal Memory',
        replyText: replyByLang(
          lang,
          `Got it — I'll remember that: "${fact}"`,
          `Samajh gaya — maine yaad rakh liya: "${fact}"`,
          `समझ गया — मैंने याद रख लिया: "${fact}"`
        ),
        tools: [{ name: 'memory_rag', status: 'done', args: { action: 'remember', content: fact } }],
      };
    }
  }

  if (
    /\b(memory|yaad kiya|remember|project path|kahan rakha|kahan hai|mera folder|my preference|mera naam|my name|kahan rehta|where do i live)\b/i.test(lower) &&
    clean.length < 110
  ) {
    const recallQuery = /\b(mera naam|my name)\b/i.test(lower)
      ? 'user name'
      : /\b(kahan rehta|where do i live)\b/i.test(lower)
        ? 'user lives in'
        : clean;
    const items = await recallRelevantMemories(recallQuery, 3);
    if (Array.isArray(items) && items.length > 0 && (items[0].score === undefined || items[0].score >= 0.16)) {
      const topList = items.map((m, idx) => `${idx + 1}. ${m.content}`).join('\n');
      return {
        handled: true,
        tier: 'fast',
        modelLabel: 'Personal Memory',
        replyText: replyByLang(
          lang,
          `Here is what I remember:\n${topList}`,
          `Mujhe yeh yaad hai:\n${topList}`,
          `मुझे यह याद है:\n${topList}`
        ),
        tools: [{ name: 'memory_rag', status: 'done', args: { action: 'recall', query: clean } }],
      };
    }
  }
  return null;
}

async function tryEpisodicHistoryRecall(text, lang) {
  const lower = String(text || '').toLowerCase();
  if (/\b(voice history|voice command history|voice commands history|maine voice se kya|voice se kya kiya|voice se kya bola)\b/i.test(lower)) {
    const rows = await queryEpisodicTimeline({ source: 'voice', limit: 8 });
    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        handled: true,
        tier: 'fast',
        modelLabel: 'Conversation Memory',
        replyText: replyByLang(lang, 'No voice commands have been recorded yet.', 'Abhi tak koi voice command history saved nahi hai.', 'अभी तक कोई वॉइस कमांड हिस्ट्री सेव नहीं है।'),
        tools: [{ name: 'episodic_recall', status: 'done', args: { source: 'voice' } }],
      };
    }
    const list = rows.map((r, i) => {
      const actions = Array.isArray(r.toolsUsed) && r.toolsUsed.length ? ` [${r.toolsUsed.map((t) => String(t).replace(/_/g, ' ')).join(', ')}]` : '';
      return `${i + 1}. [${r.dateKey} · ${r.timeLabel}] "${r.userPrompt}" → ${r.assistantReply || 'Done.'}${actions}`;
    }).join('\n');
    return {
      handled: true,
      tier: 'fast',
      modelLabel: 'Conversation Memory',
      replyText: replyByLang(lang, `Your recent voice commands:\n\n${list}`, `Aapke recent voice commands aur unke actions:\n\n${list}`, `आपके हाल के वॉइस कमांड और एक्शन:\n\n${list}`),
      tools: [{ name: 'episodic_recall', status: 'done', args: { source: 'voice' } }],
    };
  }

  if (!isEpisodicHistoryQuery(text)) return null;
  const parsed = parseEpisodicDateQuery(text);
  const rows = await queryEpisodicTimeline({
    dateKey: parsed.dateKey,
    dateFrom: parsed.dateFrom,
    dateTo: parsed.dateTo,
    weekday: parsed.weekday,
    timeOfDay: parsed.timeOfDay,
    topic: parsed.topic,
    limit: 6,
  });
  const scope = [parsed.matchedLabel, parsed.timeOfDay, parsed.topic ? `"${parsed.topic}"` : ''].filter(Boolean).join(' · ');
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      handled: true,
      tier: 'fast',
      modelLabel: 'Conversation Memory',
      replyText: replyByLang(lang, `I checked your local timeline (${scope}), and found no saved questions or commands for that period.`, `Maine aapki timeline (${scope}) check ki — is time/topic ka koi saved sawal ya command nahi mila.`, `मैंने आपकी टाइमलाइन (${scope}) देखी — उस समय का कोई सेव किया हुआ सवाल या कमांड नहीं मिला।`),
      tools: [{ name: 'episodic_recall', status: 'done', args: parsed }],
    };
  }
  const formatted = rows.slice(0, 5).map((r, i) => {
    const reply = r.assistantReply ? `\n  → JEEVA: ${r.assistantReply.slice(0, 140)}${r.assistantReply.length > 140 ? '...' : ''}` : '';
    return `${i + 1}. [${r.dateKey} (${r.weekday}) · ${r.timeLabel}] Aapne pucha: "${r.userPrompt.slice(0, 120)}"${reply}`;
  }).join('\n');
  const header = replyByLang(lang, `Here is what you asked/discussed (${scope}):`, `${scope} par aapne ye pucha aur baat ki thi:`, `${scope} पर आपने यह पूछा और बात की थी:`);
  return {
    handled: true,
    tier: 'fast',
    modelLabel: 'Conversation Memory',
    replyText: `${header}\n\n${formatted}`,
    tools: [{ name: 'episodic_recall', status: 'done', args: parsed }],
  };
}

function resolvePronounFollowUp(text, historyMessages = []) {
  const raw = String(text || '').trim();
  if (!raw || !/\b(isko|isme|is\s+mein|is\s+app|usko|usme|it|this\s+app|this\s+window)\b/i.test(raw)) return raw;
  let lastApp = '';
  for (let i = historyMessages.length - 1; i >= Math.max(0, historyMessages.length - 6); i--) {
    const msg = historyMessages[i];
    if (msg?.role !== 'assistant' || !Array.isArray(msg.tools)) continue;
    for (let j = msg.tools.length - 1; j >= 0; j--) {
      const appName = msg.tools[j]?.args?.app_name;
      if (typeof appName === 'string' && appName.trim()) { lastApp = appName.trim(); break; }
    }
    if (lastApp) break;
  }
  if (!lastApp) return raw;
  return raw
    .replace(/\b(?:isme|is\s+mein|usme)\b/gi, `${lastApp} mein`)
    .replace(/\b(?:isko|usko|is\s+app\s+ko|this\s+app|this\s+window|\bit\b)\b/gi, lastApp)
    .replace(/\s+/g, ' ')
    .trim();
}

async function tryLocalScreenReader(text, requestPermission) {
  const clean = String(text || '').trim();
  const lower = clean.toLowerCase();
  if (/\b(read screen|screen read|screen reader|screen par kya|screen pe kya|read this screen|what is on.*screen|what's on.*screen|screen padh|screen batao|screen ke buttons)\b|स्क्रीन पढ़ो|स्क्रीन पर क्या/i.test(lower)) {
    const res = await executeFunctionCall('screen_reader', { action: 'read' }, requestPermission, {
      fromVoice: false, userPrompt: clean,
    });
    if (res?.error) return { replyText: res.error, tools: [{ name: 'screen_reader', status: 'error', args: { action: 'read' } }] };
    let data = {};
    try { data = JSON.parse(res?.result || '{}'); } catch {}
    const title = data.windowTitle || 'Active Window';
    const visible = Array.isArray(data.visibleText) && data.visibleText.length ? data.visibleText : data.ocrText || [];
    const controls = Array.isArray(data.interactiveElements) ? data.interactiveElements : [];
    const snippet = visible.slice(0, 8).join('. ').slice(0, 420);
    const buttons = controls.slice(0, 10).map((c) => `${c.name} (${c.type})`).join(', ');
    return {
      replyText: `Active window: ${title}.\n\nVisible text:\n${snippet || 'No readable text detected.'}${buttons ? `\n\nClickable controls: ${buttons}` : ''}`,
      autoSpeak: true,
      tools: [{ name: 'screen_reader', status: 'done', args: { action: 'read' } }],
    };
  }
  const clickMatch =
    clean.match(/^(?:screen par|screen pe)\s+(?:click|press|tap|dabao)\s+["']?(.{2,55}?)["']?(?:\s+(?:par|pe|ko|button))?$/i) ||
    clean.match(/^(?:click|press|tap)\s+["']?(.{2,55}?)["']?\s+(?:on screen|screen par|button on screen)$/i);
  if (!clickMatch?.[1]) return null;
  const target = clickMatch[1].trim();
  const res = await executeFunctionCall('screen_reader', { action: 'click_text', target_text: target }, requestPermission, {
    fromVoice: false, userPrompt: clean,
  });
  return {
    replyText: res?.error || String(res?.result || `Clicked ${target}`),
    autoSpeak: true,
    tools: [{ name: 'screen_reader', status: res?.error ? 'error' : 'done', args: { action: 'click_text', target_text: target } }],
  };
}

export async function runPcCommand(text, { requestPermission = null, historyMessages = [] } = {}) {
  const repaired = repairVoiceTranscript(text);
  const clean = resolvePronounFollowUp(repaired, historyMessages);
  if (!clean) return { handled: false };
  const lang = detectCommandLanguage(clean);

  // Personal and episodic memory use the existing local data store, never a local language model.
  const episodic = await tryEpisodicHistoryRecall(clean, lang);
  if (episodic) return episodic;
  const memory = await tryDirectMemoryRag(clean, lang);
  if (memory) return memory;

  // These are deterministic Windows utilities only; all open-ended language responses are Gemini.
  const screen = await tryLocalScreenReader(clean, requestPermission);
  if (screen) {
    return { handled: true, tier: 'fast', modelLabel: 'Windows Screen Utility', routeReason: 'Deterministic screen utility; no local AI', ...screen };
  }

  const fastOs = await tryFastVoiceAction(clean, requestPermission);
  if (fastOs?.handled) {
    return { handled: true, tier: 'fast', modelLabel: 'Windows PC Control', routeReason: 'Deterministic PC action; no local AI', ...fastOs };
  }

  const slot = await tryLocalSlotAction(clean, 'hinglish', requestPermission);
  if (slot?.handled) {
    return { ...slot, tier: 'fast', modelLabel: slot.modelLabel || 'Windows PC Control', routeReason: 'Deterministic PC action; no local AI' };
  }

  return { handled: false };
}
