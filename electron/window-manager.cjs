// Extracted Window, Overlay, Click-Reticle & System Tray Manager for clean Electron modularity
const fs = require('fs');
const path = require('path');

function createWindowManager({
  app,
  shell,
  BrowserWindow,
  Menu,
  Tray,
  screen,
  actions,
  resolveUnpackedPath,
  getCloudRelay,
  getAutoLaunchManager,
  emitRendererEvent,
  getWatchdogAlert,
}) {
  let mainWindow = null;
  let notchWindow = null;
  let notchHideTimer = null;
  let reticleWindow = null;
  let tray = null;
  let trayRefreshTimer = null;
  let currentWindowMode = 'full';

  function hardenWebContents(contents) {
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const u = new URL(url);
        if (['https:', 'http:', 'mailto:'].includes(u.protocol)) {
          Promise.resolve(shell?.openExternal?.(url)).catch(() => {});
        }
      } catch {}
      return { action: 'deny' };
    });

    const guardNavigation = (event, targetUrl) => {
      const currentUrl = contents.getURL();
      if (!currentUrl) return;
      let current;
      let target;
      try { current = new URL(currentUrl); target = new URL(targetUrl); }
      catch { event.preventDefault(); return; }
      const sameFile = current.protocol === 'file:' && target.protocol === 'file:' &&
        decodeURIComponent(current.pathname) === decodeURIComponent(target.pathname);
      const sameDevOrigin = !app.isPackaged && current.origin === target.origin &&
        ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) &&
        Number(target.port || (target.protocol === 'https:' ? 443 : 80)) === 5173;
      if (sameFile || sameDevOrigin) return;
      event.preventDefault();
      if (['https:', 'http:', 'mailto:'].includes(target.protocol)) {
        Promise.resolve(shell?.openExternal?.(targetUrl)).catch(() => {});
      }
    };
    contents.on('will-navigate', guardNavigation);
    contents.on('will-redirect', guardNavigation);
    contents.on('will-attach-webview', (event) => event.preventDefault());
  }


  function createNotchWindow() {
    if (notchWindow && !notchWindow.isDestroyed()) return notchWindow;
    const primary = screen.getPrimaryDisplay();
    const b = primary.bounds;
    const width = 424;
    const height = 142;
    const x = b.x + Math.round((b.width - width) / 2);
    const y = b.y;

    notchWindow = new BrowserWindow({
      width,
      height,
      x,
      y,
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
        backgroundThrottling: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
      },
    });
    hardenWebContents(notchWindow.webContents);
    notchWindow.setAlwaysOnTop(true, 'screen-saver');
    notchWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    notchWindow.loadFile(path.join(__dirname, 'notch-overlay.html')).catch(() => {});
    return notchWindow;
  }

  function updateNotchState(state = {}) {
    try {
      const nw = createNotchWindow();
      if (!nw || nw.isDestroyed()) return false;
      clearTimeout(notchHideTimer);

      const primary = screen.getPrimaryDisplay();
      const b = primary.bounds;
      const width = 416;
      const x = b.x + Math.round((b.width - width) / 2);
      nw.setPosition(x, b.y, false);
      nw.setAlwaysOnTop(true, 'screen-saver');
      nw.webContents.send('notch:state', state);

      if (state.visible) {
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
      }, 320);
    } catch {}
  }

  function createWindow() {
    const autoFlagPath = path.join(app.getPath('userData'), 'auto-launch-init.done');
    const startHidden =
      process.argv.includes('--hidden') ||
      (app.isPackaged && fs.existsSync(autoFlagPath));
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
        backgroundThrottling: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
      },
      icon: path.join(__dirname, '..', 'public', 'icon.png'),
    });

    hardenWebContents(mainWindow.webContents);

    mainWindow.on('close', (event) => {
      // Keep JEEVA alive in System Tray + Camera Notch by default
      if (!app.isQuitting) {
        event.preventDefault();
        mainWindow.hide();
      }
    });

    mainWindow.on('hide', () => {
      updateNotchState({ visible: true, standby: true, orbState: 'idle' });
    });

    mainWindow.on('show', () => {
      updateNotchState({ visible: false });
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
    return mainWindow;
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
    updateNotchState({ visible: true, orbState: 'listening', transcript: 'Listening...' });
    emitRendererEvent('hotkey:wake');
  }

  function wakeRestore(preferredMode = 'notch') {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    if (preferredMode === 'notch') {
      updateNotchState({ visible: true, orbState: 'listening', transcript: 'Listening...' });
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
      { label: 'Open Full Chat', click: () => applyWindowMode('full') },
      { label: 'Hide to Camera Notch (Background)', click: () => mainWindow?.hide?.() },
      { label: 'Show Camera Notch Pill (Alt+Space)', click: () => wakeCortanaOverlay() },
      { label: 'Mini Speaker Mode (Floating Pill)', click: () => applyWindowMode('speaker') },
      { label: 'Cortana Voice Panel', click: () => applyWindowMode('cortana') },
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
            label: 'Clean Temporary Files',
            click: async () => {
              await actions.filePro('clean_temp', '').catch(() => {});
            },
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
