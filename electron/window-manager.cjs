// Extracted Window, Multi-Monitor, Camera Notch, Click-Reticle & System Tray Manager
const fs = require('fs');
const path = require('path');

function createWindowManager({
  app,
  BrowserWindow,
  Menu,
  Tray,
  screen,
  powerMonitor,
  actions,
  resolveUnpackedPath,
  getCloudRelay,
  getAutoLaunchManager,
  emitRendererEvent,
  getWatchdogAlert,
}) {
  let mainWindow = null;
  let notchWindow = null;
  let notchLoaded = false;
  let notchHideTimer = null;
  let reticleWindow = null;
  let tray = null;
  let trayRefreshTimer = null;
  let currentWindowMode = 'full';

  const prefsPath = path.join(app.getPath('userData'), 'window-prefs.json');
  function loadPrefs() {
    try {
      const raw = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
      return {
        notchUserHidden: Boolean(raw.notchUserHidden),
        onboardingComplete: Boolean(raw.onboardingComplete),
        notchDisplayId: raw.notchDisplayId ?? null,
        notchPosition: ['top-center', 'top-left', 'top-right'].includes(raw.notchPosition)
          ? raw.notchPosition
          : 'top-center',
        startupBehavior: ['open_window', 'tray_minimized', 'notch_standby', 'disabled'].includes(raw.startupBehavior)
          ? raw.startupBehavior
          : 'notch_standby',
      };
    } catch {
      return {
        notchUserHidden: false,
        onboardingComplete: false,
        notchDisplayId: null,
        notchPosition: 'top-center',
        startupBehavior: 'notch_standby',
      };
    }
  }
  let prefs = loadPrefs();
  function savePrefs(patch = {}) {
    prefs = { ...prefs, ...patch };
    try {
      fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
      fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf8');
    } catch {}
    return { ...prefs };
  }

  let latestNotchState = {
    visible: false,
    standby: false,
    orbState: 'idle',
    aiName: 'Jeeva',
    transcript: '',
    userMessage: '',
    replyText: '',
    error: '',
    freqBands: [0.15, 0.15, 0.15, 0.15, 0.15],
  };

  function getTargetDisplay() {
    const displays = screen.getAllDisplays();
    if (prefs.notchDisplayId !== null) {
      const matched = displays.find((d) => String(d.id) === String(prefs.notchDisplayId));
      if (matched) return matched;
    }
    return screen.getPrimaryDisplay();
  }

  function computeNotchBounds(width = 520) {
    const display = getTargetDisplay();
    const b = display.workArea || display.bounds;
    const rawBounds = display.bounds || b;
    let x = rawBounds.x + Math.round((rawBounds.width - width) / 2);
    if (prefs.notchPosition === 'top-left') x = b.x + 16;
    else if (prefs.notchPosition === 'top-right') x = b.x + b.width - width - 16;
    const minX = b.x;
    const maxX = Math.max(b.x, b.x + b.width - width);
    x = Math.max(minX, Math.min(maxX, x));
    const y = Math.max(rawBounds.y, b.y);
    return { x, y, width, height: 168 };
  }

  function repositionNotch() {
    if (!notchWindow || notchWindow.isDestroyed()) return;
    try {
      const nb = computeNotchBounds(520);
      notchWindow.setBounds(nb, false);
      notchWindow.setAlwaysOnTop(true, 'screen-saver');
    } catch {}
  }

  function createNotchWindow() {
    if (notchWindow && !notchWindow.isDestroyed()) return notchWindow;
    const nb = computeNotchBounds(520);
    notchLoaded = false;

    notchWindow = new BrowserWindow({
      width: nb.width,
      height: nb.height,
      x: nb.x,
      y: nb.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      resizable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    notchWindow.setAlwaysOnTop(true, 'screen-saver');
    notchWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    notchWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    notchWindow.webContents.on('will-navigate', (ev) => ev.preventDefault());
    notchWindow.webContents.once('did-finish-load', () => {
      notchLoaded = true;
      try {
        if (notchWindow && !notchWindow.isDestroyed()) {
          notchWindow.webContents.send('notch:state', latestNotchState);
        }
      } catch {}
    });
    notchWindow.on('closed', () => {
      notchWindow = null;
      notchLoaded = false;
    });
    notchWindow.loadFile(path.join(__dirname, 'notch-overlay.html')).catch(() => {});
    return notchWindow;
  }

  function setNotchUserHidden(hidden) {
    savePrefs({ notchUserHidden: Boolean(hidden) });
    if (hidden) {
      updateNotchState({ visible: false, standby: false, orbState: 'idle' }, { force: true });
    }
    return prefs.notchUserHidden;
  }

  function updateNotchState(state = {}, opts = {}) {
    try {
      const merged = { ...latestNotchState, ...state };
      // Never allow background idle/standby updates to override an explicit user-hide
      if (prefs.notchUserHidden && !opts.explicitShow && !opts.force) {
        merged.visible = false;
        merged.standby = false;
      } else if (opts.explicitShow) {
        savePrefs({ notchUserHidden: false });
      }
      latestNotchState = merged;

      const nw = createNotchWindow();
      if (!nw || nw.isDestroyed()) return false;
      clearTimeout(notchHideTimer);

      repositionNotch();
      if (notchLoaded) {
        nw.webContents.send('notch:state', latestNotchState);
      }

      if (latestNotchState.visible) {
        if (!nw.isVisible()) nw.showInactive();
      } else {
        notchHideTimer = setTimeout(() => {
          try {
            if (notchWindow && !notchWindow.isDestroyed() && notchWindow.isVisible()) {
              notchWindow.hide();
            }
          } catch {}
        }, 230);
      }
      return true;
    } catch {
      return false;
    }
  }

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
      }, 220);
    } catch {}
  }

  function isStartupLaunch() {
    const argv = process.argv || [];
    if (argv.includes('--startup') || argv.includes('--hidden')) return true;
    try {
      if (process.platform === 'win32' && typeof app.getLoginItemSettings === 'function') {
        const loginSettings = app.getLoginItemSettings();
        if (loginSettings?.wasOpenedAtLogin || loginSettings?.wasOpenedAsHidden) return true;
      }
    } catch {}
    return false;
  }

  function createWindow() {
    // First launch shows setup. Once onboarding is complete, JEEVA starts Notch-first.
    const launchedAtStartup = isStartupLaunch();
    const startHidden = Boolean(prefs.onboardingComplete) || (launchedAtStartup && prefs.startupBehavior !== 'open_window');

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
        sandbox: true,
        backgroundThrottling: true,
      },
      icon: path.join(__dirname, '..', 'public', 'icon.png'),
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        try { require('electron').shell.openExternal(url); } catch {}
      }
      return { action: 'deny' };
    });

    mainWindow.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault();
        mainWindow.hide();
      }
    });

    mainWindow.on('hide', () => {
      if (!prefs.notchUserHidden) {
        updateNotchState({ visible: true, standby: true, orbState: 'idle' });
      }
    });

    mainWindow.on('show', () => {
      updateNotchState({ visible: false, standby: false }, { force: true });
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

    // Reposition notch cleanly on display/resolution/sleep-resume changes
    screen.on('display-added', repositionNotch);
    screen.on('display-removed', repositionNotch);
    screen.on('display-metrics-changed', repositionNotch);
    powerMonitor?.on?.('resume', repositionNotch);

    return mainWindow;
  }

  function applyWindowMode(mode) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    currentWindowMode = mode === 'speaker' ? 'speaker' : mode === 'cortana' ? 'cortana' : 'full';
    const { workArea } = getTargetDisplay();

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
    updateNotchState(
      { visible: true, orbState: 'listening', transcript: 'Listening...' },
      { explicitShow: true }
    );
    emitRendererEvent('hotkey:wake');
  }

  function wakeRestore(preferredMode = 'notch') {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    if (preferredMode === 'notch') {
      updateNotchState(
        { visible: true, orbState: 'listening', transcript: 'Listening...' },
        { explicitShow: true }
      );
      return 'notch';
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    const target = ['cortana', 'full', 'speaker'].includes(preferredMode) ? preferredMode : 'cortana';
    applyWindowMode(target);
    if (target === 'full') {
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
  }

  async function buildTrayMenuTemplate() {
    let statLine = 'PC Ready';
    try {
      const st = await actions.liveStats();
      statLine = `CPU ${st.cpuUsedPct ?? '--'}% · RAM ${st.ramUsedPct}% (${st.ramFreeGb} GB free) · ${st.clipboardCount} Clips`;
    } catch {}
    const wdAlert = getWatchdogAlert?.();

    return Menu.buildFromTemplate([
      { label: statLine, enabled: false },
      ...(wdAlert ? [{ label: `Alert: ${wdAlert.title}`, enabled: false }] : []),
      { type: 'separator' },
      { label: 'Open Main Window', click: () => applyWindowMode('full') },
      {
        label: 'Show Camera Notch (Alt+Space)',
        click: () => {
          savePrefs({ notchUserHidden: false });
          updateNotchState({ visible: true, standby: true, orbState: 'idle' }, { explicitShow: true });
        },
      },
      {
        label: 'Hide Camera Notch',
        click: () => setNotchUserHidden(true),
      },
      { label: 'Mini Speaker Mode (Floating Pill)', click: () => applyWindowMode('speaker') },
      { label: 'Voice Panel', click: () => applyWindowMode('cortana') },
      {
        label: 'Open PC Control Center',
        click: () => {
          applyWindowMode('full');
          setTimeout(() => emitRendererEvent('ui:openPcControl', 'clipboard'), 120);
        },
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
      tray.on('right-click', refreshTrayMenu);
      trayRefreshTimer = setInterval(refreshTrayMenu, 60000);
      if (typeof trayRefreshTimer.unref === 'function') trayRefreshTimer.unref();

      tray.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
          mainWindow.focus();
        } else {
          applyWindowMode('full');
        }
      });
    } catch {}
  }

  function disposeTray() {
    clearTimeout(notchHideTimer);
    screen.removeListener('display-added', repositionNotch);
    screen.removeListener('display-removed', repositionNotch);
    screen.removeListener('display-metrics-changed', repositionNotch);
    powerMonitor?.removeListener?.('resume', repositionNotch);
    if (notchWindow && !notchWindow.isDestroyed()) {
      try { notchWindow.destroy(); } catch {}
      notchWindow = null;
    }
    if (trayRefreshTimer) {
      clearInterval(trayRefreshTimer);
      trayRefreshTimer = null;
    }
  }

  return {
    getMainWindow: () => mainWindow,
    getNotchWindow: () => notchWindow,
    createNotchWindow,
    updateNotchState,
    setNotchUserHidden,
    getPrefs: () => ({ ...prefs }),
    savePrefs,
    getDisplays: () =>
      screen.getAllDisplays().map((d, idx) => ({
        id: d.id,
        label: d.label || `Display ${idx + 1} (${d.bounds.width}x${d.bounds.height})`,
        primary: d.id === screen.getPrimaryDisplay().id,
        bounds: d.bounds,
      })),
    repositionNotch,
    isStartupLaunch,
    getCurrentMode: () => currentWindowMode,
    showClickReticle,
    createWindow,
    applyWindowMode,
    wakeCortanaOverlay,
    wakeRestore,
    setupTray,
    disposeTray,
  };
}

module.exports = { createWindowManager };
