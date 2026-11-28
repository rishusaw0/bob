// Deterministic Windows PC command adapter. This module does not contain or call an AI model.
import { tryFastVoiceAction, repairVoiceTranscript } from './voiceRouter.js';
import { tryLocalSlotAction } from './localSlotActions.js';
import { executeFunctionCall } from './tools.js';

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

export async function runLocalQuickBrain(text, { requestPermission = null, historyMessages = [] } = {}) {
  const repaired = repairVoiceTranscript(text);
  const clean = resolvePronounFollowUp(repaired, historyMessages);
  if (!clean) return { handled: false };

  // These are deterministic OS utilities only; all open-ended language responses are Gemini.
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
