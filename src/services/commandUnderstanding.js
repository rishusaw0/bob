// Phase 4: deterministic, dependency-free command entity extraction and contextual follow-ups.
const APP_WORDS = /(?:chrome|edge|firefox|brave|spotify|notepad|calculator|calc|vscode|vs code|visual studio code|explorer|file explorer|paint|word|excel|powerpoint|discord|telegram|whatsapp|steam)/i;

export function extractCommandEntities(input, now = new Date()) {
  const text = String(input || '').trim();
  const percentMatch = text.match(/(?:^|\s)(\d{1,3})\s*(?:%|percent|percentage)(?=[\s,.;!?]|$)/i);
  const timerMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(seconds?|secs?|sec|minutes?|mins?|min|hours?|hrs?|hr)\b/i)
    || text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(सेकंड|मिनट|घंटे|घंटा)(?=$|\s|[.,!?])/u);
  let timerSeconds = null;
  if (timerMatch) {
    const unit = timerMatch[2].toLowerCase();
    const value = Number(timerMatch[1]);
    timerSeconds = /hour|hr|घंट/u.test(unit) ? value * 3600 : /sec|सेकंड/u.test(unit) ? value : value * 60;
  }

  const pathMatch = text.match(/[A-Za-z]:\\(?:[^<>:"|?*\r\n]+\\?)*[^<>:"|?*\r\n]*/);
  const dateMatch = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  let date = null;
  if (dateMatch) {
    const year = Number(dateMatch[1] || dateMatch[6]);
    const month = Number(dateMatch[2] || dateMatch[4]);
    const day = Number(dateMatch[3] || dateMatch[5]);
    const parsed = new Date(year, month - 1, day);
    if (parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day) {
      date = localDateKey(parsed);
    }
  } else if (/\b(tomorrow|kal)\b/i.test(text) || /(?:^|[\s,.;!?])कल(?=$|[\s,.;!?।])/u.test(text)) {
    const d = new Date(now); d.setDate(d.getDate() + 1); date = localDateKey(d);
  } else if (/\b(today|aaj)\b/i.test(text) || /(?:^|[\s,.;!?])आज(?=$|[\s,.;!?।])/u.test(text)) {
    date = localDateKey(now);
  }

  const appMatch = text.match(/\b(?:open|launch|start|close|quit|exit|band|kholo|chalao)\s+(chrome|edge|firefox|brave|spotify|notepad|calculator|calc|vscode|vs code|visual studio code|explorer|file explorer|paint|word|excel|powerpoint|discord|telegram|whatsapp|steam)\b/i)
    || text.match(/\b(chrome|edge|firefox|brave|spotify|notepad|calculator|calc|vscode|vs code|visual studio code|explorer|file explorer|paint|word|excel|powerpoint|discord|telegram|whatsapp|steam)\s+(?:open|launch|start|close|quit|exit|band|kholo|chalao)\b/i);
  return {
    appName: appMatch?.[1]?.replace(/\s+/g, ' ').trim() || null,
    filePath: pathMatch?.[0]?.trim() || null,
    percentage: percentMatch ? Math.min(100, Number(percentMatch[1])) : null,
    timerSeconds,
    date,
  };
}

function localDateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function resolveContextualFollowUp(input, context = {}) {
  const text = String(input || '').trim().toLowerCase();
  if (!text) return { kind: 'none' };
  const closeRef = /\b(?:ab|now|please)?\s*(?:ise|isko|usko|it|that|this)\s+(?:band|close|quit|exit)(?:\s+kar\s*do|\s+do)?\b|\b(?:band|close)\s+(?:it|that|this)\b|\b(?:ab|now)\s+ise\s+band\s+kar\s+do\b/i.test(text);
  const reopenRef = /\b(?:ise|isko|usko|it|that|this)\s+(?:dobara|again|phir)\s+(?:kholo|open|chalao)\b/i.test(text);
  if (!closeRef && !reopenRef) return { kind: 'none' };
  const target = String(context.lastApp || '').trim();
  if (!target) return { kind: 'clarify', question: 'Kaunsa app? Pehle app ka naam bataiye.' };
  return { kind: closeRef ? 'close_app' : 'open_app', appName: target };
}

export function isAmbiguousCommand(input) {
  const text = String(input || '').trim().toLowerCase();
  if (!text) return true;
  if (/^(?:open|close|launch|start|band|kholo|chalao|delete|move|copy)\s*(?:it|this|that|ise|isko)?$/i.test(text)) return true;
  if (/\b(?:open|close|delete|move|copy)\s+(?:the\s+)?(?:app|file|folder)\s*$/i.test(text)) return true;
  return false;
}
