import { isStrictOfflineMode } from './offlineMode.js';

// Unified System Control Bridge:
// 1. Electron IPC on PC
// 2. Direct LAN / Tunnel HTTP Bridge (/api/pc/*)
// 3. Multi-User Isolated Render Cloud Relay (/api/relay/* via x-pair-token or x-app-token)

const BRIDGE_PIN_KEY = 'jeeva_bridge_pin';
const BRIDGE_HOST_KEY = 'jeeva_bridge_host';
const BRIDGE_URL_KEY = 'jeeva_bridge_url';
const RELAY_DEVICE_KEY = 'jeeva_relay_device_id';
const RELAY_HOST_KEY = 'jeeva_relay_hostname';
const APP_TOKEN_KEY = 'jeeva_app_token';
const PAIR_TOKEN_KEY = 'jeeva_pair_token';

let cachedRelayDevices = [];

export function isDesktopElectron() {
  return Boolean(window.electronAPI);
}

export function getPairToken() {
  return (localStorage.getItem(PAIR_TOKEN_KEY) || '').trim();
}

export function setPairToken(token) {
  const clean = String(token || '').trim();
  if (clean) {
    localStorage.setItem(PAIR_TOKEN_KEY, clean);
  } else {
    localStorage.removeItem(PAIR_TOKEN_KEY);
  }
  return clean;
}

export function createPairToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  let raw = '';
  for (let i = 0; i < 12; i++) raw += chars[bytes[i] % chars.length];
  const token = `JVA-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  setPairToken(token);
  return token;
}

export function getAuthHeaders() {
  const token = localStorage.getItem(APP_TOKEN_KEY) || '';
  const pairToken = getPairToken();
  return {
    ...(token ? { 'x-app-token': token } : {}),
    ...(pairToken ? { 'x-pair-token': pairToken } : {}),
  };
}

export function getPairedPin() {
  return localStorage.getItem(BRIDGE_PIN_KEY) || '';
}

export function getPairedHost() {
  return localStorage.getItem(BRIDGE_HOST_KEY) || '';
}

export function getBridgeBaseUrl() {
  const raw = (localStorage.getItem(BRIDGE_URL_KEY) || '').trim();
  return raw.replace(/\/+$/, '');
}

export function setBridgeBaseUrl(url) {
  const cleaned = String(url || '').trim().replace(/\/+$/, '');
  if (cleaned) {
    localStorage.setItem(BRIDGE_URL_KEY, cleaned);
  } else {
    localStorage.removeItem(BRIDGE_URL_KEY);
  }
  return cleaned;
}

export function getSelectedRelayDevice() {
  return {
    deviceId: localStorage.getItem(RELAY_DEVICE_KEY) || '',
    hostname: localStorage.getItem(RELAY_HOST_KEY) || '',
  };
}

export function setSelectedRelayDevice(deviceId, hostname = '') {
  if (deviceId) {
    localStorage.setItem(RELAY_DEVICE_KEY, deviceId);
    if (hostname) localStorage.setItem(RELAY_HOST_KEY, hostname);
  } else {
    localStorage.removeItem(RELAY_DEVICE_KEY);
    localStorage.removeItem(RELAY_HOST_KEY);
  }
}

export async function refreshRenderRelayDevices() {
  if (isDesktopElectron() || isStrictOfflineMode()) return [];
  try {
    const res = await fetch('/api/relay/devices', {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return [];
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return [];
    const data = await res.json();
    const list = Array.isArray(data.devices) ? data.devices : [];
    cachedRelayDevices = list;
    if (list.length > 0 && !localStorage.getItem(RELAY_DEVICE_KEY)) {
      setSelectedRelayDevice(list[0].deviceId, list[0].hostname);
    }
    return list;
  } catch {
    return [];
  }
}

function bridgeEndpoint(path, overrideBaseUrl) {
  const base =
    overrideBaseUrl !== undefined
      ? String(overrideBaseUrl || '').trim().replace(/\/+$/, '')
      : getBridgeBaseUrl();
  return base ? `${base}${path}` : path;
}

export function disconnectPhoneBridge() {
  localStorage.removeItem(BRIDGE_PIN_KEY);
  localStorage.removeItem(BRIDGE_HOST_KEY);
}

export async function checkPCBridgeOnline(overrideBaseUrl) {
  try {
    const res = await fetch(bridgeEndpoint('/api/pc/info', overrideBaseUrl));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function pairWithPC(pin, overrideBaseUrl) {
  if (overrideBaseUrl !== undefined) {
    setBridgeBaseUrl(overrideBaseUrl);
  }
  const res = await fetch(bridgeEndpoint('/api/pc/pair', overrideBaseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: String(pin).trim() }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Pairing failed');
  }
  localStorage.setItem(BRIDGE_PIN_KEY, String(pin).trim());
  if (data.hostname) localStorage.setItem(BRIDGE_HOST_KEY, data.hostname);
  return data;
}

async function callRemoteAction(action, args = []) {
  const pin = getPairedPin();

  // Route 1: Direct LAN / Custom Tunnel Bridge (if paired via 4-digit PIN)
  if (pin) {
    try {
      const res = await fetch(bridgeEndpoint('/api/pc/action'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeeva-pin': pin,
        },
        body: JSON.stringify({ action, args }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Remote PC command failed');
      }
      return data.result;
    } catch (lanErr) {
      if (!getSelectedRelayDevice().deviceId && cachedRelayDevices.length === 0) {
        throw lanErr;
      }
    }
  }

  // Route 2: Multi-User Isolated Render Cloud Relay (/api/relay/execute)
  if (isStrictOfflineMode()) {
    throw new Error('Render Cloud Relay blocked: Strict Offline Mode is enabled.');
  }
  const deviceId = getSelectedRelayDevice().deviceId || cachedRelayDevices[0]?.deviceId || '';
  const res = await fetch('/api/relay/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ deviceId: deviceId || undefined, action, args }),
  });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error('PC connected nahi hai. PC app install karke Pair Key connect karein.');
  }
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Render Cloud Relay command failed');
  }
  return data.result;
}

export function getSystemAPI() {
  if (window.electronAPI) return window.electronAPI;
  const hasRemote = Boolean(
    getPairedPin() || getPairToken() || getSelectedRelayDevice().deviceId || cachedRelayDevices.length > 0
  );
  if (!hasRemote) return null;

  return {
    openApp: (appName, args = '') => callRemoteAction('openApp', [appName, args]),
    openURL: (url) => callRemoteAction('openURL', [url]),
    openSetting: (s) => callRemoteAction('openSetting', [s]),
    theme: (m) => callRemoteAction('theme', [m]),
    battery: () => callRemoteAction('battery', []),
    wifi: (m) => callRemoteAction('wifi', [m]),
    runCommand: (cmd) => callRemoteAction('runCommand', [cmd]),
    readFile: (p) => callRemoteAction('readFile', [p]),
    readBinaryFile: (p) => callRemoteAction('readBinaryFile', [p]),
    extractDocText: (payload) => callRemoteAction('extractDocText', [payload]),
    writeFile: (p, c) => callRemoteAction('writeFile', [p, c]),
    listFiles: (d) => callRemoteAction('listFiles', [d]),
    searchFiles: (q, d) => callRemoteAction('searchFiles', [q, d]),
    deleteFile: (p) => callRemoteAction('deleteFile', [p]),
    clipboard: (a, t) => callRemoteAction('clipboard', [a, t]),
    systemInfo: () => callRemoteAction('systemInfo', []),
    screenshot: () => callRemoteAction('screenshot', []),
    volume: (a, l) => callRemoteAction('volume', [a, l]),
    media: (a) => callRemoteAction('media', [a]),
    brightness: (a, l) => callRemoteAction('brightness', [a, l]),
    power: (a) => callRemoteAction('power', [a]),
    runningApps: () => callRemoteAction('runningApps', []),
    closeApp: (n) => callRemoteAction('closeApp', [n]),
    typeText: (t) => callRemoteAction('typeText', [t]),
    minimizeAll: () => callRemoteAction('minimizeAll', []),
    saveDesktopFile: (f, c) => callRemoteAction('saveDesktopFile', [f, c]),
    adbControl: (a, arg) => callRemoteAction('adbControl', [a, arg]),
    listInstalledApps: (filter) => callRemoteAction('listInstalledApps', [filter]),
    manageSoftware: (action, pkg) => callRemoteAction('manageSoftware', [action, pkg]),
    windowControl: (action, targetApp) => callRemoteAction('windowControl', [action, targetApp]),
    uiAutomate: (action, appName, element, value) =>
      callRemoteAction('uiAutomate', [action, appName, element, value]),
    screenRead: (mode, targetText) => callRemoteAction('screenRead', [mode, targetText]),
    browserControl: (sub, value) => callRemoteAction('browserControl', [sub, value]),
    mouseAction: (sub, x, y, x2, y2, delta, coordSpace) =>
      callRemoteAction('mouseAction', [sub, x, y, x2, y2, delta, coordSpace]),
    sendHotkey: (combo) => callRemoteAction('sendHotkey', [combo]),
    typeClipboard: (text) => callRemoteAction('typeClipboard', [text]),
    diagnostics: (sub, extra) => callRemoteAction('diagnostics', [sub, extra]),
    manageProcess: (sub, target) => callRemoteAction('manageProcess', [sub, target]),
    filePro: (sub, source, dest) => callRemoteAction('filePro', [sub, source, dest]),
    powerProfile: (plan) => callRemoteAction('powerProfile', [plan]),
    emptyRecycleBin: () => callRemoteAction('emptyRecycleBin', []),
    clipboardHistory: (sub, index) => callRemoteAction('clipboardHistory', [sub, index]),
    scheduler: (sub, arg1, arg2, arg3) => callRemoteAction('scheduler', [sub, arg1, arg2, arg3]),
    memoryRag: (sub, contentOrQuery, category) =>
      callRemoteAction('memoryRag', [sub, contentOrQuery, category]),
  };
}

export async function createTimedShareToken({ baseUrl = '', pairToken = '', ttlMinutes = 60, scope = 'full' } = {}) {
  const origin = String(baseUrl || '').trim().replace(/\/+$/, '');
  const endpoint = origin ? `${origin}/api/relay/share-token` : '/api/relay/share-token';
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...(pairToken ? { 'x-pair-token': pairToken } : {}),
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ttlMinutes, scope }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Failed to generate temporary share link');
  }
  return data;
}

// Native mobile browser / PWA actions (work directly on Phone without PC)
export async function executeMobileBrowserAction(action, value = '') {
  switch (action) {
    case 'battery': {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        return `Phone Battery: ${Math.round(b.level * 100)}% (${b.charging ? 'Charging' : 'On Battery'})`;
      }
      return 'Battery API not supported by this mobile browser.';
    }
    case 'vibrate': {
      if (navigator.vibrate) {
        navigator.vibrate([150, 80, 150]);
        return 'Phone vibrated.';
      }
      return 'Vibration not supported on this device.';
    }
    case 'open_whatsapp': {
      const num = String(value || '').replace(/[^\d+]/g, '');
      const url = num ? `https://wa.me/${num}` : 'https://wa.me/';
      window.open(url, '_blank');
      return `Opened WhatsApp link: ${url}`;
    }
    case 'dial_number': {
      const num = String(value || '').replace(/[^\d+]/g, '');
      window.location.href = `tel:${num}`;
      return `Opening dialer for ${num}`;
    }
    case 'open_link': {
      window.open(value, '_blank');
      return `Opened link: ${value}`;
    }
    default:
      return `Unknown mobile action: ${action}`;
  }
}
