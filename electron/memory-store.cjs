// Local Persistent Memory & Sparse TF-IDF / n-gram Vector RAG Store (Zero native binary deps)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function tokenizeText(text) {
  const lower = String(text || '').toLowerCase();
  const words = lower.match(/[a-z0-9\u0900-\u097f._:-]{2,}/g) || [];
  const grams = [];
  for (const w of words) {
    grams.push(w);
    if (w.length >= 5) {
      for (let i = 0; i <= w.length - 3; i++) {
        grams.push(`#${w.slice(i, i + 3)}`);
      }
    }
  }
  return grams;
}

function buildNormalizedVector(text) {
  const tokens = tokenizeText(text);
  const tf = Object.create(null);
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + (t.startsWith('#') ? 0.35 : 1);
  }
  let sqSum = 0;
  for (const k of Object.keys(tf)) sqSum += tf[k] * tf[k];
  const norm = Math.sqrt(sqSum) || 1;
  const vec = Object.create(null);
  for (const k of Object.keys(tf)) {
    vec[k] = Number((tf[k] / norm).toFixed(4));
  }
  return vec;
}

function cosineSparse(a, b) {
  if (!a || !b) return 0;
  let sum = 0;
  const keysA = Object.keys(a);
  for (const k of keysA) {
    if (b[k]) sum += a[k] * b[k];
  }
  return sum;
}

function createMemoryStore({ userDataDir, maxItems = 300 } = {}) {
  const filePath = path.join(userDataDir, 'jeeva-memory.json');
  let items = [];
  let loaded = false;

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (Array.isArray(parsed)) items = parsed;
      }
    } catch {
      items = [];
    }
  }

  function persist() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf-8');
      fs.renameSync(tmp, filePath);
    } catch {}
  }

  function remember({ content, category = 'fact', tags = [], metadata = {} } = {}) {
    load();
    const clean = String(content || '').trim().slice(0, 1200);
    if (!clean) throw new Error('Memory content cannot be empty');

    const safeCat = ['preference', 'project', 'folder', 'command', 'fact'].includes(category) ? category : 'fact';
    const tagList = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : [];
    const textForVec = `${clean} ${safeCat} ${tagList.join(' ')}`;
    const vector = buildNormalizedVector(textForVec);

    // Deduplicate near-identical memory entries (cosine >= 0.94 in same category)
    const dupIdx = items.findIndex((it) => it.category === safeCat && cosineSparse(it.vector, vector) >= 0.94);
    const entry = {
      id: dupIdx !== -1 ? items[dupIdx].id : crypto.randomBytes(5).toString('hex'),
      content: clean,
      category: safeCat,
      tags: tagList,
      metadata,
      vector,
      updatedAt: Date.now(),
      hits: dupIdx !== -1 ? (items[dupIdx].hits || 1) + 1 : 1,
    };

    if (dupIdx !== -1) items.splice(dupIdx, 1);
    items.unshift(entry);
    if (items.length > maxItems) items.length = maxItems;
    persist();
    return { id: entry.id, content: entry.content, category: entry.category, tags: entry.tags, updatedAt: entry.updatedAt };
  }

  function recall(query, { topK = 5, category = '' } = {}) {
    load();
    const q = String(query || '').trim();
    if (!q) {
      return items
        .filter((it) => !category || it.category === category)
        .slice(0, topK)
        .map(({ vector: _v, ...rest }) => rest);
    }

    const qVec = buildNormalizedVector(q);
    const qLower = q.toLowerCase();
    const now = Date.now();
    const scored = items
      .filter((it) => !category || it.category === category)
      .map((it) => {
        const sim = cosineSparse(qVec, it.vector);
        const lexBonus = it.content.toLowerCase().includes(qLower) ? 0.18 : 0;
        const recencyDays = Math.max(0, (now - (it.updatedAt || now)) / 86400000);
        const recencyBoost = Math.max(0, 0.08 - recencyDays * 0.002);
        return { item: it, score: Number((sim + lexBonus + recencyBoost).toFixed(4)) };
      })
      .filter((x) => x.score >= 0.12)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ item: { vector: _v, ...rest }, score }) => ({ ...rest, score }));

    return scored;
  }

  function list(limit = 50) {
    load();
    return items.slice(0, limit).map(({ vector: _v, ...rest }) => rest);
  }

  function forget(idOrAll) {
    load();
    if (idOrAll === 'all') {
      const count = items.length;
      items = [];
      persist();
      return { removed: count };
    }
    const before = items.length;
    items = items.filter((it) => it.id !== idOrAll);
    if (items.length !== before) persist();
    return { removed: before - items.length };
  }

  return { remember, recall, list, forget, buildNormalizedVector };
}

module.exports = { createMemoryStore, buildNormalizedVector, cosineSparse };
