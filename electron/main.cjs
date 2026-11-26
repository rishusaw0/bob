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
  Notification,
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

let mainWindow;
let reticleWindow = null;
let bridgeServer;
let tray = null;
let trayRefreshTimer = null;
let currentWindowMode = 'full';
let permissionGuard = null;
let cloudRelay = null;
let pcScheduler = null;
let offlineVoice = null;
let appUpdater = null;

function resolveUnpackedPath(...parts) {
  const p = path.join(__dirname, ...parts);
  if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
    return p.replace('app.asar', 'app.asar.unpacked');
  }
  return p;
}

function emitRendererEvent(channel, payload) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  } catch {}
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

// Brief click-through emerald crosshair reticle overlaid cleanly over click target
async function showClickReticle(physX, physY, scaleFactor = 1) {
  try {
    const dipX = Math.round(physX / Math.max(0.5, scaleFactor)) - 22;
    const dipY = Math.round(physY / Math.max(0.5, scaleFactor)) - 22;
    if (reticleWindow && !reticleWindow.isDestroyed()) {
      reticleWindow.close();
      reticleWindow = null;
    }
    const win = new BrowserWindow({
      width: 44,
      height: 44,
      x: dipX,
      y: dipY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      hasShadow: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setIgnoreMouseEvents(true);
    reticleWindow = win;
    const svgHtml = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden;"><svg width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="16" fill="rgba(16,185,129,0.16)" stroke="#10b981" stroke-width="2"/><circle cx="22" cy="22" r="4" fill="#34d399"/><line x1="22" y1="2" x2="22" y2="12" stroke="#10b981" stroke-width="2"/><line x1="22" y1="32" x2="22" y2="42" stroke="#10b981" stroke-width="2"/><line x1="2" y1="22" x2="12" y2="22" stroke="#10b981" stroke-width="2"/><line x1="32" y1="22" x2="42" y2="22" stroke="#10b981" stroke-width="2"/></svg></body></html>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(svgHtml));
    await new Promise((r) => setTimeout(r, 170));
    setTimeout(() => {
      if (!win.isDestroyed()) win.close();
      if (reticleWindow === win) reticleWindow = null;
    }, 320);
  } catch {}
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
  emitRendererEvent,
  showClickReticle,
});
const { actions } = pcActionKit;

function createWindow() {
  const startHidden = process.argv.includes('--hidden');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 600,
    frame: false,
    show: !startHidden,
    transparent: false,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
  });

  mainWindow.on('close', (event) => {
    const keepInTray = Boolean(cloudRelay?.getStatus?.().enabled || app.getLoginItemSettings().openAtLogin);
    if (!app.isQuitting && keepInTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  const editMenu = Menu.buildFromTemplate([
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ]);
  Menu.setApplicationMenu(editMenu);

  mainWindow.webContents.on('context-menu', (_, params) => {
    const contextMenu = Menu.buildFromTemplate([
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy || !!params.selectionText },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    ]);
    contextMenu.popup({ window: mainWindow });
  });

  const distFile = path.join(__dirname, '..', 'dist', 'index.html');
  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => mainWindow.loadFile(distFile));
    mainWindow.webContents.on('did-fail-load', () => mainWindow.loadFile(distFile));
  } else {
    mainWindow.loadFile(distFile);
  }
}

function applyWindowMode(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  currentWindowMode = mode === 'speaker' ? 'speaker' : mode === 'cortana' ? 'cortana' : 'full';
  const { workArea } = screen.getPrimaryDisplay();

  if (currentWindowMode === 'speaker') {
    const width = 332;
    const height = 84;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(290, 74);
    mainWindow.setSize(width, height, true);
    mainWindow.setPosition(
      workArea.x + workArea.width - width - 16,
      workArea.y + workArea.height - height - 16,
      true
    );
    mainWindow.setResizable(false);
    mainWindow.setAlwaysOnTop(true, 'floating');
  } else if (currentWindowMode === 'cortana') {
    const width = 400;
    const height = 560;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(340, 420);
    mainWindow.setSize(width, height, true);
    mainWindow.setPosition(workArea.x + 14, workArea.y + workArea.height - height - 12, true);
    mainWindow.setAlwaysOnTop(true, 'floating');
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(400, 600);
    mainWindow.setSize(1200, 800, true);
    mainWindow.center();
  }

  mainWindow.show();
  mainWindow.focus();
  emitRendererEvent('window:modeChanged', currentWindowMode);
}

function wakeCortanaOverlay() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  applyWindowMode('cortana');
  setTimeout(() => emitRendererEvent('hotkey:wake'), 150);
}

async function buildTrayMenuTemplate() {
  let statLine = 'PC Workstation Ready';
  try {
    const st = await actions.liveStats();
    const cpuPart = st.cpuUsedPct !== null && st.cpuUsedPct !== undefined ? `CPU ${st.cpuUsedPct}% · ` : '';
    statLine = `${cpuPart}RAM ${st.ramUsedPct}% · ${st.clipboardCount} clips · ${st.scheduledCount} timers`;
  } catch {}

  return Menu.buildFromTemplate([
    { label: statLine, enabled: false },
    { type: 'separator' },
    { label: 'Open Full Chat', click: () => applyWindowMode('full') },
    { label: 'Mini Speaker Mode (Floating Pill)', click: () => applyWindowMode('speaker') },
    { label: 'Cortana Voice Panel (Alt+Space)', click: () => wakeCortanaOverlay() },
    {
      label: 'Open PC Control Center',
      click: () => {
        applyWindowMode('full');
        setTimeout(() => emitRendererEvent('ui:openPcControl', 'clipboard'), 120);
      },
    },
    { type: 'separator' },
    {
      label: 'Workstation Quick Presets',
      submenu: [
        {
          label: 'Coding Mode (High Perf + VS Code)',
          click: async () => {
            await actions.powerProfile('high_performance').catch(() => {});
            await actions.openApp('vscode').catch(() => {});
          },
        },
        {
          label: 'Night Focus (Dark Mode + Balanced)',
          click: async () => {
            await actions.theme('dark').catch(() => {});
            await actions.powerProfile('balanced').catch(() => {});
          },
        },
        {
          label: 'Sort Downloads by File Type',
          click: async () => {
            await actions.filePro('organize_folder', 'downloads').catch(() => {});
          },
        },
        {
          label: 'Toggle Dark / Light Theme',
          click: () => actions.theme('toggle').catch(() => {}),
        },
        {
          label: 'Mute System Volume',
          click: () => actions.volume('mute').catch(() => {}),
        },
      ],
    },
    { type: 'separator' },
    {
      label: 'Quit JEEVA',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function setupTray() {
  const iconPath = resolveUnpackedPath('..', 'public', 'icon.png');
  if (!fs.existsSync(iconPath)) return;
  try {
    tray = new Tray(iconPath);
    tray.setToolTip('JEEVA — Personal AI (Alt+Space for Voice)');
    const refreshTrayMenu = async () => {
      if (!tray) return;
      tray.setContextMenu(await buildTrayMenuTemplate());
    };
    refreshTrayMenu();
    trayRefreshTimer = setInterval(refreshTrayMenu, 15000);
    if (typeof trayRefreshTimer.unref === 'function') trayRefreshTimer.unref();

    tray.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        applyWindowMode('full');
      }
    });
  } catch (err) {
    console.log('Tray setup skipped:', err.message);
  }
}

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
        if (mainWindow && !mainWindow.isDestroyed()) {
          applyWindowMode('full');
          emitRendererEvent('relay:deepLinked', { renderUrl: validServer, pairToken: pair, status: relayStat });
        }
      }
    }
  } catch {}
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_, argv) => {
    const deepArg = argv.find((a) => typeof a === 'string' && a.startsWith('jeeva://'));
    if (deepArg) {
      handleDeepLink(deepArg);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      applyWindowMode('full');
    }
  });
}

app.whenReady().then(() => {
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

  createWindow();
  setupTray();
  cloudRelay.initAutoConnect();

  if (pendingDeepLinkUrl && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      if (pendingDeepLinkUrl) {
        handleDeepLink(pendingDeepLinkUrl);
        pendingDeepLinkUrl = null;
      }
    });
  }

  for (const hk of ['Ctrl+Shift+Space', 'Alt+Shift+J', 'Alt+Space']) {
    try {
      const ok = globalShortcut.register(hk, () => wakeCortanaOverlay());
      if (!ok) console.log(`Shortcut ${hk} already claimed by OS/another app`);
    } catch {}
  }

  // Encrypted OS-level key vault (safeStorage)
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

  ipcMain.handle('bridge:info', () => ({
    pin,
    lanIPs: getLanIPs(),
    port: app.isPackaged || process.env.NODE_ENV === 'production' ? 5174 : 5173,
    standalonePort: 5174,
    hostname: os.hostname(),
  }));

  ipcMain.handle('permissions:sync', (_, rules) => permissionGuard.saveRules(rules));
  ipcMain.handle('permissions:get', () => permissionGuard.getRules());
  ipcMain.handle('permissions:auditGet', () => permissionGuard.getAuditLog());
  ipcMain.handle('permissions:auditClear', () => permissionGuard.clearAuditLog());

  ipcMain.handle('relay:connect', (_, cfg) => cloudRelay.connect(cfg || {}));
  ipcMain.handle('relay:disconnect', () => cloudRelay.disconnect());
  ipcMain.handle('relay:regeneratePairToken', () => cloudRelay.regeneratePairToken());
  ipcMain.handle('relay:status', () => cloudRelay.getStatus());

  ipcMain.handle('app:getAutoLaunch', () => Boolean(app.getLoginItemSettings().openAtLogin));
  ipcMain.handle('app:setAutoLaunch', (_, enabled) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: ['--hidden'] });
    return Boolean(app.getLoginItemSettings().openAtLogin);
  });

  ipcMain.handle('voice:offlineStart', (_, aiName) => offlineVoice.start(aiName));
  ipcMain.handle('voice:offlineStop', () => offlineVoice.stop());
  ipcMain.handle('voice:offlineSetName', (_, aiName) => offlineVoice.setAiName(aiName));
  ipcMain.handle('voice:offlineStatus', () => offlineVoice.getStatus());

  ipcMain.handle('updater:check', (_, cfg) => appUpdater.checkForUpdates(cfg || {}));
  ipcMain.handle('updater:download', (_, url) => appUpdater.downloadAndInstall(url));
  ipcMain.handle('updater:getState', () => appUpdater.getState());

  pcActionKit.startClipboardWatcher();
  getScheduler();
});

app.on('will-quit', () => {
  if (trayRefreshTimer) {
    clearInterval(trayRefreshTimer);
    trayRefreshTimer = null;
  }
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
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
ipcMain.handle('system:writeFile', (_, p, c) => actions.writeFile(p, c));
ipcMain.handle('system:listFiles', (_, d) => actions.listFiles(d));
ipcMain.handle('system:searchFiles', (_, q, d) => actions.searchFiles(q, d));
ipcMain.handle('system:deleteFile', (_, p) => actions.deleteFile(p));
ipcMain.handle('system:clipboard', (_, a, t) => actions.clipboard(a, t));
ipcMain.handle('system:info', () => actions.systemInfo());
ipcMain.handle('system:screenshot', () => actions.screenshot());
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

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:setMode', (_, mode) => {
  applyWindowMode(mode);
  return currentWindowMode;
});
ipcMain.handle('window:wakeRestore', (_, preferredMode = 'cortana') => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  const target = ['cortana', 'full', 'speaker'].includes(preferredMode) ? preferredMode : 'cortana';
  applyWindowMode(target);
  if (target === 'full') {
    // Brief alwaysOnTop pulse forces Windows DWM to bring window in front of full-screen apps
    mainWindow.setAlwaysOnTop(true);
    mainWindow.show();
    mainWindow.focus();
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && currentWindowMode === 'full') {
        mainWindow.setAlwaysOnTop(false);
      }
    }, 180);
  }
  return currentWindowMode;
});
ipcMain.handle('window:hideToTray', () => mainWindow?.hide());
