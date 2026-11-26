// Persistent Render Server Store: uses built-in node:sqlite on Node >= 22.5 with zero-dep atomic JSON fallback
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function createServerStore(dataDir = process.env.DATA_DIR || path.join(os.tmpdir(), 'jeeva-server-data')) {
  fs.mkdirSync(dataDir, { recursive: true });
  const shareTokens = new Map();
  const rateBuckets = new Map();

  let db = null;
  let storageEngine = 'json-file';
  const jsonFile = path.join(dataDir, 'relay-state.json');

  try {
    const sqliteMod = await import('node:sqlite');
    if (sqliteMod?.DatabaseSync) {
      db = new sqliteMod.DatabaseSync(path.join(dataDir, 'jeeva.sqlite'));
      db.exec(`
        CREATE TABLE IF NOT EXISTS share_tokens (
          hash TEXT PRIMARY KEY,
          owner_key TEXT NOT NULL,
          scope TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rate_buckets (
          ip TEXT PRIMARY KEY,
          window_start INTEGER NOT NULL,
          count INTEGER NOT NULL
        );
      `);
      const now = Date.now();
      db.prepare('DELETE FROM share_tokens WHERE expires_at <= ?').run(now);
      for (const row of db.prepare('SELECT * FROM share_tokens').all()) {
        shareTokens.set(row.hash, {
          ownerKey: row.owner_key,
          scope: row.scope,
          expiresAt: Number(row.expires_at),
          createdAt: Number(row.created_at),
        });
      }
      for (const row of db.prepare('SELECT * FROM rate_buckets WHERE window_start > ?').all(now - 60000)) {
        rateBuckets.set(row.ip, {
          windowStart: Number(row.window_start),
          count: Number(row.count),
        });
      }
      storageEngine = 'node:sqlite';
    }
  } catch {
    db = null;
  }

  if (!db) {
    try {
      if (fs.existsSync(jsonFile)) {
        const parsed = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
        const now = Date.now();
        for (const [k, v] of Object.entries(parsed?.shareTokens || {})) {
          if (v && v.expiresAt > now) shareTokens.set(k, v);
        }
        for (const [k, v] of Object.entries(parsed?.rateBuckets || {})) {
          if (v && now - v.windowStart < 60000) rateBuckets.set(k, v);
        }
      }
    } catch {}
  }

  function flushJson() {
    if (db) return;
    try {
      const tmp = `${jsonFile}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify({
          shareTokens: Object.fromEntries(shareTokens),
          rateBuckets: Object.fromEntries(rateBuckets),
        }),
        'utf8'
      );
      fs.renameSync(tmp, jsonFile);
    } catch {}
  }

  return {
    engine: storageEngine,
    getShareToken: (hash) => shareTokens.get(hash) || null,
    setShareToken: (hash, val) => {
      shareTokens.set(hash, val);
      if (db) {
        db.prepare(
          'INSERT OR REPLACE INTO share_tokens (hash, owner_key, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(hash, val.ownerKey, val.scope, val.expiresAt, val.createdAt);
      } else {
        flushJson();
      }
    },
    deleteShareToken: (hash) => {
      shareTokens.delete(hash);
      if (db) db.prepare('DELETE FROM share_tokens WHERE hash = ?').run(hash);
      else flushJson();
    },
    pruneExpiredShareTokens: (now = Date.now()) => {
      for (const [k, v] of shareTokens.entries()) {
        if (v.expiresAt <= now) shareTokens.delete(k);
      }
      if (db) db.prepare('DELETE FROM share_tokens WHERE expires_at <= ?').run(now);
      else flushJson();
    },
    getShareTokenSize: () => shareTokens.size,
    getRateBucket: (ip) => rateBuckets.get(ip) || null,
    setRateBucket: (ip, bucket) => {
      rateBuckets.set(ip, bucket);
      if (db) {
        db.prepare('INSERT OR REPLACE INTO rate_buckets (ip, window_start, count) VALUES (?, ?, ?)').run(
          ip,
          bucket.windowStart,
          bucket.count
        );
      } else {
        flushJson();
      }
    },
    clearRateBuckets: () => {
      rateBuckets.clear();
      if (db) db.prepare('DELETE FROM rate_buckets').run();
      else flushJson();
    },
    getRateBucketSize: () => rateBuckets.size,
    close: () => {
      try { db?.close?.(); } catch {}
    },
  };
}
