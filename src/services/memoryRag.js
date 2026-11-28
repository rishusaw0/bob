// Browser & Cross-Platform Persistent Sparse-Vector Memory RAG Helper (bridges Electron memory-store.cjs or localStorage fallback)
const STORAGE_KEY = 'jeeva_rag_memory_v1';

function tokenize(text) {
  const words = String(text || '').toLowerCase().match(/[a-z0-9\u0900-\u097f._:-]{2,}/g) || [];
  const out = [];
  for (const w of words) {
    out.push(w);
    if (w.length >= 5) {
      for (let i = 0; i <= w.length - 3; i++) out.push(`#${w.slice(i, i + 3)}`);
    }
  }
  return out;
}

function buildVec(text) {
  const tf = Object.create(null);
  for (const t of tokenize(text)) tf[t] = (tf[t] || 0) + (t.startsWith('#') ? 0.35 : 1);
  let sq = 0;
  for (const k of Object.keys(tf)) sq += tf[k] * tf[k];
  const norm = Math.sqrt(sq) || 1;
  const vec = Object.create(null);
  for (const k of Object.keys(tf)) vec[k] = Number((tf[k] / norm).toFixed(4));
  return vec;
}

function cosine(a, b) {
  let s = 0;
  for (const k of Object.keys(a || {})) if (b?.[k]) s += a[k] * b[k];
  return s;
}

function loadLocalMemories() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalMemories(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 200)));
  } catch {}
}

export async function rememberUserMemory(content, category = 'fact') {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (api?.memoryRag) {
    return await api.memoryRag('remember', content, category);
  }
  const clean = String(content || '').trim();
  if (!clean) return null;
  const norm = clean.toLowerCase();
  const list = loadLocalMemories().filter((x) => String(x?.content || '').trim().toLowerCase() !== norm);
  const item = { id: `m_${Date.now()}`, content: clean, category, vector: buildVec(clean), updatedAt: Date.now() };
  list.unshift(item);
  saveLocalMemories(list);
  return { success: true, item };
}

export async function recallRelevantMemories(query, limit = 5) {
  try {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (api?.memoryRag) {
      const res = await api.memoryRag('recall', query, '');
      return Array.isArray(res?.items) ? res.items.slice(0, limit) : [];
    }
    const list = loadLocalMemories();
    const qVec = buildVec(query);
    return list
      .map((it) => ({ ...it, score: cosine(qVec, it.vector) }))
      .filter((x) => x.score >= 0.14)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function listAllMemories() {
  try {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (api?.memoryRag) {
      const res = await api.memoryRag('list', '', '');
      return Array.isArray(res?.items) ? res.items : [];
    }
    return loadLocalMemories();
  } catch {
    return [];
  }
}

export async function forgetMemoryItem(idOrAll) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (api?.memoryRag) {
    return await api.memoryRag('forget', idOrAll, '');
  }
  if (idOrAll === 'all') {
    saveLocalMemories([]);
    return { removed: true };
  }
  saveLocalMemories(loadLocalMemories().filter((x) => x.id !== idOrAll));
  return { removed: 1 };
}
