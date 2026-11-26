// Browser & Electron Unified Bridge for Date-Indexed Episodic Memory
const EPISODIC_STORAGE_KEY = 'jeeva_episodic_history_v1';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function redactBasic(text) {
  return String(text || '')
    .replace(/AIza[A-Za-z0-9_-]{18,}/g, '[REDACTED_API_KEY]')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_KEY]');
}

function getDateParts(ts = Date.now()) {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = d.getHours();
  return {
    dateKey: `${year}-${month}-${day}`,
    weekday: WEEKDAYS[d.getDay()],
    timeLabel: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
    timeOfDay: h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night',
  };
}

function loadLocalTurns() {
  try {
    const raw = localStorage.getItem(EPISODIC_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalTurns(list) {
  try {
    localStorage.setItem(EPISODIC_STORAGE_KEY, JSON.stringify(list.slice(-400)));
  } catch {}
}

export async function logEpisodicTurn({
  source = 'chat',
  brainTier = 'fast',
  routeReason = '',
  userPrompt = '',
  assistantReply = '',
  toolsUsed = [],
} = {}) {
  const cleanPrompt = redactBasic(userPrompt).trim().slice(0, 600);
  if (!cleanPrompt) return null;
  const cleanReply = redactBasic(assistantReply).trim().slice(0, 600);

  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (api?.episodicLog) {
    return await api.episodicLog({
      source,
      brainTier,
      routeReason,
      userPrompt: cleanPrompt,
      assistantReply: cleanReply,
      toolsUsed,
    });
  }

  const ts = Date.now();
  const parts = getDateParts(ts);
  const entry = {
    id: `ep_${ts}`,
    timestamp: ts,
    ...parts,
    source,
    brainTier,
    routeReason,
    userPrompt: cleanPrompt,
    assistantReply: cleanReply,
    toolsUsed: Array.isArray(toolsUsed) ? toolsUsed : [],
  };
  const list = loadLocalTurns();
  list.push(entry);
  saveLocalTurns(list);
  return entry;
}

export async function queryEpisodicTimeline(filters = {}) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (api?.episodicQuery) {
    return await api.episodicQuery(filters);
  }
  const { dateKey = '', dateFrom = '', dateTo = '', weekday = '', timeOfDay = '', topic = '', limit = 25 } = filters;
  const topicLower = String(topic || '').trim().toLowerCase();
  const list = loadLocalTurns()
    .filter((t) => {
      if (dateKey && t.dateKey !== dateKey) return false;
      if (dateFrom && t.dateKey < dateFrom) return false;
      if (dateTo && t.dateKey > dateTo) return false;
      if (timeOfDay && t.timeOfDay !== timeOfDay) return false;
      if (weekday && String(t.weekday).toLowerCase() !== weekday.toLowerCase()) return false;
      if (topicLower) {
        const hay = `${t.userPrompt} ${t.assistantReply} ${(t.toolsUsed || []).join(' ')}`.toLowerCase();
        return topicLower.split(/\s+/).some((w) => w.length >= 2 && hay.includes(w));
      }
      return true;
    })
    .sort((a, b) => b.timestamp - a.timestamp);
  return list.slice(0, limit);
}

export async function getEpisodicDailySummaries(days = 14) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (api?.episodicSummaries) {
    return await api.episodicSummaries(days);
  }
  const list = loadLocalTurns().sort((a, b) => b.timestamp - a.timestamp);
  const map = new Map();
  for (const t of list) {
    if (!map.has(t.dateKey)) {
      map.set(t.dateKey, { dateKey: t.dateKey, weekday: t.weekday, totalTurns: 0, samplePrompts: [] });
    }
    const g = map.get(t.dateKey);
    g.totalTurns++;
    if (g.samplePrompts.length < 4) g.samplePrompts.push(t.userPrompt.slice(0, 70));
  }
  return Array.from(map.values()).slice(0, days);
}

export async function forgetEpisodicDay(dateKey) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (api?.episodicForgetDay) return await api.episodicForgetDay(dateKey);
  const before = loadLocalTurns();
  const after = before.filter((t) => t.dateKey !== dateKey);
  saveLocalTurns(after);
  return { removed: before.length - after.length };
}

export async function clearAllEpisodicHistory() {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (api?.episodicClear) return await api.episodicClear();
  saveLocalTurns([]);
  return { cleared: true };
}
