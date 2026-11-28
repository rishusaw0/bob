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
    clean.match(/^(?:yaad rakho|yaad rakhna|yad rakho|yad rakhna|remember that|remember|note kar lo|memory me save karo)\s+(?:ki\s+)?(.{4,300})$/i) ||
    clean.match(/^(.{4,260}?)\s+(?:yaad rakho|yaad rakhna|yad rakho|yad rakhna|note kar lo|memory me save karo)$/i) ||
    clean.match(/^(?:mera naam|my name is|i am called)\s+([a-z\u0900-\u097f][a-z\u0900-\u097f\s]{1,40}?)(?:\s+hai)?$/i) ||
    clean.match(/^i live in\s+([a-z\u0900-\u097f][a-z\u0900-\u097f\s,]{1,45}?)$/i) ||
    clean.match(/^main\s+([a-z\u0900-\u097f][a-z\u0900-\u097f\s,]{1,45}?)\s+(?:mein|me)\s+(?:rehta|rehti)\s+(?:hoon|hu|hun)$/i);

  if (rememberMatch) {
    const isNameIntro = /\b(mera naam|my name is|i am called)\b/i.test(lower);
    const isCityIntro = /\b(i live in|(?:rehta|rehti)\s+(?:hoon|hu|hun))\b/i.test(lower);
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

  // Direct "show my saved memory / what did I ask you to remember" handler
  if (
    /\b(meri memory|my memory|saved memory|list memory|show memory|memory dikhao|kya yaad rakha|kya yad rakha|kya yaad rakhne|kya yad rakhne|what do you remember|show my memories|list memories|my memories|my saved memories)\b/i.test(lower) &&
    clean.length < 110
  ) {
    const rawList = (await window.electronAPI?.memoryList?.().catch(() => [])) || [];
    const items = Array.isArray(rawList) && rawList.length > 0
      ? rawList.slice(0, 8).map((m) => m.content || m.fact || m.text || (m.key ? `${m.key}: ${m.value}` : String(m)))
      : (await recallRelevantMemories('', 8)).map((m) => m.content);
    if (items.length > 0) {
      const topList = items.map((txt, idx) => `${idx + 1}. ${txt}`).join('\n');
      return {
        handled: true,
        tier: 'fast',
        modelLabel: 'Personal Memory',
        replyText: replyByLang(
          lang,
          `Here is what I have saved in memory:\n${topList}`,
          `Maine memory me yeh save kar rakha hai:\n${topList}`,
          `मैंने मेमोरी में यह सेव कर रखा है:\n${topList}`
        ),
        tools: [{ name: 'memory_rag', status: 'done', args: { action: 'list' } }],
      };
    }
    return {
      handled: true,
      tier: 'fast',
      modelLabel: 'Personal Memory',
      replyText: replyByLang(
        lang,
        'No personal memories are saved yet. Say "Remember that ..." to save one.',
        'Abhi koi personal memory saved nahi hai. Kuch save karne ke liye bolo "Yaad rakhna ...".',
        'अभी कोई पर्सनल मेमोरी सेव नहीं है।'
      ),
      tools: [{ name: 'memory_rag', status: 'done', args: { action: 'list' } }],
    };
  }

  // Specific personal fact Q&A ("mera exam kab hai?", "mera wifi password kya hai?")
  if (
    /\b(mera|meri|mere|my)\b/i.test(lower) &&
    /\b(kab|kya|kahan|kaun|what|when|where|which)\b/i.test(lower) &&
    !/\b(cpu|ram|battery|storage|disk|volume|brightness|wifi status|internet|weather|time|date)\b/i.test(lower) &&
    clean.length < 95
  ) {
    const rawList = (await window.electronAPI?.memoryList?.().catch(() => [])) || [];
    const tokens = lower
      .replace(/[^a-z0-9\u0900-\u097f\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !/^(mera|meri|mere|kab|kya|kahan|kaun|hai|tha|thi|the|what|when|where|which|was|were|did|does|tell|batao)$/.test(t));
    if (Array.isArray(rawList) && rawList.length > 0 && tokens.length > 0) {
      let best = null;
      let bestHits = 0;
      for (const m of rawList) {
        const body = String(m.content || m.fact || m.text || (m.key ? `${m.key} ${m.value}` : '')).trim();
        const bl = body.toLowerCase();
        const hits = tokens.filter((t) => bl.includes(t)).length;
        if (hits > bestHits) {
          bestHits = hits;
          best = body;
        }
      }
      if (best && bestHits >= 1) {
        return {
          handled: true,
          tier: 'fast',
          modelLabel: 'Personal Memory',
          replyText: replyByLang(lang, `From your memory: ${best}`, `Aapki saved memory ke hisab se: ${best}`, `आपकी मेमोरी के अनुसार: ${best}`),
          tools: [{ name: 'memory_rag', status: 'done', args: { action: 'recall', query: clean } }],
        };
      }
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

export async function runPcCommand(text, { requestPermission = null, historyMessages = [], fromVoice = false } = {}) {
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

  const slot = await tryLocalSlotAction(clean, lang, requestPermission, { fromVoice });
  if (slot?.handled) {
    return { ...slot, tier: 'fast', modelLabel: slot.modelLabel || 'Windows PC Control', routeReason: 'Deterministic PC action; no local AI' };
  }

  // Smart Multi-Command Chaining ("chrome minimize karo aur temp files saaf karo" / "minimize chrome and clean temp files")
  if (/(?:\s+(?:aur|fir|phir|and then|and|then)\s+|\s*;\s*)/i.test(clean) && !/^["'].*["']$/.test(clean)) {
    const parts = clean
      .split(/(?:\s+(?:aur|fir|phir|and then|and|then)\s+|\s*;\s*)/i)
      .map((s) => s.trim())
      .filter((s) => s.length >= 3)
      .slice(0, 3);
    if (parts.length >= 2) {
      const results = [];
      for (const part of parts) {
        const stepFast = await tryFastVoiceAction(part, requestPermission);
        if (stepFast?.handled) {
          results.push(stepFast);
          continue;
        }
        const stepSlot = await tryLocalSlotAction(part, lang, requestPermission, { fromVoice });
        if (stepSlot?.handled) {
          results.push(stepSlot);
        }
      }
      if (results.length >= 2) {
        return {
          handled: true,
          tier: 'fast',
          modelLabel: 'Chained PC Actions',
          routeReason: `Executed ${results.length} chained commands locally`,
          replyText: results.map((r) => r.replyText).filter(Boolean).join(' · '),
          tools: results.flatMap((r) => r.tools || []),
        };
      }
    }
  }

  return { handled: false };
}
