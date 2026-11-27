// Render Production Server — Landing Page + Workspace PWA + Multi-User Isolated Relay + Protected Gemini Proxy
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { createServerStore } from './store.js';
import { computeWebSocketAccept, encodeServerFrame, createFrameReader } from './ws-codec.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const PORT = Number(process.env.PORT) || 3000;
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const APP_PIN = (process.env.APP_PIN || '').trim();
const RELAY_SECRET = (process.env.RELAY_SECRET || '').trim();
const INSTALLER_DOWNLOAD_URL = (process.env.INSTALLER_DOWNLOAD_URL || '').trim();
const PRIVATE_LOCK_ALL = process.env.PRIVATE_LOCK_ALL === 'true';
const GEMINI_RPM_LIMIT = Math.max(5, Number(process.env.GEMINI_RPM_LIMIT) || 40);
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(`jeeva-v1:${GEMINI_API_KEY}:${APP_PIN || 'open'}`)
    .digest('hex');

// Connected PC agents keyed by `${ownerKey}::${deviceId}` for strict multi-user isolation
const relayAgents = new Map();
const store = await createServerStore();

const READ_ONLY_ACTIONS = new Set([
  'liveStats',
  'systemInfo',
  'battery',
  'runningApps',
  'listInstalledApps',
  'listFiles',
  'searchFiles',
]);

function isActionAllowedForReadOnly(action, args = []) {
  if (READ_ONLY_ACTIONS.has(action)) return true;
  if (action === 'wifi' && (!args[0] || args[0] === 'status')) return true;
  if (action === 'diagnostics' && args[0] !== 'kill_process') return true;
  if (action === 'clipboardHistory' && (!args[0] || args[0] === 'list')) return true;
  if (action === 'scheduler' && (!args[0] || args[0] === 'list')) return true;
  return false;
}

const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
})();
const UPDATE_LATEST_VERSION = (process.env.UPDATE_LATEST_VERSION || APP_VERSION).trim();

function hashPairToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createTimedShareToken({ ownerKey, ttlMinutes = 60, scope = 'full' }) {
  const safeTtl = Math.max(5, Math.min(1440, Number(ttlMinutes) || 60));
  const safeScope = scope === 'read_only' ? 'read_only' : 'full';
  const rawToken = `JVA-TMP-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const hash = hashPairToken(rawToken);
  const now = Date.now();
  const expiresAt = now + safeTtl * 60 * 1000;
  if (store.getShareTokenSize() > 1000) {
    store.pruneExpiredShareTokens(now);
  }
  store.setShareToken(hash, { ownerKey, expiresAt, scope: safeScope, createdAt: now });
  return { shareToken: rawToken, expiresAt, expiresInMinutes: safeTtl, scope: safeScope };
}

function getClientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

function checkGeminiRateLimit(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const bucket = store.getRateBucket(ip);
  if (!bucket || now - bucket.windowStart >= 60000) {
    if (store.getRateBucketSize() > 2000) store.clearRateBuckets();
    store.setRateBucket(ip, { windowStart: now, count: 1 });
    return { allowed: true, retryAfter: 0 };
  }
  if (bucket.count >= GEMINI_RPM_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((60000 - (now - bucket.windowStart)) / 1000) };
  }
  store.setRateBucket(ip, { windowStart: bucket.windowStart, count: bucket.count + 1 });
  return { allowed: true, retryAfter: 0 };
}

// Per-user isolation context:
// - Permanent Pair Token (`pair:<sha256>`) -> full scope
// - Expiring Guest Share Token (`JVA-TMP-...`) -> timed + scoped (`full` or `read_only`)
// - Owner mode (`owner:default`) -> ONLY when RELAY_SECRET or APP_PIN is configured and verified
function getRelayAuthContext(req) {
  const pairToken = String(req.headers['x-pair-token'] || '').trim();
  if (pairToken.length >= 12) {
    if (pairToken.startsWith('JVA-TMP-')) {
      const hash = hashPairToken(pairToken);
      const entry = store.getShareToken(hash);
      if (!entry) return { ownerKey: null, expired: true, scope: null, isTemporary: true };
      if (Date.now() > entry.expiresAt) {
        store.deleteShareToken(hash);
        return { ownerKey: null, expired: true, scope: null, isTemporary: true };
      }
      return {
        ownerKey: entry.ownerKey,
        scope: entry.scope,
        expiresAt: entry.expiresAt,
        isTemporary: true,
        expired: false,
      };
    }
    return { ownerKey: `pair:${hashPairToken(pairToken)}`, scope: 'full', isTemporary: false, expired: false };
  }
  const relayHeader = String(req.headers['x-relay-secret'] || '').trim();
  if (RELAY_SECRET && relayHeader === RELAY_SECRET) {
    return { ownerKey: 'owner:default', scope: 'full', isTemporary: false, expired: false };
  }
  if (APP_PIN && isAuthorized(req)) {
    return { ownerKey: 'owner:default', scope: 'full', isTemporary: false, expired: false };
  }
  return { ownerKey: null, scope: null, isTemporary: false, expired: false };
}

function getRelayOwnerKey(req) {
  return getRelayAuthContext(req).ownerKey;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
};

// Brute-force protection for APP_PIN
const unlockAttempts = new Map();

function signToken(pin) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`jeeva:${pin}`).digest('hex');
}

function isAuthorized(req) {
  if (!APP_PIN) return true;
  const token = String(req.headers['x-app-token'] || '').trim();
  const pinHeader = String(req.headers['x-app-pin'] || '').trim();
  if (pinHeader && pinHeader === APP_PIN) return true;
  if (token && token === signToken(APP_PIN)) return true;
  return false;
}

function setApiCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-app-token, x-app-pin, x-pair-token, x-relay-secret, x-goog-api-key, x-goog-api-client'
  );
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function readJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function proxyToGemini(req, res, targetPath) {
  if (!GEMINI_API_KEY) {
    sendJson(res, 500, { error: 'GEMINI_API_KEY is not configured on Render server.' });
    return;
  }
  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: 'Owner Server Key locked. Enter Access PIN or use your own Gemini API key in Settings.' });
    return;
  }

  const rate = checkGeminiRateLimit(req);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    sendJson(res, 429, { error: `Rate limit reached. Please wait ${rate.retryAfter}s before sending more requests.` });
    return;
  }

  const forwardHeaders = { ...req.headers };
  delete forwardHeaders.host;
  delete forwardHeaders.connection;
  delete forwardHeaders.origin;
  delete forwardHeaders.referer;
  delete forwardHeaders['x-app-token'];
  delete forwardHeaders['x-app-pin'];
  delete forwardHeaders['x-pair-token'];
  delete forwardHeaders['x-relay-secret'];
  forwardHeaders['x-goog-api-key'] = GEMINI_API_KEY;

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    port: 443,
    path: targetPath,
    method: req.method,
    headers: forwardHeaders,
  };

  const upstream = https.request(options, (upRes) => {
    res.statusCode = upRes.statusCode || 200;
    for (const [k, v] of Object.entries(upRes.headers)) {
      const lk = k.toLowerCase();
      if (v !== undefined && lk !== 'transfer-encoding' && !lk.startsWith('access-control-')) {
        res.setHeader(k, v);
      }
    }
    setApiCorsHeaders(res);
    upRes.pipe(res);
  });

  upstream.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: 'Upstream Gemini API error: ' + err.message });
    } else {
      res.end();
    }
  });

  req.pipe(upstream);
}

function serveStatic(req, res, reqPath) {
  if (!fs.existsSync(DIST_DIR)) {
    sendJson(res, 503, { error: 'Frontend build (dist/) not found. Run npm run build:react.' });
    return;
  }

  // Handle relative ./assets/... requests when browser is at /app/... or /chat/...
  const cleanReqPath = reqPath.replace(/^\/(?:app|chat)\/assets\//i, '/assets/');
  const normalized = path.normalize(cleanReqPath === '/' ? 'index.html' : cleanReqPath.replace(/^\/+/, ''));
  let filePath = path.join(DIST_DIR, normalized);

  const reqExt = path.extname(cleanReqPath).toLowerCase();
  const isAssetRequest = ['.js', '.mjs', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.map', '.woff', '.woff2', '.json'].includes(reqExt);

  if (!filePath.startsWith(DIST_DIR + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    if (isAssetRequest) {
      res.statusCode = 404;
      res.end('Asset not found');
      return;
    }
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  if (ext === '.html' || filePath.endsWith('service-worker.js')) {
    res.setHeader('Cache-Control', 'no-cache');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  fs.createReadStream(filePath).pipe(res);
}

function countAgentsForOwner(ownerKey) {
  if (!ownerKey) return 0;
  let count = 0;
  for (const agent of relayAgents.values()) {
    if (agent.ownerKey === ownerKey) count++;
  }
  return count;
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const reqPath = urlObj.pathname;
  const fwdProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const hostHeader = String(req.headers.host || '').trim();

  // Force HTTPS redirect on public hosts behind Render proxy (keep internal healthchecks intact)
  if (
    fwdProto === 'http' &&
    hostHeader &&
    !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(hostHeader) &&
    reqPath !== '/healthz' &&
    reqPath !== '/api/health'
  ) {
    res.statusCode = 301;
    res.setHeader('Location', `https://${hostHeader}${req.url || '/'}`);
    res.end();
    return;
  }
  if (fwdProto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  if (reqPath.startsWith('/api/') || reqPath === '/healthz') {
    setApiCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
  }

  // Fast UptimeRobot / Cron-Job / Render health endpoint (supports GET & HEAD)
  if ((req.method === 'GET' || req.method === 'HEAD') && (reqPath === '/api/health' || reqPath === '/healthz')) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(
        JSON.stringify({
          ok: true,
          status: 'healthy',
          service: 'jeeva-ai',
          uptimeSec: Math.floor(process.uptime()),
          activeRelays: relayAgents.size,
          timestamp: new Date().toISOString(),
        })
      );
    }
    return;
  }

  if (req.method === 'GET' && reqPath === '/api/config') {
    const ownerKey = getRelayOwnerKey(req);
    sendJson(res, 200, {
      serverManagedKey: Boolean(GEMINI_API_KEY),
      requiresPin: Boolean(APP_PIN),
      requiresFullLock: Boolean(PRIVATE_LOCK_ALL && APP_PIN),
      authorized: isAuthorized(req),
      installerUrl: INSTALLER_DOWNLOAD_URL,
      latestVersion: UPDATE_LATEST_VERSION,
      relayDevicesCount: countAgentsForOwner(ownerKey),
    });
    return;
  }

  // Mint short-lived ephemeral Live API token for browser/cloud users without leaking GEMINI_API_KEY
  if (req.method === 'POST' && reqPath === '/api/gemini-live-token') {
    if (!GEMINI_API_KEY) {
      sendJson(res, 500, { error: 'GEMINI_API_KEY is not configured on Render server.' });
      return;
    }
    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: 'Owner Access PIN required to start Gemini Live session.' });
      return;
    }
    const rate = checkGeminiRateLimit(req);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfter));
      sendJson(res, 429, { error: `Rate limit reached. Wait ${rate.retryAfter}s.` });
      return;
    }
    try {
      const tokenClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY, httpOptions: { apiVersion: 'v1alpha' } });
      const expireTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const created = await tokenClient.authTokens.create({
        config: { uses: 1, expireTime },
      });
      sendJson(res, 200, { ok: true, token: created?.name || '' });
    } catch (err) {
      sendJson(res, 500, { error: err?.message || 'Could not mint ephemeral Live API token' });
    }
    return;
  }

  if (req.method === 'POST' && reqPath === '/api/unlock') {
    const clientIp = getClientIp(req);
    const state = unlockAttempts.get(clientIp) || { count: 0, lockUntil: 0 };
    const now = Date.now();
    if (now < state.lockUntil) {
      const secs = Math.ceil((state.lockUntil - now) / 1000);
      sendJson(res, 429, { error: `Too many wrong attempts. Wait ${secs}s.` });
      return;
    }

    try {
      const body = await readJsonBody(req);
      if (!APP_PIN || String(body.pin || '').trim() === APP_PIN) {
        unlockAttempts.delete(clientIp);
        sendJson(res, 200, { ok: true, token: APP_PIN ? signToken(APP_PIN) : 'open' });
      } else {
        state.count++;
        if (state.count >= 5) {
          state.lockUntil = now + 30000;
          state.count = 0;
        }
        if (unlockAttempts.size > 2000) unlockAttempts.clear();
        unlockAttempts.set(clientIp, state);
        sendJson(res, 403, { error: 'Invalid Access PIN' });
      }
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Outbound SSE connection from PC Electron Host (isolated by ownerKey)
  if (req.method === 'GET' && reqPath === '/api/relay/stream') {
    const ownerKey = getRelayOwnerKey(req);
    if (!ownerKey) {
      sendJson(res, 401, { error: 'Unauthorized relay connection. Provide a valid Pair Key or Access PIN.' });
      return;
    }
    const deviceId = (urlObj.searchParams.get('deviceId') || 'default-pc').trim();
    const hostname = (urlObj.searchParams.get('hostname') || 'Windows PC').trim();
    const agentKey = `${ownerKey}::${deviceId}`;

    const prev = relayAgents.get(agentKey);
    if (prev) {
      clearInterval(prev.heartbeat);
      try { prev.resSSE.end(); } catch {}
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const agent = {
      agentKey,
      ownerKey,
      deviceId,
      hostname,
      connectedAt: new Date().toISOString(),
      lastSeen: Date.now(),
      resSSE: res,
      pendingCommands: new Map(),
      heartbeat: setInterval(() => {
        try {
          agent.lastSeen = Date.now();
          res.write(': ping\n\n');
        } catch {}
      }, 20000),
    };
    relayAgents.set(agentKey, agent);
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, deviceId, hostname })}\n\n`);

    req.on('close', () => {
      clearInterval(agent.heartbeat);
      for (const [, pending] of agent.pendingCommands) {
        clearTimeout(pending.timer);
        pending.reject(new Error('PC Relay disconnected during command execution'));
      }
      agent.pendingCommands.clear();
      if (relayAgents.get(agentKey)?.resSSE === res) {
        relayAgents.delete(agentKey);
      }
    });
    return;
  }

  // Command execution result pushed back by PC Electron Host
  if (req.method === 'POST' && reqPath === '/api/relay/result') {
    const ownerKey = getRelayOwnerKey(req);
    if (!ownerKey) {
      sendJson(res, 401, { error: 'Unauthorized relay result.' });
      return;
    }
    try {
      const body = await readJsonBody(req, 25 * 1024 * 1024);
      const deviceId = String(body.deviceId || 'default-pc');
      const agent = relayAgents.get(`${ownerKey}::${deviceId}`);
      if (!agent || agent.ownerKey !== ownerKey) {
        sendJson(res, 404, { error: 'Relay agent session not active' });
        return;
      }
      agent.lastSeen = Date.now();
      const pending = agent.pendingCommands.get(body.cmdId);
      if (pending) {
        clearTimeout(pending.timer);
        agent.pendingCommands.delete(body.cmdId);
        if (body.ok) pending.resolve(body.result);
        else pending.reject(new Error(body.error || 'PC action failed'));
      }
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Mint time-limited, optionally read-only Friend Share Token (`JVA-TMP-...`)
  if (req.method === 'POST' && reqPath === '/api/relay/share-token') {
    const auth = getRelayAuthContext(req);
    if (!auth.ownerKey || auth.isTemporary) {
      sendJson(res, 401, { error: 'Permanent Pair Key or Owner PIN required to create temporary share links.' });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const created = createTimedShareToken({
        ownerKey: auth.ownerKey,
        ttlMinutes: body.ttlMinutes,
        scope: body.scope,
      });
      sendJson(res, 200, { ok: true, ...created });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Connected PC devices visible ONLY to matching owner / valid pair-token holder
  if (req.method === 'GET' && reqPath === '/api/relay/devices') {
    const auth = getRelayAuthContext(req);
    if (!auth.ownerKey) {
      sendJson(res, 401, {
        error: auth.expired
          ? 'Temporary share link expired. Request a fresh link from PC owner.'
          : 'Pair Key or Access PIN required to view connected PCs.',
      });
      return;
    }
    const devices = [];
    for (const a of relayAgents.values()) {
      if (a.ownerKey === auth.ownerKey) {
        devices.push({
          deviceId: a.deviceId,
          hostname: a.hostname,
          connectedAt: a.connectedAt,
          lastSeen: a.lastSeen,
          online: true,
          scope: auth.scope,
          expiresAt: auth.expiresAt || null,
        });
      }
    }
    sendJson(res, 200, { devices, scope: auth.scope, expiresAt: auth.expiresAt || null });
    return;
  }

  // Forward action from Web/Mobile client ONLY to matching owner/pair-token PC
  if (req.method === 'POST' && reqPath === '/api/relay/execute') {
    const auth = getRelayAuthContext(req);
    if (!auth.ownerKey) {
      sendJson(res, 401, {
        error: auth.expired
          ? 'Temporary share link expired. Request a fresh link from PC owner.'
          : 'Pair Key or Access PIN required to execute remote PC commands.',
      });
      return;
    }
    try {
      const body = await readJsonBody(req, 2 * 1024 * 1024);
      const actionArgs = Array.isArray(body.args) ? body.args : [];
      if (auth.scope === 'read_only' && !isActionAllowedForReadOnly(body.action, actionArgs)) {
        sendJson(res, 403, { error: `Read-only share link cannot run "${body.action}".` });
        return;
      }
      const requestedId = body.deviceId ? String(body.deviceId) : null;
      let agent = requestedId ? relayAgents.get(`${auth.ownerKey}::${requestedId}`) : null;
      if (!agent && !requestedId) {
        for (const candidate of relayAgents.values()) {
          if (candidate.ownerKey === auth.ownerKey) {
            agent = candidate;
            break;
          }
        }
      }

      if (!agent || agent.ownerKey !== auth.ownerKey) {
        sendJson(res, 503, { error: 'Aapka koi PC is Pair Key se connected nahi hai. PC app mein Render Link connect karein.' });
        return;
      }

      const cmdId = crypto.randomUUID();
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          agent.pendingCommands.delete(cmdId);
          reject(new Error('PC command timed out (user did not approve or PC unreachable).'));
        }, 160000);

        agent.pendingCommands.set(cmdId, { resolve, reject, timer });
        const payloadObj = {
          cmdId,
          action: body.action,
          args: actionArgs,
          source: auth.isTemporary ? `temp-${auth.scope}` : 'render-remote',
        };
        if (agent.sendCommand) {
          agent.sendCommand(payloadObj);
        } else {
          agent.resSSE.write(`event: command\ndata: ${JSON.stringify(payloadObj)}\n\n`);
        }
      });

      sendJson(res, 200, { ok: true, result });
    } catch (err) {
      sendJson(res, 500, { error: err?.message || String(err) });
    }
    return;
  }

  if (reqPath.startsWith('/api/gemini/')) {
    const upstreamPath = reqPath.slice('/api/gemini'.length) + urlObj.search;
    proxyToGemini(req, res, upstreamPath);
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, reqPath);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

// Upgrade WebSocket Relay (`/api/relay/ws`) for bidirectional low-latency command dispatch & results
server.on('upgrade', (req, socket, head) => {
  try {
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (urlObj.pathname !== '/api/relay/ws') {
      socket.destroy();
      return;
    }
    const ownerKey = getRelayOwnerKey(req);
    if (!ownerKey) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const wsKey = req.headers['sec-websocket-key'];
    if (!wsKey) {
      socket.destroy();
      return;
    }

    const deviceId = (urlObj.searchParams.get('deviceId') || 'default-pc').trim();
    const hostname = (urlObj.searchParams.get('hostname') || 'Windows PC').trim();
    const agentKey = `${ownerKey}::${deviceId}`;

    const prev = relayAgents.get(agentKey);
    if (prev) {
      clearInterval(prev.heartbeat);
      try { prev.resSSE?.end?.(); } catch {}
      try { prev.wsSocket?.destroy?.(); } catch {}
    }

    const accept = computeWebSocketAccept(wsKey);
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    const agent = {
      agentKey,
      ownerKey,
      deviceId,
      hostname,
      transport: 'websocket',
      connectedAt: new Date().toISOString(),
      lastSeen: Date.now(),
      wsSocket: socket,
      pendingCommands: new Map(),
      sendCommand: (payloadObj) => {
        if (!socket.destroyed) {
          socket.write(encodeServerFrame(0x1, Buffer.from(JSON.stringify({ type: 'command', ...payloadObj }), 'utf8')));
        }
      },
      heartbeat: setInterval(() => {
        try {
          if (!socket.destroyed) {
            agent.lastSeen = Date.now();
            socket.write(encodeServerFrame(0x9, Buffer.from('ping')));
          }
        } catch {}
      }, 20000),
    };
    relayAgents.set(agentKey, agent);
    socket.write(encodeServerFrame(0x1, Buffer.from(JSON.stringify({ type: 'connected', ok: true, deviceId, hostname }), 'utf8')));

    const onFrame = createFrameReader((opcode, payload) => {
      agent.lastSeen = Date.now();
      if (opcode === 0x8) {
        try { socket.end(encodeServerFrame(0x8)); } catch {}
        return;
      }
      if (opcode === 0x9) {
        try { socket.write(encodeServerFrame(0xa, payload)); } catch {}
        return;
      }
      if (opcode === 0x1 || opcode === 0x2) {
        try {
          const msg = JSON.parse(payload.toString('utf8'));
          if (msg.type === 'result' && msg.cmdId) {
            const pending = agent.pendingCommands.get(msg.cmdId);
            if (pending) {
              clearTimeout(pending.timer);
              agent.pendingCommands.delete(msg.cmdId);
              if (msg.ok) pending.resolve(msg.result);
              else pending.reject(new Error(msg.error || 'PC action failed'));
            }
          }
        } catch {}
      }
    });

    if (head && head.length) onFrame(head);
    socket.on('data', onFrame);
    socket.on('close', () => {
      clearInterval(agent.heartbeat);
      for (const [, pending] of agent.pendingCommands) {
        clearTimeout(pending.timer);
        pending.reject(new Error('PC WebSocket Relay disconnected during command execution'));
      }
      agent.pendingCommands.clear();
      if (relayAgents.get(agentKey)?.wsSocket === socket) {
        relayAgents.delete(agentKey);
      }
    });
    socket.on('error', () => {
      try { socket.destroy(); } catch {}
    });
  } catch {
    try { socket.destroy(); } catch {}
  }
});

const isMainEntry = Boolean(process.argv[1] && path.resolve(process.argv[1]) === __filename);
if (isMainEntry) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`JEEVA AI Render server listening on http://0.0.0.0:${PORT}`);
  });
}

export {
  server,
  createTimedShareToken,
  getRelayAuthContext,
  isActionAllowedForReadOnly,
  hashPairToken,
  UPDATE_LATEST_VERSION,
};
