const fs = require('fs');
const path = require('path');

const DEFAULT_HOST_RULES = {
  hardware_settings: 'always',
  apps_window: 'ask',
  software_manage: 'ask',
  files_storage: 'ask',
  screen_input: 'ask',
  terminal_power: 'ask',
  phone_adb: 'ask',
};

const HIGH_RISK_ACTIONS = new Set([
  'runCommand',
  'power',
  'deleteFile',
  'manageSoftware',
  'closeApp',
  'adbControl',
]);

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getActionCategory(action, args = []) {
  switch (action) {
    case 'volume':
    case 'brightness':
    case 'media':
    case 'openSetting':
    case 'theme':
    case 'battery':
    case 'wifi':
    case 'systemInfo':
    case 'liveStats':
    case 'diagnostics':
    case 'powerProfile':
      return 'hardware_settings';

    case 'openApp':
    case 'runningApps':
    case 'windowControl':
    case 'listInstalledApps':
    case 'openURL':
      return 'apps_window';

    case 'browserControl':
      return ['youtube_skip_ad', 'launch_debug'].includes(args[0]) ? 'screen_input' : 'apps_window';

    case 'scheduler':
      return args[0] === 'delayed_command' ? 'terminal_power' : 'apps_window';

    case 'closeApp':
      return 'software_manage';

    case 'manageSoftware':
      return args[0] === 'search' ? 'apps_window' : 'software_manage';

    case 'readFile':
    case 'readBinaryFile':
    case 'writeFile':
    case 'listFiles':
    case 'searchFiles':
    case 'deleteFile':
    case 'clipboard':
    case 'clipboardHistory':
    case 'filePro':
    case 'saveDesktopFile':
    case 'saveImage':
    case 'memoryRag':
      return 'files_storage';

    case 'screenshot':
    case 'typeText':
    case 'minimizeAll':
    case 'uiAutomate':
    case 'mouseAction':
    case 'sendHotkey':
    case 'typeClipboard':
      return 'screen_input';

    case 'runCommand':
    case 'power':
    case 'manageProcess':
    case 'emptyRecycleBin':
      return 'terminal_power';

    case 'adbControl':
      return 'phone_adb';

    default:
      return 'apps_window';
  }
}

function isActionHighRisk(action, args = []) {
  if (action === 'manageSoftware') {
    return ['install', 'uninstall', 'update'].includes(args[0]);
  }
  if (action === 'manageProcess') {
    return args[0] === 'kill_process';
  }
  if (action === 'filePro') {
    return ['organize_folder', 'move', 'rename'].includes(args[0]);
  }
  if (action === 'scheduler') {
    return args[0] === 'delayed_command';
  }
  if (action === 'emptyRecycleBin') {
    return true;
  }
  return HIGH_RISK_ACTIONS.has(action);
}

function summarizeAction(action, args = []) {
  switch (action) {
    case 'manageSoftware':
      return `${String(args[0] || '').toUpperCase()} software: ${args[1] || ''}`;
    case 'openApp':
      return `Launch app: ${args[0] || ''}${args[1] ? ` (${args[1]})` : ''}`;
    case 'browserControl':
      return `Browser ${args[0] || 'tab'}${args[1] ? `: ${args[1]}` : ''}`;
    case 'closeApp':
      return `Force close app: ${args[0] || ''}`;
    case 'windowControl':
      return `Window ${args[0] || 'focus'}: ${args[1] || ''}`;
    case 'uiAutomate':
      return `UI ${args[0] || 'inspect'} on ${args[1] || ''} ${args[2] ? `-> ${args[2]}` : ''}`.trim();
    case 'mouseAction':
      return `Mouse ${args[0] || 'click'} (${args[1] ?? ''}, ${args[2] ?? ''})`;
    case 'sendHotkey':
      return `Press keyboard hotkey: ${args[0] || ''}`;
    case 'typeClipboard':
      return `Paste text into active window (${String(args[0] || '').length} chars)`;
    case 'diagnostics':
      return `PC Diagnostics: ${args[0] || 'overview'}`;
    case 'manageProcess':
      return `Process ${args[0] || 'inspect'}: ${args[1] || ''}`;
    case 'filePro':
      return `File Manager (${args[0] || ''}): ${args[1] || ''}${args[2] ? ` -> ${args[2]}` : ''}`;
    case 'powerProfile':
      return `Power plan: ${args[0] || 'get'}`;
    case 'emptyRecycleBin':
      return 'Permanently empty Windows Recycle Bin';
    case 'clipboardHistory':
      return `Clipboard history: ${args[0] || 'list'}`;
    case 'scheduler':
      return `PC Scheduler (${args[0] || 'list'}): ${args[2] || args[1] || ''}`.trim();
    case 'runCommand':
      return `Shell command: ${args[0] || ''}`;
    case 'power':
      return `PC Power action: ${args[0] || ''}`;
    case 'deleteFile':
      return `Move to trash: ${args[0] || ''}`;
    case 'writeFile':
      return `Write file: ${args[0] || ''}`;
    case 'readFile':
    case 'readBinaryFile':
      return `Read file: ${args[0] || ''}`;
    case 'volume':
      return `Volume ${args[0] || ''}${args[1] !== undefined && Number(args[1]) >= 0 ? ` (${args[1]}%)` : ''}`;
    case 'brightness':
      return `Brightness ${args[0] || ''}${args[1] !== undefined && Number(args[1]) >= 0 ? ` (${args[1]}%)` : ''}`;
    default:
      return `${action}(${args.map((a) => String(a ?? '')).join(', ').slice(0, 120)})`;
  }
}

function getTargetScope(action, args = []) {
  const cleanFirst = String(args[0] || '').trim().toLowerCase();
  if (action === 'openApp' || action === 'closeApp' || action === 'windowControl') {
    const appName = action === 'windowControl' ? String(args[1] || '').trim().toLowerCase() : cleanFirst;
    return appName ? `app:${appName.replace(/\.exe$/i, '')}` : '';
  }
  if (['readFile', 'readBinaryFile', 'writeFile', 'deleteFile', 'listFiles'].includes(action)) {
    return args[0] ? `path:${path.dirname(String(args[0])).toLowerCase()}` : '';
  }
  if (action === 'filePro' && args[1]) {
    return `path:${String(args[1]).trim().toLowerCase()}`;
  }
  return '';
}

function createPermissionGuard({ userDataPath, BrowserWindow }) {
  const policyPath = path.join(userDataPath, 'permission-policy.json');
  const auditPath = path.join(userDataPath, 'host-audit.json');
  const sessionPassUntil = new Map();
  let promptQueue = Promise.resolve();

  function getRules() {
    try {
      if (fs.existsSync(policyPath)) {
        const parsed = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
        return { ...DEFAULT_HOST_RULES, ...parsed, allowedTargets: Array.isArray(parsed.allowedTargets) ? parsed.allowedTargets : [] };
      }
    } catch {}
    return { ...DEFAULT_HOST_RULES, allowedTargets: [] };
  }

  function saveRules(rules) {
    const prev = getRules();
    const merged = {
      ...DEFAULT_HOST_RULES,
      ...prev,
      ...rules,
      allowedTargets: Array.isArray(rules?.allowedTargets) ? rules.allowedTargets : prev.allowedTargets || [],
    };
    try {
      fs.writeFileSync(policyPath, JSON.stringify(merged, null, 2), 'utf-8');
    } catch {}
    return merged;
  }

  function getAuditLog() {
    try {
      if (fs.existsSync(auditPath)) {
        const list = JSON.parse(fs.readFileSync(auditPath, 'utf-8'));
        return Array.isArray(list) ? list : [];
      }
    } catch {}
    return [];
  }

  function appendAudit(entry) {
    const log = getAuditLog();
    const next = [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toLocaleString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          day: '2-digit',
          month: 'short',
        }),
        ...entry,
      },
      ...log,
    ].slice(0, 150);
    try {
      fs.writeFileSync(auditPath, JSON.stringify(next, null, 2), 'utf-8');
    } catch {}
  }

  function clearAuditLog() {
    try {
      if (fs.existsSync(auditPath)) fs.unlinkSync(auditPath);
    } catch {}
    return [];
  }

  function showPCPermissionWindow({ sourceLabel, category, summary, highRisk, targetScope }) {
    return new Promise((resolve) => {
      let settled = false;
      const win = new BrowserWindow({
        width: 440,
        height: 315,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        backgroundColor: '#09090b',
        skipTaskbar: false,
        title: 'JEEVA Permission Request',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      const finish = (choice) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (!win.isDestroyed()) win.close();
        resolve(choice);
      };

      const timeoutId = setTimeout(() => finish('deny'), 45000);

      win.on('closed', () => finish('deny'));
      win.webContents.on('will-navigate', (e, navUrl) => {
        e.preventDefault();
        try {
          const u = new URL(navUrl);
          if (u.hostname === 'jeeva-perm.local') {
            finish(u.searchParams.get('choice') || 'deny');
          }
        } catch {
          finish('deny');
        }
      });

      const badgeColor = highRisk ? '#ef4444' : '#f59e0b';
      const badgeLabel = highRisk ? 'HIGH RISK' : 'CONFIRM ACTION';
      const alwaysBtn = highRisk
        ? ''
        : `${targetScope ? `<button onclick="decide('always_target')" style="background:#0c4a6e;color:#7dd3fc;border:1px solid #0369a1;padding:7px 10px;border-radius:8px;font-size:11px;cursor:pointer;font-weight:600;">Always: ${escapeHtml(targetScope)}</button>` : ''}<button onclick="decide('always')" style="background:#064e3b;color:#6ee7b7;border:1px solid #047857;padding:7px 10px;border-radius:8px;font-size:11px;cursor:pointer;font-weight:600;">Always Category</button>`;

      const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><style>
  *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
  body{margin:0;background:#09090b;color:#f4f4f5;padding:18px;border:1px solid #27272a;height:100vh;display:flex;flex-direction:column;justify-content:space-between;-webkit-app-region:drag;}
  button{-webkit-app-region:no-drag;}
  .bar{height:3px;background:#27272a;border-radius:4px;overflow:hidden;margin-top:8px;}
  .fill{height:100%;background:#10b981;width:100%;animation:shrink 45s linear forwards;}
  @keyframes shrink{from{width:100%}to{width:0%}}
</style></head>
<body>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span style="font-size:11px;font-weight:700;letter-spacing:.05em;color:${badgeColor};">${badgeLabel}</span>
      <span style="font-size:11px;color:#a1a1aa;background:#18181b;padding:3px 8px;border-radius:6px;border:1px solid #27272a;">${escapeHtml(sourceLabel)}</span>
    </div>
    <div style="font-size:15px;font-weight:600;margin-bottom:4px;">Allow remote PC command?</div>
    <div style="font-size:11px;color:#71717a;margin-bottom:12px;">Category: <code style="color:#d4d4d8;">${escapeHtml(category)}</code></div>
    <div style="background:#111114;border:1px solid #27272a;border-radius:10px;padding:12px;font-family:Consolas,monospace;font-size:12px;color:#e4e4e7;max-height:92px;overflow:auto;word-break:break-word;">
      ${escapeHtml(summary)}
    </div>
    <div class="bar"><div class="fill"></div></div>
    <div style="font-size:10px;color:#71717a;margin-top:5px;">Auto-denies in 45 seconds if no response</div>
  </div>
  <div style="display:flex;gap:7px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px;">
    <button onclick="decide('deny')" style="background:#18181b;color:#f87171;border:1px solid #7f1d1d;padding:7px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-weight:600;">Deny</button>
    <button onclick="decide('session15')" style="background:#18181b;color:#e4e4e7;border:1px solid #3f3f46;padding:7px 10px;border-radius:8px;font-size:11px;cursor:pointer;">Allow 15m</button>
    ${alwaysBtn}
    <button onclick="decide('once')" style="background:#f4f4f5;color:#09090b;border:none;padding:7px 14px;border-radius:8px;font-size:12px;cursor:pointer;font-weight:700;">Allow Once</button>
  </div>
  <script>
    function decide(c){ location.href = 'https://jeeva-perm.local/decide?choice=' + encodeURIComponent(c); }
  </script>
</body>
</html>`;
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    });
  }

  function authorizeRemoteAction({ action, args = [], sourceLabel = 'Remote Client' }) {
    const category = getActionCategory(action, args);
    const rules = getRules();
    const policy = rules[category] || 'ask';
    const summary = summarizeAction(action, args);
    const highRisk = isActionHighRisk(action, args);
    const targetScope = getTargetScope(action, args);

    if (policy === 'block') {
      appendAudit({ source: sourceLabel, category, action, summary, decision: 'blocked' });
      return Promise.reject(new Error(`Blocked by PC Permission Center (${category}).`));
    }

    const tempUntil = sessionPassUntil.get(category) || 0;
    const isTargetAllowlisted = Boolean(targetScope && !highRisk && (rules.allowedTargets || []).includes(targetScope));
    if (policy === 'always' || isTargetAllowlisted || Date.now() < tempUntil) {
      appendAudit({ source: sourceLabel, category, action, summary, decision: isTargetAllowlisted ? `allowed-target (${targetScope})` : 'allowed-policy' });
      return Promise.resolve(true);
    }

    // Queue interactive confirmation dialogs so simultaneous commands don't overlap
    const runPrompt = async () => {
      const choice = await showPCPermissionWindow({ sourceLabel, category, summary, highRisk, targetScope });
      if (choice === 'once') {
        appendAudit({ source: sourceLabel, category, action, summary, decision: 'allowed-once' });
        return true;
      }
      if (choice === 'session15') {
        sessionPassUntil.set(category, Date.now() + 15 * 60 * 1000);
        appendAudit({ source: sourceLabel, category, action, summary, decision: 'allowed-15m' });
        return true;
      }
      if (choice === 'always_target' && targetScope && !highRisk) {
        const cur = getRules();
        const nextTargets = Array.from(new Set([...(cur.allowedTargets || []), targetScope]));
        saveRules({ ...cur, allowedTargets: nextTargets });
        appendAudit({ source: sourceLabel, category, action, summary, decision: `allowed-target (${targetScope})` });
        return true;
      }
      if (choice === 'always' && !highRisk) {
        saveRules({ ...getRules(), [category]: 'always' });
        appendAudit({ source: sourceLabel, category, action, summary, decision: 'allowed-always' });
        return true;
      }
      appendAudit({ source: sourceLabel, category, action, summary, decision: 'denied' });
      throw new Error(`Permission denied on PC for: ${summary}`);
    };

    const next = promptQueue.then(runPrompt, runPrompt);
    promptQueue = next.catch(() => {});
    return next;
  }

  return {
    getRules,
    saveRules,
    getAuditLog,
    appendAudit,
    clearAuditLog,
    authorizeRemoteAction,
    getActionCategory,
    summarizeAction,
  };
}

module.exports = {
  createPermissionGuard,
  getActionCategory,
  isActionHighRisk,
  summarizeAction,
  DEFAULT_HOST_RULES,
};
