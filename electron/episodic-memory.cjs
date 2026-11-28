// Date-Indexed Episodic Memory Store (node:sqlite on Node >= 22.5 with atomic JSON fallback on Electron/Node < 22.5)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let DatabaseSync = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  DatabaseSync = null;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function redactSensitiveText(text) {
  return String(text || '')
    .replace(/AIza[A-Za-z0-9_-]{18,}/g, '[REDACTED_API_KEY]')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(GEMINI_API_KEY|APP_PIN|RELAY_SECRET|SESSION_SECRET|password|passcode)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

function toLocalDateParts(ts = Date.now()) {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = d.getHours();
  const dateKey = `${year}-${month}-${day}`;
  const weekday = WEEKDAYS[d.getDay()];
  const timeLabel = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const timeOfDay =
    hour >= 5 && hour < 12
      ? 'morning'
      : hour >= 12 && hour < 17
        ? 'afternoon'
        : hour >= 17 && hour < 21
          ? 'evening'
          : 'night';
  return { dateKey, weekday, timeLabel, timeOfDay };
}

function extractKeywords(text) {
  const words = String(text || '')
    .toLowerCase()
    .match(/[a-z0-9\u0900-\u097f._:-]{3,}/g) || [];
  return Array.from(new Set(words)).slice(0, 14);
}

function createEpisodicMemory({ userDataDir, retentionDays = 90, maxTurns = 2500 } = {}) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const jsonPath = path.join(userDataDir, 'episodic-history.json');
  const dbPath = path.join(userDataDir, 'episodic.sqlite');

  let db = null;
  let turns = [];

  if (DatabaseSync) {
    try {
      db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS episodic_turns (
          id TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL,
          date_key TEXT NOT NULL,
          weekday TEXT NOT NULL,
          time_label TEXT NOT NULL,
          time_of_day TEXT NOT NULL,
          source TEXT NOT NULL,
          brain_tier TEXT NOT NULL,
          route_reason TEXT,
          user_prompt TEXT NOT NULL,
          assistant_reply TEXT NOT NULL,
          tools_json TEXT NOT NULL,
          keywords TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_episodic_date ON episodic_turns(date_key, timestamp);
      `);
    } catch {
      db = null;
    }
  }

  function loadJson() {
    try {
      if (fs.existsSync(jsonPath)) {
        const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        if (Array.isArray(parsed)) turns = parsed;
      }
    } catch {
      turns = [];
    }
  }

  function persistJson() {
    try {
      const tmp = `${jsonPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(turns, null, 2), 'utf8');
      fs.renameSync(tmp, jsonPath);
    } catch {}
  }

  function pruneOld(now = Date.now()) {
    const cutoff = now - Math.max(1, Number(retentionDays) || 90) * 86400000;
    const cap = Math.max(1, Number(maxTurns) || 2500);
    if (db) {
      try {
        db.prepare('DELETE FROM episodic_turns WHERE timestamp < ?').run(cutoff);
        db.prepare(
          `DELETE FROM episodic_turns WHERE id IN (
            SELECT id FROM episodic_turns ORDER BY timestamp DESC LIMIT -1 OFFSET ?
          )`
        ).run(cap);
      } catch {}
      return;
    }
    turns = turns.filter((t) => (t.timestamp || 0) >= cutoff);
    if (turns.length > cap) turns = turns.slice(-cap);
  }

  if (!db) {
    loadJson();
    pruneOld();
  }

  function logTurn({
    timestamp = Date.now(),
    source = 'chat',
    brainTier = 'fast',
    routeReason = '',
    userPrompt = '',
    assistantReply = '',
    toolsUsed = [],
  } = {}) {
    const cleanPrompt = redactSensitiveText(userPrompt).trim().slice(0, 600);
    const cleanReply = redactSensitiveText(assistantReply).trim().slice(0, 600);
    if (!cleanPrompt) return null;

    const ts = Number(timestamp) || Date.now();
    const { dateKey, weekday, timeLabel, timeOfDay } = toLocalDateParts(ts);
    const id = `ep_${ts}_${crypto.randomBytes(3).toString('hex')}`;
    const safeTools = Array.isArray(toolsUsed) ? toolsUsed.map(String).slice(0, 8) : [];
    const keywords = extractKeywords(`${cleanPrompt} ${safeTools.join(' ')}`);

    const entry = {
      id,
      timestamp: ts,
      dateKey,
      weekday,
      timeLabel,
      timeOfDay,
      source: String(source || 'chat'),
      brainTier: String(brainTier || 'fast'),
      routeReason: String(routeReason || '').slice(0, 140),
      userPrompt: cleanPrompt,
      assistantReply: cleanReply,
      toolsUsed: safeTools,
      keywords,
    };

    if (db) {
      db.prepare(
        `INSERT INTO episodic_turns (
          id, timestamp, date_key, weekday, time_label, time_of_day,
          source, brain_tier, route_reason, user_prompt, assistant_reply, tools_json, keywords
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        entry.id,
        entry.timestamp,
        entry.dateKey,
        entry.weekday,
        entry.timeLabel,
        entry.timeOfDay,
        entry.source,
        entry.brainTier,
        entry.routeReason,
        entry.userPrompt,
        entry.assistantReply,
        JSON.stringify(entry.toolsUsed),
        JSON.stringify(entry.keywords)
      );
      pruneOld(ts);
    } else {
      turns.push(entry);
      pruneOld(ts);
      persistJson();
    }
    return entry;
  }

  function rowToEntry(r) {
    return {
      id: r.id,
      timestamp: Number(r.timestamp),
      dateKey: r.date_key,
      weekday: r.weekday,
      timeLabel: r.time_label,
      timeOfDay: r.time_of_day,
      source: r.source,
      brainTier: r.brain_tier,
      routeReason: r.route_reason || '',
      userPrompt: r.user_prompt,
      assistantReply: r.assistant_reply,
      toolsUsed: (() => { try { return JSON.parse(r.tools_json || '[]'); } catch { return []; } })(),
      keywords: (() => { try { return JSON.parse(r.keywords || '[]'); } catch { return []; } })(),
    };
  }

  function queryTimeline({ dateKey = '', dateFrom = '', dateTo = '', weekday = '', timeOfDay = '', topic = '', source = '', limit = 25 } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 25));
    const topicLower = String(topic || '').trim().toLowerCase();
    const weekdayLower = String(weekday || '').trim().toLowerCase();
    const todLower = String(timeOfDay || '').trim().toLowerCase();
    const srcLower = String(source || '').trim().toLowerCase();
    const topicTerms = topicLower ? topicLower.split(/\s+/).filter((w) => w.length >= 2) : [];

    let all;
    if (db) {
      let sql = 'SELECT * FROM episodic_turns WHERE 1=1';
      const params = [];
      if (dateKey) {
        sql += ' AND date_key = ?';
        params.push(dateKey);
      }
      if (dateFrom) {
        sql += ' AND date_key >= ?';
        params.push(dateFrom);
      }
      if (dateTo) {
        sql += ' AND date_key <= ?';
        params.push(dateTo);
      }
      if (todLower) {
        sql += ' AND lower(time_of_day) = ?';
        params.push(todLower);
      }
      if (weekdayLower) {
        sql += ' AND lower(weekday) = ?';
        params.push(weekdayLower);
      }
      if (srcLower) {
        sql += ' AND lower(source) = ?';
        params.push(srcLower);
      }
      if (topicTerms.length > 0) {
        const orClauses = topicTerms.map(
          () => "(lower(user_prompt || ' ' || assistant_reply || ' ' || tools_json) LIKE ?)"
        );
        sql += ` AND (${orClauses.join(' OR ')})`;
        for (const term of topicTerms) {
          params.push(`%${term}%`);
        }
      }
      sql += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(safeLimit);
      all = db.prepare(sql).all(...params).map(rowToEntry);
      return all;
    }

    all = [...turns]
      .filter((t) => {
        if (dateKey && t.dateKey !== dateKey) return false;
        if (dateFrom && t.dateKey < dateFrom) return false;
        if (dateTo && t.dateKey > dateTo) return false;
        if (todLower && String(t.timeOfDay).toLowerCase() !== todLower) return false;
        if (weekdayLower && String(t.weekday).toLowerCase() !== weekdayLower) return false;
        if (srcLower && String(t.source).toLowerCase() !== srcLower) return false;
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp);

    if (topicTerms.length > 0) {
      all = all.filter((t) => {
        const hay = `${t.userPrompt} ${t.assistantReply} ${(t.toolsUsed || []).join(' ')}`.toLowerCase();
        return topicTerms.some((term) => hay.includes(term));
      });
    }
    return all.slice(0, safeLimit);
  }

  function getDailySummaries(days = 14) {
    const safeDays = Math.max(1, Math.min(365, Number(days) || 14));
    const recent = db
      ? db
          .prepare(
            `SELECT * FROM episodic_turns
             WHERE date_key IN (
               SELECT DISTINCT date_key FROM episodic_turns ORDER BY date_key DESC LIMIT ?
             )
             ORDER BY timestamp DESC`
          )
          .all(safeDays)
          .map(rowToEntry)
      : [...turns].sort((a, b) => b.timestamp - a.timestamp);

    const byDate = new Map();
    for (const item of recent) {
      if (!byDate.has(item.dateKey)) {
        if (byDate.size >= safeDays) continue;
        byDate.set(item.dateKey, {
          dateKey: item.dateKey,
          weekday: item.weekday,
          totalTurns: 0,
          localCount: 0,
          cloudCount: 0,
          samplePrompts: [],
        });
      }
      const grp = byDate.get(item.dateKey);
      grp.totalTurns++;
      if (item.brainTier === 'cloud') grp.cloudCount++;
      else grp.localCount++;
      if (grp.samplePrompts.length < 4) grp.samplePrompts.push(item.userPrompt.slice(0, 70));
    }
    return Array.from(byDate.values()).slice(0, safeDays);
  }

  function forgetDay(dateKey) {
    if (!dateKey) return { removed: 0 };
    if (db) {
      const info = db.prepare('DELETE FROM episodic_turns WHERE date_key = ?').run(dateKey);
      return { removed: Number(info?.changes) || 0 };
    }
    const before = turns.length;
    turns = turns.filter((t) => t.dateKey !== dateKey);
    const removed = before - turns.length;
    if (removed > 0) persistJson();
    return { removed };
  }

  function clearAll() {
    if (db) {
      db.prepare('DELETE FROM episodic_turns').run();
      return { cleared: true };
    }
    turns = [];
    persistJson();
    return { cleared: true };
  }

  function close() {
    if (db) {
      try { db.close(); } catch {}
      db = null;
    }
  }

  return {
    logTurn,
    queryTimeline,
    getDailySummaries,
    forgetDay,
    clearAll,
    close,
  };
}

module.exports = {
  createEpisodicMemory,
  toLocalDateParts,
  redactSensitiveText,
};
