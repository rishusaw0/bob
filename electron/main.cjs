const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  clipboard,
  desktopCapturer,
  Menu,
  Tray,
  globalShortcut,
  screen,
  safeStorage,
  session,
  Notification,
  powerMonitor,
} = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

const { createPermissionGuard } = require('./permission-guard.cjs');
const { createCloudRelay } = require('./cloud-relay.cjs');
const { createScheduler } = require('./pc-scheduler.cjs');
const { createPcActions } = require('./pc-actions.cjs');
const { getLanIPs, startBridgeServer } = require('./bridge-server.cjs');
const { createOfflineVoice } = require('./offline-voice.cjs');
const { createUpdater } = require('./updater.cjs');
const { createAutoLaunchManager, APP_MODEL_ID } = require('./auto-launch.cjs');
const { createMemoryStore } = require('./memory-store.cjs');
const { createSystemWatchdog } = require('./system-watchdog.cjs');
const { createWindowManager } = require('./window-manager.cjs');
const { createLocalBrainManager } = require('./local-brain.cjs');
const { createEpisodicMemory } = require('./episodic-memory.cjs');
const { evaluateElectronPermission } = require('./permission-policy.cjs');

let bridgeServer = null;
let permissionGuard = null;
let cloudRelay = null;
let pcScheduler = null;
let offlineVoice = null;
let appUpdater = null;
let autoLaunchManager = null;
let memoryStore = null;
let episodicMemory = null;
let systemWatchdog = null;
let lastWatchdogAlert = null;
let windowManager = null;
let localBrain = null;
const recentRuntimeErrors = [];

function recordRuntimeError(source, err) {
  try {
    const raw = err?.stack || err?.message || String(err || 'Unknown error');
    const redacted = raw
      .replace(/AIza[A-Za-z0-9_-]{12,}/g, '[REDACTED_KEY]')
      .replace(/JVA-[A-Z0-9-]+/g, '[REDACTED_TOKEN]')
      .slice(0, 300);
    recentRuntimeErrors.unshift({
      source: String(source || 'main'),
      message: redacted,
      at: new Date().toISOString(),
    });
    if (recentRuntimeErrors.length > 25) recentRuntimeErrors.length = 25;
  } catch {}
}

process.on('uncaughtException', (err) => {
  recordRuntimeError('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  recordRuntimeError('unhandledRejection', reason);
});

function resolveUnpackedPath(...parts) {
  const p = path.join(__dirname, ...parts);
  if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
    return p.replace('app.asar', 'app.asar.unpacked');
  }
  return p;
}

function emitRendererEvent(channel, payload) {
  try {
    const win = windowManager?.getMainWindow?.();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  } catch {}
}

function getAutoLaunchManager() {
  if (!autoLaunchManager) {
    autoLaunchManager = createAutoLaunchManager({
      app,
      shell,
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      argv: process.argv,
    });
  }
  return autoLaunchManager;
}

function getMemoryStore() {
  if (!memoryStore) {
    memoryStore = createMemoryStore({ userDataDir: app.getPath('userData') });
  }
  return memoryStore;
}

function getLocalBrain() {
  if (!localBrain) {
    localBrain = createLocalBrainManager({
      userDataDir: app.getPath('userData'),
      onProgress: (ev) => emitRendererEvent('brain:progress', ev),
    });
  }
  return localBrain;
}

function getEpisodicMemory() {
  if (!episodicMemory) {
    episodicMemory = createEpisodicMemory({ userDataDir: app.getPath('userData'), retentionDays: 90 });
  }
  return episodicMemory;
}

function getOrCreateBridgePin() {
  const pinPath = path.join(app.getPath('userData'), 'bridge-pin.txt');
  try {
    if (fs.existsSync(pinPath)) {
      const saved = fs.readFileSync(pinPath, 'utf-8').trim();
      if (/^\d{4}$/.test(saved)) return saved;
    }
  } catch {}
  const pin = String(crypto.randomInt(1000, 9999));
  try {
    fs.writeFileSync(pinPath, pin, 'utf-8');
  } catch {}
  return pin;
}

let pcActionKit;
function getScheduler() {
  if (pcScheduler) return pcScheduler;
  pcScheduler = createScheduler({
    userDataDir: app.getPath('userData'),
    NotificationClass: Notification,
    onFire: (item) => emitRendererEvent('scheduler:fired', item),
    onExecuteCommand: async (command) => await pcActionKit.actions.runCommand(command),
    onListUpdate: (items) => emitRendererEvent('scheduler:updated', items),
  });
  pcScheduler.init();
  return pcScheduler;
}

pcActionKit = createPcActions({
  shell,
  clipboard,
  desktopCapturer,
  screen,
  resolveUnpackedPath,
  getScheduler,
  getMemoryStore,
  emitRendererEvent,
  showClickReticle: (x, y, scale) => windowManager?.showClickReticle?.(x, y, scale),
});
const { actions } = pcActionKit;

windowManager = createWindowManager({
  app,
  BrowserWindow,
  Menu,
  Tray,
  screen,
  powerMonitor,
  actions,
  resolveUnpackedPath,
  getCloudRelay: () => cloudRelay,
  getAutoLaunchManager,
  emitRendererEvent,
  getWatchdogAlert: () => lastWatchdogAlert,
});

let pendingDeepLinkUrl = process.argv.find((a) => typeof a === 'string' && a.startsWith('jeeva://')) || null;

function handleDeepLink(rawUrl) {
  if (!rawUrl || !String(rawUrl).startsWith('jeeva://')) return;
  try {
    const u = new URL(rawUrl);
    if (u.hostname === 'connect' || u.pathname === '/connect') {
      const server = (u.searchParams.get('server') || '').trim();
      const pair = (u.searchParams.get('pair') || '').trim();
      const validServer = /^https?:\/\/[^/\s]+/i.test(server) ? server.replace(/\/+$/, '') : '';
      if (validServer && pair.length >= 12 && cloudRelay) {
        const relayStat = cloudRelay.connect({ renderUrl: validServer, pairToken: pair });
        const win = windowManager.getMainWindow();
        if (win && !win.isDestroyed()) {
          windowManager.applyWindowMode('full');
          emitRendererEvent('relay:deepLinked', { renderUrl: validServer, pairToken: pair, status: relayStat });
        }
      }
    }
  } catch {}
}

async function executeMacroStep(step) {
  if (!step || !step.type) return;
  switch (step.type) {
    case 'power_plan':
      return await actions.powerProfile(step.plan || 'balanced');
    case 'open_app':
      return await actions.openApp(step.app || 'notepad', step.args || '');
    case 'theme':
      return await actions.theme(step.mode || 'dark');
    case 'volume':
      return await actions.volume('set', Number(step.level ?? 50));
    case 'brightness':
      return await actions.brightness('set', Number(step.level ?? 50));
    case 'minimize_all':
      return await actions.minimizeAll();
    case 'file_pro':
      return await actions.filePro(step.action || 'organize_folder', step.source || 'downloads');
    case 'clean_temp':
      return await actions.filePro('clean_temp', '');
    case 'diagnostics':
      return await actions.diagnostics(step.action || 'overview', '');
    case 'run_command':
      return await actions.runCommand(step.command || '');
    default:
      return null;
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_, argv) => {
    const deepArg = argv.find((a) => typeof a === 'string' && a.startsWith('jeeva://'));
    if (deepArg) {
      handleDeepLink(deepArg);
    } else {
      const win = windowManager.getMainWindow();
      if (win && !win.isDestroyed()) windowManager.applyWindowMode('full');
    }
  });
}

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_MODEL_ID);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return evaluateElectronPermission({
      permission,
      origin: requestingOrigin || webContents?.getURL?.(),
      mediaTypes: details?.mediaType ? [details.mediaType] : null,
    });
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = evaluateElectronPermission({
      permission,
      origin: details?.requestingUrl || webContents?.getURL?.(),
      mediaTypes: details?.mediaTypes || null,
    });
    callback(allowed);
  });

  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('jeeva', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('jeeva');
  }

  const pin = getOrCreateBridgePin();
  permissionGuard = createPermissionGuard({
    userDataPath: app.getPath('userData'),
    BrowserWindow,
  });

  cloudRelay = createCloudRelay({
    userDataPath: app.getPath('userData'),
    safeStorage,
    osHostname: os.hostname(),
    onExecuteCommand: async (cmd) => {
      const fn = actions[cmd.action];
      if (!fn) throw new Error(`Unknown PC action: ${cmd.action}`);
      const actionArgs = Array.isArray(cmd.args) ? cmd.args : [];
      await permissionGuard.authorizeRemoteAction({
        action: cmd.action,
        args: actionArgs,
        sourceLabel: cmd.source || 'Render Cloud Relay',
      });
      return await fn(...actionArgs);
    },
    onStatusChange: (relayStat) => emitRendererEvent('relay:statusChanged', relayStat),
  });

  offlineVoice = createOfflineVoice({
    resolveUnpackedPath,
    onEvent: (ev) => emitRendererEvent('voice:offlineEvent', ev),
  });

  appUpdater = createUpdater({
    currentVersion: app.getVersion(),
    shell,
    onStatus: (st) => emitRendererEvent('updater:status', st),
  });

  bridgeServer = startBridgeServer({
    pin,
    actions,
    getPermissionGuard: () => permissionGuard,
    distDir: path.join(__dirname, '..', 'dist'),
  });

  const mainWin = windowManager.createWindow();
  windowManager.createNotchWindow();
  windowManager.setupTray();
  cloudRelay.initAutoConnect();

  const wPrefs = windowManager.getPrefs();
  if (mainWin && !mainWin.isVisible() && wPrefs.startupBehavior === 'notch_standby' && !wPrefs.notchUserHidden) {
    setTimeout(() => {
      windowManager.updateNotchState({ visible: true, standby: true, orbState: 'idle' });
    }, 350);
  }

  // Auto-enable background startup on first launch so JEEVA is always listening after PC boot
  try {
    const autoFlagPath = path.join(app.getPath('userData'), 'auto-launch-init.done');
    if (app.isPackaged && !fs.existsSync(autoFlagPath)) {
      getAutoLaunchManager().setEnabled(true);
      fs.writeFileSync(autoFlagPath, String(Date.now()), 'utf8');
    }
  } catch {}

  if (pendingDeepLinkUrl && mainWin) {
    mainWin.webContents.once('did-finish-load', () => {
      if (pendingDeepLinkUrl) {
        handleDeepLink(pendingDeepLinkUrl);
        pendingDeepLinkUrl = null;
      }
    });
  }

  for (const hk of ['Ctrl+Shift+Space', 'Alt+Shift+J', 'Alt+Space']) {
    try {
      globalShortcut.register(hk, () => windowManager.wakeCortanaOverlay());
    } catch {}
  }

  const vaultPath = path.join(app.getPath('userData'), 'api-key.vault');
  ipcMain.handle('vault:saveKey', (_, key) => {
    if (!key) {
      if (fs.existsSync(vaultPath)) fs.unlinkSync(vaultPath);
      return true;
    }
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(vaultPath, safeStorage.encryptString(String(key)));
      return true;
    }
    return false;
  });
  ipcMain.handle('vault:getKey', () => {
    try {
      if (fs.existsSync(vaultPath) && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(fs.readFileSync(vaultPath));
      }
    } catch {}
    return '';
  });

  ipcMain.handle('bridge:info', () => ({ port: 51823, pin, ips: getLanIPs() }));

  ipcMain.handle('permissions:sync', (_, rules) => permissionGuard.saveRules(rules));
  ipcMain.handle('permissions:get', () => permissionGuard.getRules());
  ipcMain.handle('permissions:auditGet', () => permissionGuard.getAuditLog());
  ipcMain.handle('permissions:auditClear', () => permissionGuard.clearAuditLog());

  ipcMain.handle('relay:connect', (_, cfg) => cloudRelay.connect(cfg || {}));
  ipcMain.handle('relay:disconnect', () => cloudRelay.disconnect());
  ipcMain.handle('relay:regeneratePairToken', () => cloudRelay.regeneratePairToken());
  ipcMain.handle('relay:status', () => cloudRelay.getStatus());

  ipcMain.handle('app:getAutoLaunch', () => getAutoLaunchManager().isEnabled());
  ipcMain.handle('app:setAutoLaunch', (_, enabled) => {
    const res = getAutoLaunchManager().setEnabled(Boolean(enabled));
    return Boolean(res.enabled);
  });

  ipcMain.handle('voice:offlineStart', (_, aiName) => offlineVoice.start(aiName));
  ipcMain.handle('voice:offlineStop', () => offlineVoice.stop());
  ipcMain.handle('voice:offlineSetName', (_, aiName) => offlineVoice.setAiName(aiName));
  ipcMain.handle('voice:offlineStatus', () => offlineVoice.getStatus());
  ipcMain.handle('voice:offlineDictate', (_, timeoutSec) => offlineVoice.dictateOnce(timeoutSec || 7));
  ipcMain.handle('voice:offlineTranscribe', (_, wavBase64, opts) => offlineVoice.transcribeAudioBase64(wavBase64, opts));

  ipcMain.handle('updater:check', (_, cfg) => appUpdater.checkForUpdates(cfg || {}));
  ipcMain.handle('updater:download', (_, url) => appUpdater.downloadAndInstall(url));
  ipcMain.handle('updater:getState', () => appUpdater.getState());

  ipcMain.handle('brain:status', () => getLocalBrain().getStatus());
  ipcMain.handle('brain:setup', (_, action, payload) => getLocalBrain().setup(action, payload));
  ipcMain.handle('brain:stop', () => getLocalBrain().stopSidecar());
  ipcMain.handle('brain:chat', (_, opts) => getLocalBrain().chat(opts || {}));

  ipcMain.handle('episodic:log', (_, entry) => getEpisodicMemory().logTurn(entry || {}));
  ipcMain.handle('episodic:query', (_, filters) => getEpisodicMemory().queryTimeline(filters || {}));
  ipcMain.handle('episodic:summaries', (_, days) => getEpisodicMemory().getDailySummaries(days));
  ipcMain.handle('episodic:forgetDay', (_, dateKey) => getEpisodicMemory().forgetDay(dateKey));
  ipcMain.handle('episodic:clear', () => getEpisodicMemory().clearAll());

  pcActionKit.startClipboardWatcher();
  getScheduler();
  getMemoryStore();
  getEpisodicMemory();
  systemWatchdog = createSystemWatchdog({
    actions,
    NotificationClass: Notification,
    onAlert: (alert) => {
      lastWatchdogAlert = alert;
      emitRendererEvent('watchdog:alert', alert);
    },
  });
  systemWatchdog.start();
});

app.on('will-quit', () => {
  windowManager?.disposeTray?.();
  systemWatchdog?.stop?.();
  localBrain?.stopSidecar?.();
  episodicMemory?.close?.();
  pcActionKit.stopClipboardWatcher();
  pcScheduler?.dispose?.();
  offlineVoice?.stop?.();
  globalShortcut.unregisterAll();
  cloudRelay?.shutdown?.();
  bridgeServer?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && (!cloudRelay?.getStatus?.().enabled || app.isQuitting)) {
    bridgeServer?.close();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) windowManager.createWindow();
});

// System Action IPCs
ipcMain.handle('system:openApp', (_, appName, appArgs) => actions.openApp(appName, appArgs));
ipcMain.handle('system:openURL', (_, url) => actions.openURL(url));
ipcMain.handle('system:openSetting', (_, s) => actions.openSetting(s));
ipcMain.handle('system:theme', (_, m) => actions.theme(m));
ipcMain.handle('system:battery', () => actions.battery());
ipcMain.handle('system:wifi', (_, m) => actions.wifi(m));
ipcMain.handle('system:runCommand', (_, cmd) => actions.runCommand(cmd));
ipcMain.handle('system:readFile', (_, p) => actions.readFile(p));
ipcMain.handle('system:readBinaryFile', (_, p) => actions.readBinaryFile(p));
ipcMain.handle('system:extractDocText', (_, payload) => actions.extractDocText(payload));
ipcMain.handle('system:writeFile', (_, p, c) => actions.writeFile(p, c));
ipcMain.handle('system:listFiles', (_, d) => actions.listFiles(d));
ipcMain.handle('system:searchFiles', (_, q, d) => actions.searchFiles(q, d));
ipcMain.handle('system:deleteFile', (_, p) => actions.deleteFile(p));
ipcMain.handle('system:clipboard', (_, a, t) => actions.clipboard(a, t));
ipcMain.handle('system:info', () => actions.systemInfo());
ipcMain.handle('system:screenshot', (_, opts) => actions.screenshot(opts));
ipcMain.handle('system:volume', (_, a, l) => actions.volume(a, l));
ipcMain.handle('system:media', (_, a) => actions.media(a));
ipcMain.handle('system:brightness', (_, a, l) => actions.brightness(a, l));
ipcMain.handle('system:power', (_, a) => actions.power(a));
ipcMain.handle('system:runningApps', () => actions.runningApps());
ipcMain.handle('system:closeApp', (_, n) => actions.closeApp(n));
ipcMain.handle('system:typeText', (_, t) => actions.typeText(t));
ipcMain.handle('system:minimizeAll', () => actions.minimizeAll());
ipcMain.handle('system:saveDesktopFile', (_, f, c) => actions.saveDesktopFile(f, c));
ipcMain.handle('system:saveImage', (_, d, f) => actions.saveImage(d, f));
ipcMain.handle('system:liveStats', () => actions.liveStats());
ipcMain.handle('system:adbControl', (_, a, arg) => actions.adbControl(a, arg));
ipcMain.handle('system:listInstalledApps', (_, filter) => actions.listInstalledApps(filter));
ipcMain.handle('system:manageSoftware', (_, action, pkg) => actions.manageSoftware(action, pkg));
ipcMain.handle('system:windowControl', (_, action, targetApp) => actions.windowControl(action, targetApp));
ipcMain.handle('system:uiAutomate', (_, action, appName, element, value) =>
  actions.uiAutomate(action, appName, element, value)
);
ipcMain.handle('system:screenRead', (_, mode, targetText) =>
  actions.screenRead(mode, targetText)
);
ipcMain.handle('system:mouseAction', (_, sub, x, y, x2, y2, delta, coordSpace) =>
  actions.mouseAction(sub, x, y, x2, y2, delta, coordSpace)
);
ipcMain.handle('system:sendHotkey', (_, combo) => actions.sendHotkey(combo));
ipcMain.handle('system:typeClipboard', (_, text) => actions.typeClipboard(text));
ipcMain.handle('system:diagnostics', (_, sub, extra) => actions.diagnostics(sub, extra));
ipcMain.handle('system:manageProcess', (_, sub, target) => actions.manageProcess(sub, target));
ipcMain.handle('system:filePro', (_, sub, source, dest) => actions.filePro(sub, source, dest));
ipcMain.handle('system:powerProfile', (_, plan) => actions.powerProfile(plan));
ipcMain.handle('system:emptyRecycleBin', () => actions.emptyRecycleBin());
ipcMain.handle('system:browserControl', (_, sub, value) => actions.browserControl(sub, value));
ipcMain.handle('clipboard:history', (_, sub, index) => actions.clipboardHistory(sub, index));
ipcMain.handle('scheduler:manage', (_, sub, arg1, arg2, arg3) => actions.scheduler(sub, arg1, arg2, arg3));
ipcMain.handle('memory:rag', (_, sub, contentOrQuery, category) => actions.memoryRag(sub, contentOrQuery, category));
ipcMain.handle('macros:manage', async (_, sub, payload, stats) => {
  const sched = getScheduler();
  const clean = String(sub || 'list').toLowerCase();
  if (clean === 'save') return { ok: true, macro: sched.saveMacro(payload) };
  if (clean === 'delete') return sched.deleteMacro(String(payload || ''));
  if (clean === 'dry_run') return sched.dryRunMacro(payload, stats || (await actions.liveStats().catch(() => ({}))));
  if (clean === 'run') {
    const macro = typeof payload === 'string'
      ? sched.getAllMacros().find((m) => m.id === payload)
      : payload;
    if (!macro) throw new Error('Workflow not found');
    const results = [];
    for (const step of macro.steps || []) {
      results.push(await executeMacroStep(step));
    }
    return { ok: true, ran: macro.name, results };
  }
  return { macros: sched.getAllMacros() };
});

ipcMain.handle('window:minimize', () => windowManager.getMainWindow()?.minimize());
ipcMain.handle('window:maximize', () => {
  const win = windowManager.getMainWindow();
  if (win?.isMaximized()) win.unmaximize();
  else win?.maximize();
});
ipcMain.handle('window:close', () => windowManager.getMainWindow()?.close());
ipcMain.handle('window:setMode', (_, mode) => {
  windowManager.applyWindowMode(mode);
  return windowManager.getCurrentMode();
});
ipcMain.handle('window:wakeRestore', (_, preferredMode = 'notch') => windowManager.wakeRestore(preferredMode));
ipcMain.handle('window:hideToTray', () => windowManager.getMainWindow()?.hide());
ipcMain.handle('notch:update', (_, state) => {
  if (!state || typeof state !== 'object') return false;
  return windowManager.updateNotchState(state);
});
ipcMain.handle('notch:action', (_, action, payload = '') => {
  const act = String(action || '').toLowerCase();
  if (act === 'hide') {
    windowManager.setNotchUserHidden(true);
    emitRendererEvent('notch:event', { action: 'hide' });
    return { ok: true };
  }
  if (act === 'show') {
    windowManager.setNotchUserHidden(false);
    windowManager.updateNotchState({ visible: true, standby: true, orbState: 'idle' }, { explicitShow: true });
    return { ok: true };
  }
  if (act === 'open_chat') {
    windowManager.setNotchUserHidden(false);
    windowManager.updateNotchState({ visible: false, standby: false }, { force: true });
    windowManager.applyWindowMode('full');
    return { ok: true };
  }
  if (act === 'open_dashboard') {
    windowManager.setNotchUserHidden(false);
    windowManager.updateNotchState({ visible: false, standby: false }, { force: true });
    windowManager.applyWindowMode('full');
    setTimeout(() => emitRendererEvent('ui:openPcControl', 'system'), 120);
    return { ok: true };
  }
  if (act === 'toggle_mic') {
    emitRendererEvent('notch:event', { action: 'toggle_mic' });
    return { ok: true };
  }
  if (act === 'send_text' && String(payload || '').trim()) {
    emitRendererEvent('notch:event', { action: 'send_text', text: String(payload).trim().slice(0, 2000) });
    return { ok: true };
  }
  return { ok: false };
});
ipcMain.handle('window:getPrefs', () => windowManager.getPrefs());
ipcMain.handle('window:savePrefs', (_, patch) => {
  if (!patch || typeof patch !== 'object') return windowManager.getPrefs();
  const next = windowManager.savePrefs(patch);
  if (patch.startupBehavior === 'disabled') {
    try { getAutoLaunchManager().setEnabled(false); } catch {}
  } else if (patch.startupBehavior) {
    try { getAutoLaunchManager().setEnabled(true); } catch {}
  }
  windowManager.repositionNotch();
  return next;
});
ipcMain.handle('window:getDisplays', () => windowManager.getDisplays());

ipcMain.handle('app:emergencyStop', () => {
  try { offlineVoice?.stop?.(); } catch {}
  try { localBrain?.stopSidecar?.(); } catch {}
  emitRendererEvent('app:emergencyStop', { at: Date.now() });
  return { ok: true, stoppedAt: new Date().toISOString() };
});

ipcMain.handle('app:getDiagnostics', async () => {
  const totalMemMb = Math.round(os.totalmem() / 1048576);
  const freeMemMb = Math.round(os.freemem() / 1048576);
  let brainInfo = null;
  try { brainInfo = await localBrain?.getStatus?.(); } catch {}
  let schedItems = [];
  try { schedItems = getScheduler().listAll?.() || []; } catch {}
  return {
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus()?.length || 0,
    totalMemMb,
    freeMemMb,
    usedMemPct: totalMemMb > 0 ? Math.round(((totalMemMb - freeMemMb) / totalMemMb) * 100) : 0,
    offlineVoice: offlineVoice?.getStatus?.() || null,
    localBrain: brainInfo,
    autoLaunch: getAutoLaunchManager().getStatus?.() || false,
    cloudRelay: cloudRelay?.getStatus?.() || { enabled: false, connected: false },
    schedulerCount: schedItems.length,
    recentErrors: recentRuntimeErrors.slice(0, 10),
    generatedAt: new Date().toISOString(),
  };
});
