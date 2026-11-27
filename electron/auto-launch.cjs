const fs = require('fs');
const path = require('path');

const APP_MODEL_ID = 'com.roushan.jeeva-ai';
const STARTUP_SHORTCUT_NAME = 'JEEVA AI.lnk';

function quoteIfNeeded(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.startsWith('"') && s.endsWith('"')) return s;
  return /\s/.test(s) ? `"${s}"` : s;
}

/**
 * Computes consistent Windows / cross-platform login-item paths & args so
 * Electron setLoginItemSettings and getLoginItemSettings always match.
 */
function resolveLaunchTarget({ isPackaged = false, execPath = process.execPath, argv = [] } = {}) {
  const exe = String(execPath || process.execPath || '').trim();
  if (isPackaged) {
    return {
      launchPath: exe,
      launchArgs: ['--startup', '--hidden'],
      shortcutArgs: '--startup --hidden',
    };
  }
  const rawEntry = argv[1] && !String(argv[1]).startsWith('-') ? path.resolve(String(argv[1])) : '';
  if (rawEntry) {
    const quotedEntry = quoteIfNeeded(rawEntry);
    return {
      launchPath: exe,
      launchArgs: [quotedEntry, '--startup', '--hidden'],
      shortcutArgs: `${quotedEntry} --startup --hidden`,
    };
  }
  return {
    launchPath: exe,
    launchArgs: ['--startup', '--hidden'],
    shortcutArgs: '--startup --hidden',
  };
}

function getStartupShortcutPath(appDataPath) {
  const base = String(appDataPath || '').trim();
  if (!base) return '';
  return path.join(base, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', STARTUP_SHORTCUT_NAME);
}

/**
 * Manages Windows / desktop auto-launch on login using Electron login-item
 * registry settings plus Windows Startup-folder shortcut fallback when Registry
 * HKCU\...\Run is restricted or deactivated.
 */
function createAutoLaunchManager({
  app,
  shell,
  platform = process.platform,
  appDataPath = '',
  isPackaged = false,
  execPath = process.execPath,
  argv = process.argv,
} = {}) {
  const target = resolveLaunchTarget({ isPackaged, execPath, argv });
  const resolveAppData = () => {
    if (appDataPath) return appDataPath;
    try {
      return app?.getPath?.('appData') || process.env.APPDATA || '';
    } catch {
      return process.env.APPDATA || '';
    }
  };

  function getShortcutPath() {
    if (platform !== 'win32') return '';
    return getStartupShortcutPath(resolveAppData());
  }

  function isShortcutEnabled() {
    const lnk = getShortcutPath();
    return Boolean(lnk && fs.existsSync(lnk));
  }

  function removeShortcut() {
    const lnk = getShortcutPath();
    if (!lnk || !fs.existsSync(lnk)) return;
    try {
      fs.unlinkSync(lnk);
    } catch {}
  }

  function writeStartupShortcut() {
    const lnk = getShortcutPath();
    if (!lnk || !shell?.writeShortcutLink) return false;
    try {
      fs.mkdirSync(path.dirname(lnk), { recursive: true });
      const op = fs.existsSync(lnk) ? 'replace' : 'create';
      const ok = shell.writeShortcutLink(lnk, op, {
        target: target.launchPath,
        args: target.shortcutArgs,
        cwd: path.dirname(target.launchPath),
        description: 'JEEVA AI Background Assistant (Tray & Alt+Space)',
        appUserModelId: APP_MODEL_ID,
      });
      return Boolean(ok && fs.existsSync(lnk));
    } catch {
      return false;
    }
  }

  function getLoginCheckOptions() {
    return platform === 'win32'
      ? { path: target.launchPath, args: target.launchArgs }
      : undefined;
  }

  function isRegistryEnabled() {
    if (!app?.getLoginItemSettings) return false;
    try {
      const st = app.getLoginItemSettings(getLoginCheckOptions());
      if (platform === 'win32') {
        if (st?.openAtLogin && st?.executableWillLaunchAtLogin !== false) return true;
        if (Array.isArray(st?.launchItems) && st.launchItems.length > 0) {
          const normExe = path.normalize(target.launchPath).toLowerCase();
          return st.launchItems.some((item) => {
            const normItem = path.normalize(String(item?.path || '')).toLowerCase();
            const joinedArgs = Array.isArray(item?.args) ? item.args.join(' ') : '';
            return Boolean(item?.enabled) && normItem === normExe && joinedArgs.includes('--hidden');
          });
        }
        return false;
      }
      return Boolean(st?.openAtLogin);
    } catch {
      return false;
    }
  }

  function isEnabled() {
    return isRegistryEnabled() || isShortcutEnabled();
  }

  function setEnabled(enabled) {
    const next = Boolean(enabled);
    if (next) {
      if (app?.setLoginItemSettings) {
        try {
          if (platform === 'win32') {
            app.setLoginItemSettings({
              openAtLogin: true,
              enabled: true,
              path: target.launchPath,
              args: target.launchArgs,
            });
          } else {
            app.setLoginItemSettings({ openAtLogin: true, args: target.launchArgs });
          }
        } catch {}
      }

      if (isRegistryEnabled()) {
        removeShortcut();
        return { enabled: true, method: 'registry' };
      }

      if (platform === 'win32') {
        // Clear partial/disabled registry entry before writing Startup shortcut fallback
        try {
          app?.setLoginItemSettings?.({ openAtLogin: false, path: target.launchPath, args: target.launchArgs });
        } catch {}
        if (writeStartupShortcut()) {
          return { enabled: true, method: 'startup_shortcut' };
        }
      }

      return { enabled: isEnabled(), method: 'none' };
    }

    if (app?.setLoginItemSettings) {
      try {
        if (platform === 'win32') {
          app.setLoginItemSettings({ openAtLogin: false, path: target.launchPath, args: target.launchArgs });
          app.setLoginItemSettings({ openAtLogin: false, path: target.launchPath, args: [] });
          app.setLoginItemSettings({ openAtLogin: false, path: target.launchPath, args: target.launchArgs, name: 'JEEVA AI' });
        } else {
          app.setLoginItemSettings({ openAtLogin: false, args: target.launchArgs });
        }
      } catch {}
    }
    removeShortcut();
    return { enabled: isEnabled(), method: 'none' };
  }

  return {
    APP_MODEL_ID,
    getTarget: () => ({ ...target, shortcutPath: getShortcutPath() }),
    isEnabled,
    setEnabled,
  };
}

module.exports = {
  APP_MODEL_ID,
  resolveLaunchTarget,
  getStartupShortcutPath,
  createAutoLaunchManager,
};
