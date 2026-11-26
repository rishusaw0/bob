const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { connectRelayWebSocket } = require('./ws-client.cjs');

function generatePairToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let raw = '';
  for (let i = 0; i < 12; i++) {
    raw += chars[bytes[i] % chars.length];
  }
  return `JVA-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function createCloudRelay({ userDataPath, safeStorage, osHostname, onExecuteCommand, onStatusChange }) {
  const cfgPath = path.join(userDataPath, 'relay-config.json');
  const pinVaultPath = path.join(userDataPath, 'relay-pin.vault');
  const pairVaultPath = path.join(userDataPath, 'relay-pair.vault');

  let activeReq = null;
  let reconnectTimer = null;
  let backoffMs = 3000;
  let manualStop = false;

  let status = {
    connected: false,
    connecting: false,
    enabled: false,
    renderUrl: '',
    deviceId: '',
    pairToken: '',
    hostname: osHostname,
    lastError: '',
    lastPingAt: null,
  };

  function readVault(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        return safeStorage?.isEncryptionAvailable?.() ? safeStorage.decryptString(buf) : buf.toString('utf-8');
      }
    } catch {}
    return '';
  }

  function writeVault(filePath, value) {
    try {
      if (!value) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } else if (safeStorage?.isEncryptionAvailable?.()) {
        fs.writeFileSync(filePath, safeStorage.encryptString(String(value)));
      } else {
        fs.writeFileSync(filePath, String(value), 'utf-8');
      }
    } catch {}
  }

  function loadSavedConfig() {
    let cfg = { renderUrl: '', deviceId: '', autoConnect: false };
    try {
      if (fs.existsSync(cfgPath)) {
        cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) };
      }
    } catch {}
    if (!cfg.deviceId) {
      cfg.deviceId = `${osHostname.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
      try {
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
      } catch {}
    }

    const pin = readVault(pinVaultPath);
    let pairToken = readVault(pairVaultPath);
    if (!pairToken) {
      pairToken = generatePairToken();
      writeVault(pairVaultPath, pairToken);
    }

    return { ...cfg, pin, pairToken };
  }

  function saveConfig({ renderUrl, deviceId, autoConnect, pin, pairToken }) {
    const cleanUrl = String(renderUrl || '').trim().replace(/\/+$/, '');
    const cfg = { renderUrl: cleanUrl, deviceId, autoConnect: Boolean(autoConnect) };
    try {
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
      if (pin !== undefined) writeVault(pinVaultPath, pin);
      if (pairToken !== undefined) writeVault(pairVaultPath, pairToken);
    } catch {}
  }

  function emitStatus(patch) {
    status = { ...status, ...patch };
    onStatusChange?.({ ...status });
  }

  function buildAuthHeaders(pin, pairToken) {
    return {
      ...(pin ? { 'x-app-pin': pin, 'x-relay-secret': pin } : {}),
      ...(pairToken ? { 'x-pair-token': pairToken } : {}),
    };
  }

  function postResult(renderUrl, pin, pairToken, payload) {
    return new Promise((resolve) => {
      try {
        const u = new URL(`${renderUrl}/api/relay/result`);
        const lib = u.protocol === 'https:' ? https : http;
        const body = JSON.stringify(payload);
        const req = lib.request(
          u,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              ...buildAuthHeaders(pin, pairToken),
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          }
        );
        req.on('error', () => resolve(0));
        req.write(body);
        req.end();
      } catch {
        resolve(0);
      }
    });
  }

  function scheduleReconnect(renderUrl, pin, pairToken, deviceId) {
    if (manualStop || reconnectTimer) return;
    const wait = backoffMs;
    backoffMs = Math.min(backoffMs * 1.5, 15000);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!manualStop) startStream(renderUrl, pin, pairToken, deviceId);
    }, wait);
  }

  function startStream(renderUrl, pin, pairToken, deviceId) {
    if (!renderUrl) return;
    if (activeReq) {
      try { activeReq.close?.(); } catch {}
      try { activeReq.destroy?.(); } catch {}
      activeReq = null;
    }

    let wsUrl;
    try {
      wsUrl = `${renderUrl}/api/relay/ws?deviceId=${encodeURIComponent(deviceId)}&hostname=${encodeURIComponent(osHostname)}`;
    } catch {
      emitStatus({ connected: false, connecting: false, lastError: 'Invalid Render URL' });
      return;
    }

    emitStatus({ connecting: true, enabled: true, renderUrl, deviceId, pairToken, lastError: '' });

    let fellBackToSse = false;
    const wsHandle = connectRelayWebSocket({
      urlStr: wsUrl,
      headers: buildAuthHeaders(pin, pairToken),
      onOpen: () => {
        backoffMs = 3000;
        emitStatus({ connected: true, connecting: false, transport: 'websocket', lastError: '', lastPingAt: Date.now() });
      },
      onMessage: (raw) => {
        emitStatus({ lastPingAt: Date.now() });
        try {
          const msg = JSON.parse(raw);
          if (msg.type === 'command' && msg.cmdId) {
            Promise.resolve()
              .then(() => onExecuteCommand(msg))
              .then((result) => {
                const sent = wsHandle.sendJson({ type: 'result', deviceId, cmdId: msg.cmdId, ok: true, result });
                if (!sent) postResult(renderUrl, pin, pairToken, { deviceId, cmdId: msg.cmdId, ok: true, result });
              })
              .catch((err) => {
                const errMsg = err?.message || String(err);
                const sent = wsHandle.sendJson({ type: 'result', deviceId, cmdId: msg.cmdId, ok: false, error: errMsg });
                if (!sent) postResult(renderUrl, pin, pairToken, { deviceId, cmdId: msg.cmdId, ok: false, error: errMsg });
              });
          }
        } catch {}
      },
      onAuthError: () => {
        manualStop = true;
        emitStatus({ connected: false, connecting: false, lastError: 'Unauthorized Relay (check Pair Key or Render PIN)' });
      },
      onClose: (code) => {
        if (manualStop) return;
        // Fall back seamlessly to SSE stream if an intermediate proxy rejects WebSocket upgrade
        if (!fellBackToSse && (code === 404 || code === 426 || code === 501 || code === 200)) {
          fellBackToSse = true;
          startSseFallback(renderUrl, pin, pairToken, deviceId);
          return;
        }
        emitStatus({ connected: false, connecting: false });
        scheduleReconnect(renderUrl, pin, pairToken, deviceId);
      },
      onError: () => {
        if (!manualStop && !fellBackToSse) {
          fellBackToSse = true;
          startSseFallback(renderUrl, pin, pairToken, deviceId);
        }
      },
    });
    activeReq = wsHandle;
  }

  function startSseFallback(renderUrl, pin, pairToken, deviceId) {
    if (!renderUrl || manualStop) return;
    let u;
    try {
      u = new URL(
        `${renderUrl}/api/relay/stream?deviceId=${encodeURIComponent(deviceId)}&hostname=${encodeURIComponent(osHostname)}`
      );
    } catch {
      emitStatus({ connected: false, connecting: false, lastError: 'Invalid Render URL' });
      return;
    }

    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      u,
      {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...buildAuthHeaders(pin, pairToken),
        },
      },
      (res) => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          res.resume();
          manualStop = true;
          emitStatus({
            connected: false,
            connecting: false,
            lastError: 'Unauthorized Relay (check Pair Key or Render PIN)',
          });
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          emitStatus({
            connected: false,
            connecting: false,
            lastError: `Server returned HTTP ${res.statusCode}`,
          });
          scheduleReconnect(renderUrl, pin, pairToken, deviceId);
          return;
        }

        backoffMs = 3000;
        emitStatus({ connected: true, connecting: false, lastError: '', lastPingAt: Date.now() });

        let buffer = '';
        let currentEvent = '';
        let currentData = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith(':')) {
              emitStatus({ lastPingAt: Date.now() });
            } else if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              currentData += (currentData ? '\n' : '') + line.slice(5).trim();
            } else if (line === '') {
              if (currentEvent === 'command' && currentData) {
                try {
                  const cmd = JSON.parse(currentData);
                  Promise.resolve()
                    .then(() => onExecuteCommand(cmd))
                    .then((result) =>
                      postResult(renderUrl, pin, pairToken, {
                        deviceId,
                        cmdId: cmd.cmdId,
                        ok: true,
                        result,
                      })
                    )
                    .catch((err) =>
                      postResult(renderUrl, pin, pairToken, {
                        deviceId,
                        cmdId: cmd.cmdId,
                        ok: false,
                        error: err?.message || String(err),
                      })
                    );
                } catch {}
              }
              currentEvent = '';
              currentData = '';
            }
          }
        });

        res.on('end', () => {
          emitStatus({ connected: false, connecting: false });
          scheduleReconnect(renderUrl, pin, pairToken, deviceId);
        });
      }
    );

    req.on('error', (err) => {
      emitStatus({ connected: false, connecting: false, lastError: err.message });
      scheduleReconnect(renderUrl, pin, pairToken, deviceId);
    });

    req.end();
    activeReq = req;
  }

  function connect({ renderUrl, pin, pairToken } = {}) {
    const saved = loadSavedConfig();
    const cleanUrl = String(renderUrl || saved.renderUrl || '').trim().replace(/\/+$/, '');
    const usePin = pin !== undefined ? String(pin).trim() : saved.pin;
    const usePairToken = pairToken !== undefined && String(pairToken).trim()
      ? String(pairToken).trim()
      : saved.pairToken;
    manualStop = false;
    backoffMs = 3000;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    saveConfig({
      renderUrl: cleanUrl,
      deviceId: saved.deviceId,
      autoConnect: true,
      pin: usePin,
      pairToken: usePairToken,
    });
    startStream(cleanUrl, usePin, usePairToken, saved.deviceId);
    return { ...status };
  }

  function regeneratePairToken() {
    const saved = loadSavedConfig();
    const nextToken = generatePairToken();
    saveConfig({ ...saved, pairToken: nextToken });
    emitStatus({ pairToken: nextToken });
    if (saved.autoConnect && saved.renderUrl) {
      startStream(saved.renderUrl, saved.pin, nextToken, saved.deviceId);
    }
    return { ...status };
  }

  function shutdown() {
    manualStop = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (activeReq) {
      try { activeReq.close?.(); } catch {}
      try { activeReq.destroy?.(); } catch {}
      activeReq = null;
    }
  }

  function disconnect() {
    shutdown();
    const saved = loadSavedConfig();
    saveConfig({ ...saved, autoConnect: false });
    emitStatus({ connected: false, connecting: false, enabled: false, lastError: '' });
    return { ...status };
  }

  function initAutoConnect() {
    const saved = loadSavedConfig();
    emitStatus({
      renderUrl: saved.renderUrl,
      deviceId: saved.deviceId,
      pairToken: saved.pairToken,
      enabled: saved.autoConnect,
    });
    if (saved.autoConnect && saved.renderUrl) {
      startStream(saved.renderUrl, saved.pin, saved.pairToken, saved.deviceId);
    }
  }

  function getStatus() {
    loadSavedConfig(); // ensure pairToken exists even before connecting
    const saved = loadSavedConfig();
    return { ...status, pairToken: status.pairToken || saved.pairToken, deviceId: status.deviceId || saved.deviceId };
  }

  return {
    connect,
    disconnect,
    regeneratePairToken,
    shutdown,
    initAutoConnect,
    getStatus,
  };
}

module.exports = { createCloudRelay, generatePairToken };
