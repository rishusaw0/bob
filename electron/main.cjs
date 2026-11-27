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
} = require('electron');
const path = require('path');
const fs = require('fs');

const { createPermissionGuard } = require('./permission-guard.cjs');
const { createScheduler } = require('./pc-scheduler.cjs');
const { createPcActions } = require('./pc-actions.cjs');
const { createOfflineVoice } = require('./offline-voice.cjs');
const { createUpdater } = require('./updater.cjs');
const { createAutoLaunchManager, APP_MODEL_ID } = require('./auto-launch.cjs');
const { createMemoryStore } = require('./memory-store.cjs');
const { createSystemWatchdog } = require('./system-watchdog.cjs');
const { createWindowManager } = require('./window-manager.cjs');
const { createLocalBrainManager } = require('./local-brain.cjs');
const { createEpisodicMemory } = require('./episodic-memory.cjs');

let permissionGuard = null;
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

function isTrustedRendererUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''));
    if (u.protocol === 'file:') {
      const filePath = decodeURIComponent(u.pathname).replace(/\\/g, '/').toLowerCase();
      return filePath.includes('/dist/') || filePath.endsWith('/electron/notch-overlay.html') || filePath.endsWith('/notch-overlay.html');
    }
    if (!app.isPackaged && (u.protocol === 'http:' || u.protocol === 'https:')) {
      return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && Number(u.port || (u.protocol === 'https:' ? 443 : 80)) === 5173;
    }
  } catch {}
  return false;
}

function registerSecureIpcHandler(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    const frame = event.senderFrame;
    const senderUrl = frame?.url || event.sender?.getURL?.() || '';
    if (frame && event.sender?.mainFrame && frame !== event.sender.mainFrame) {
      throw new Error('IPC is only available to the main application frame.');
    }
    if (!isTrustedRendererUrl(senderUrl)) {
      throw new Error('Untrusted renderer blocked from accessing desktop capabilities.');
    }
    return handler(event, ...args);
  });
}

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
  shell,
  BrowserWindow,
  Menu,
  Tray,
  screen,
  actions,
  resolveUnpackedPath,
  getAutoLaunchManager,
  emitRendererEvent,
  getWatchdogAlert: () => lastWatchdogAlert,
});

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
  app.on('second-instance', () => {
    const win = windowManager.getMainWindow();
    if (win && !win.isDestroyed()) windowManager.applyWindowMode('full');
  });
}

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_MODEL_ID);
}

app.whenReady().then(() => {
  const isTrustedRendererOrigin = (_originUrl, webContents) =>
    isTrustedRendererUrl(webContents?.getURL?.() || _originUrl);
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission !== 'media' && permission !== 'audioCapture') return false;
    return isTrustedRendererOrigin('', webContents);
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = (permission === 'media' || permission === 'audioCapture') &&
      isTrustedRendererOrigin('', webContents);
    callback(allowed);
  });

  permissionGuard = createPermissionGuard({  permissionGuard = createPermissionGuard({
    userDataPath: app.getPath('userData'),
    BrowserWindow,
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

  const mainWin = windowManager.createWindow();
  windowManager.createNotchWindow();
  windowManager.setupTray();

  if (mainWin && !mainWin.isVisible()) {
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

  for (const hk of ['Ctrl+Shift+Space', 'Alt+Shift+J', 'Alt+Space']) {
    try {
      globalShortcut.register(hk, () => windowManager.wakeCortanaOverlay());
    } catch {}
  }

  const vaultPath = path.join(app.getPath('userData'), 'api-key.vault');
  registerSecureIpcHandler('vault:saveKey', (_, key) => {
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
  registerSecureIpcHandler('vault:getKey', () => {
    try {
      if (fs.existsSync(vaultPath) && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(fs.readFileSync(vaultPath));
      }
    } catch {}
    return '';
  });

  registerSecureIpcHandler('permissions:sync', (_, rules) => permissionGuard.saveRules(rules));
  registerSecureIpcHandler('permissions:get', () => permissionGuard.getRules());
  registerSecureIpcHandler('permissions:auditGet', () => permissionGuard.getAuditLog());
  registerSecureIpcHandler('permissions:auditClear', () => permissionGuard.clearAuditLog());


  registerSecureIpcHandler('app:getAutoLaunch', () => getAutoLaunchManager().isEnabled());
  registerSecureIpcHandler('app:setAutoLaunch', (_, enabled) => {
    const res = getAutoLaunchManager().setEnabled(Boolean(enabled));
    return Boolean(res.enabled);
  });

  registerSecureIpcHandler('voice:offlineStart', (_, aiName) => offlineVoice.start(aiName));
  registerSecureIpcHandler('voice:offlineStop', () => offlineVoice.stop());
  registerSecureIpcHandler('voice:offlineSetName', (_, aiName) => offlineVoice.setAiName(aiName));
  registerSecureIpcHandler('voice:offlineStatus', () => offlineVoice.getStatus());
  registerSecureIpcHandler('voice:offlineDictate', (_, timeoutSec) => offlineVoice.dictateOnce(timeoutSec || 7));

  registerSecureIpcHandler('updater:check', (_, cfg) => appUpdater.checkForUpdates(cfg || {}));
  registerSecureIpcHandler('updater:download', (_, url) => appUpdater.downloadAndInstall(url));
  registerSecureIpcHandler('updater:getState', () => appUpdater.getState());

  registerSecureIpcHandler('brain:status', () => getLocalBrain().getStatus());
  registerSecureIpcHandler('brain:setup', (_, action, payload) => getLocalBrain().setup(action, payload));
  registerSecureIpcHandler('brain:stop', () => getLocalBrain().stopSidecar());
  registerSecureIpcHandler('brain:chat', (_, opts) => getLocalBrain().chat(opts || {}));

  registerSecureIpcHandler('episodic:log', (_, entry) => getEpisodicMemory().logTurn(entry || {}));
  registerSecureIpcHandler('episodic:query', (_, filters) => getEpisodicMemory().queryTimeline(filters || {}));
  registerSecureIpcHandler('episodic:summaries', (_, days) => getEpisodicMemory().getDailySummaries(days));
  registerSecureIpcHandler('episodic:forgetDay', (_, dateKey) => getEpisodicMemory().forgetDay(dateKey));
  registerSecureIpcHandler('episodic:clear', () => getEpisodicMemory().clearAll());

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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) windowManager.createWindow();
});

// System Action IPCs
registerSecureIpcHandler('system:openApp', (_, appName, appArgs) => actions.openApp(appName, appArgs));
registerSecureIpcHandler('system:openURL', (_, url) => actions.openURL(url));
registerSecureIpcHandler('system:openSetting', (_, s) => actions.openSetting(s));
registerSecureIpcHandler('system:theme', (_, m) => actions.theme(m));
registerSecureIpcHandler('system:battery', () => actions.battery());
registerSecureIpcHandler('system:wifi', (_, m) => actions.wifi(m));
registerSecureIpcHandler('system:runCommand', (_, cmd) => actions.runCommand(cmd));
registerSecureIpcHandler('system:readFile', (_, p) => actions.readFile(p));
registerSecureIpcHandler('system:readBinaryFile', (_, p) => actions.readBinaryFile(p));
registerSecureIpcHandler('system:extractDocText', (_, payload) => actions.extractDocText(payload));
registerSecureIpcHandler('system:writeFile', (_, p, c) => actions.writeFile(p, c));
registerSecureIpcHandler('system:listFiles', (_, d) => actions.listFiles(d));
registerSecureIpcHandler('system:searchFiles', (_, q, d) => actions.searchFiles(q, d));
registerSecureIpcHandler('system:deleteFile', (_, p) => actions.deleteFile(p));
registerSecureIpcHandler('system:clipboard', (_, a, t) => actions.clipboard(a, t));
registerSecureIpcHandler('system:info', () => actions.systemInfo());
registerSecureIpcHandler('system:screenshot', (_, opts) => actions.screenshot(opts));
registerSecureIpcHandler('system:volume', (_, a, l) => actions.volume(a, l));
registerSecureIpcHandler('system:media', (_, a) => actions.media(a));
registerSecureIpcHandler('system:brightness', (_, a, l) => actions.brightness(a, l));
registerSecureIpcHandler('system:power', (_, a) => actions.power(a));
registerSecureIpcHandler('system:runningApps', () => actions.runningApps());
registerSecureIpcHandler('system:closeApp', (_, n) => actions.closeApp(n));
registerSecureIpcHandler('system:typeText', (_, t) => actions.typeText(t));
registerSecureIpcHandler('system:minimizeAll', () => actions.minimizeAll());
registerSecureIpcHandler('system:saveDesktopFile', (_, f, c) => actions.saveDesktopFile(f, c));
registerSecureIpcHandler('system:saveImage', (_, d, f) => actions.saveImage(d, f));
registerSecureIpcHandler('system:liveStats', () => actions.liveStats());
registerSecureIpcHandler('system:listInstalledApps', (_, filter) => actions.listInstalledApps(filter));
registerSecureIpcHandler('system:manageSoftware', (_, action, pkg) => actions.manageSoftware(action, pkg));
registerSecureIpcHandler('system:windowControl', (_, action, targetApp) => actions.windowControl(action, targetApp));
registerSecureIpcHandler('system:uiAutomate', (_, action, appName, element, value) =>
  actions.uiAutomate(action, appName, element, value)
);
registerSecureIpcHandler('system:screenRead', (_, mode, targetText) =>
  actions.screenRead(mode, targetText)
);
registerSecureIpcHandler('system:mouseAction', (_, sub, x, y, x2, y2, delta, coordSpace) =>
  actions.mouseAction(sub, x, y, x2, y2, delta, coordSpace)
);
registerSecureIpcHandler('system:sendHotkey', (_, combo) => actions.sendHotkey(combo));
registerSecureIpcHandler('system:typeClipboard', (_, text) => actions.typeClipboard(text));
registerSecureIpcHandler('system:diagnostics', (_, sub, extra) => actions.diagnostics(sub, extra));
registerSecureIpcHandler('system:manageProcess', (_, sub, target) => actions.manageProcess(sub, target));
registerSecureIpcHandler('system:filePro', (_, sub, source, dest) => actions.filePro(sub, source, dest));
registerSecureIpcHandler('system:powerProfile', (_, plan) => actions.powerProfile(plan));
registerSecureIpcHandler('system:emptyRecycleBin', () => actions.emptyRecycleBin());
registerSecureIpcHandler('system:browserControl', (_, sub, value) => actions.browserControl(sub, value));
registerSecureIpcHandler('clipboard:history', (_, sub, index) => actions.clipboardHistory(sub, index));
registerSecureIpcHandler('scheduler:manage', (_, sub, arg1, arg2, arg3) => actions.scheduler(sub, arg1, arg2, arg3));
registerSecureIpcHandler('memory:rag', (_, sub, contentOrQuery, category) => actions.memoryRag(sub, contentOrQuery, category));
registerSecureIpcHandler('macros:manage', async (_, sub, payload, stats) => {
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

registerSecureIpcHandler('window:minimize', () => windowManager.getMainWindow()?.minimize());
registerSecureIpcHandler('window:maximize', () => {
  const win = windowManager.getMainWindow();
  if (win?.isMaximized()) win.unmaximize();
  else win?.maximize();
});
registerSecureIpcHandler('window:close', () => windowManager.getMainWindow()?.close());
registerSecureIpcHandler('window:setMode', (_, mode) => {
  windowManager.applyWindowMode(mode);
  return windowManager.getCurrentMode();
});
registerSecureIpcHandler('window:wakeRestore', (_, preferredMode = 'notch') => windowManager.wakeRestore(preferredMode));
registerSecureIpcHandler('window:hideToTray', () => windowManager.getMainWindow()?.hide());
registerSecureIpcHandler('notch:update', (_, state) => windowManager.updateNotchState(state || {}));
registerSecureIpcHandler('notch:action', (_, action, payload = '') => {
  const act = String(action || '').toLowerCase();
  if (act === 'hide') {
    windowManager.updateNotchState({ visible: false });
    emitRendererEvent('notch:event', { action: 'hide' });
    return { ok: true };
  }
  if (act === 'open_chat') {
    windowManager.updateNotchState({ visible: false });
    windowManager.applyWindowMode('full');
    return { ok: true };
  }
  if (act === 'open_dashboard') {
    windowManager.updateNotchState({ visible: false });
    windowManager.applyWindowMode('full');
    setTimeout(() => emitRendererEvent('ui:openPcControl', 'system'), 120);
    return { ok: true };
  }
  if (act === 'toggle_mic') {
    emitRendererEvent('notch:event', { action: 'toggle_mic' });
    return { ok: true };
  }
  if (act === 'send_text' && String(payload || '').trim()) {
    emitRendererEvent('notch:event', { action: 'send_text', text: String(payload).trim() });
    return { ok: true };
  }
  return { ok: false };
});
