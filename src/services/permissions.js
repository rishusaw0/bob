// Granular Permission Center + Risk Classification + Audit Log

export const PERMISSION_CATEGORIES = [
  {
    id: 'hardware_settings',
    label: 'Hardware & Settings',
    description: 'Volume, brightness, media keys, dark/light theme, Wi-Fi, battery, system info',
    risk: 'low',
  },
  {
    id: 'apps_window',
    label: 'Apps & Window Control',
    description: 'Open apps, list installed software, focus/minimize/maximize windows, open URLs',
    risk: 'medium',
  },
  {
    id: 'software_manage',
    label: 'Install / Remove Software',
    description: 'Search, install, uninstall, or update apps via winget; force-close running apps',
    risk: 'high',
  },
  {
    id: 'files_storage',
    label: 'Files, Notes & Clipboard',
    description: 'List, search, read, write, or delete files/PDFs; read/write clipboard',
    risk: 'medium',
  },
  {
    id: 'screen_input',
    label: 'Screen Capture & UI Control',
    description: 'Take screenshots, type text, keyboard shortcuts, click/inspect app UI buttons',
    risk: 'medium',
  },
  {
    id: 'terminal_power',
    label: 'Terminal & Power',
    description: 'Run arbitrary CMD/PowerShell commands; lock, sleep, restart, shutdown PC',
    risk: 'high',
  },

];

const DEFAULT_LOCAL_RULES = {
  hardware_settings: 'always',
  apps_window: 'ask',
  software_manage: 'ask',
  files_storage: 'ask',
  screen_input: 'ask',
  terminal_power: 'ask',
};

const DEFAULT_REMOTE_RULES = {
  hardware_settings: 'ask',
  apps_window: 'ask',
  software_manage: 'ask',
  files_storage: 'ask',
  screen_input: 'ask',
  terminal_power: 'ask',
};

const RULES_STORAGE_KEY = 'jeeva_permission_rules';
const TARGETS_STORAGE_KEY = 'jeeva_allowed_targets';
const AUDIT_STORAGE_KEY = 'jeeva_audit_log';
const sessionAllowedCategories = new Set();

export function getTargetScope(name, args = {}) {
  if (name === 'open_application' || name === 'close_application' || name === 'control_app_window') {
    const app = String(args.app_name || '').trim().toLowerCase().replace(/\.exe$/i, '');
    return app ? `app:${app}` : '';
  }
  if (name === 'file_operation' && args.path) {
    const p = String(args.path).trim();
    const dir = p.includes('\\') || p.includes('/') ? p.replace(/[\\/][^\\/]+$/, '') : p;
    return dir ? `path:${dir.toLowerCase()}` : '';
  }
  if (name === 'file_manager_pro' && args.source) {
    return `path:${String(args.source).trim().toLowerCase()}`;
  }
  return '';
}

export function getAllowedTargets() {
  try {
    const raw = localStorage.getItem(TARGETS_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function allowTargetPermanently(targetScope) {
  if (!targetScope) return [];
  const next = Array.from(new Set([...getAllowedTargets(), targetScope]));
  try {
    localStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export function isTargetAllowed(targetScope) {
  if (!targetScope) return false;
  return getAllowedTargets().includes(targetScope);
}

export function getToolCategory(name, args = {}) {
  switch (name) {
    case 'control_volume':
    case 'brightness_control':
    case 'media_control':
    case 'get_battery_status':
    case 'get_wifi_status':
    case 'get_system_info':
      return 'hardware_settings';

    case 'open_windows_setting':
    case 'toggle_windows_theme':
      return 'apps_window';

    case 'generate_image_tool':
      return 'apps_window';

    case 'system_diagnostics':
      return args?.action === 'kill_process' ? 'terminal_power' : 'hardware_settings';

    case 'pc_power_tools':
      return args?.action === 'empty_recycle_bin'
        ? 'terminal_power'
        : args?.action === 'power_plan' && args?.plan && args?.plan !== 'get'
          ? 'apps_window'
          : 'hardware_settings';

    case 'open_application':
    case 'get_running_apps':
    case 'list_installed_software':
    case 'control_app_window':
    case 'open_url':
    case 'search_web':
      return 'apps_window';

    case 'browser_control':
      return ['youtube_skip_ad', 'launch_debug'].includes(args?.action) ? 'screen_input' : 'apps_window';

    case 'schedule_pc_task':
      return args?.action === 'delayed_command' ? 'terminal_power' : 'apps_window';

    case 'close_application':
      return 'software_manage';

    case 'manage_software':
      return args?.action === 'search' ? 'apps_window' : 'software_manage';

    case 'file_operation':
    case 'read_document_file':
    case 'save_desktop_note':
    case 'manage_clipboard':
    case 'file_manager_pro':
    case 'clipboard_history':
    case 'memory_rag':
    case 'episodic_recall':
      return 'files_storage';

    case 'take_screenshot':
    case 'type_text':
    case 'press_shortcut':
    case 'ui_automate':
    case 'mouse_and_hotkey':
    case 'screen_reader':
      return 'screen_input';

    case 'run_system_command':
    case 'system_power':
      return 'terminal_power';

    default:
      return 'apps_window';
  }
}

export function isSensitiveVoiceAction(name, args = {}) {
  if (getToolRiskLevel(name, args) === 'high') return true;
  if (name === 'open_windows_setting' || name === 'toggle_windows_theme') return true;
  if (name === 'get_wifi_status' && String(args?.action || '').toLowerCase() === 'off') return true;
  if (name === 'pc_power_tools' && args?.action === 'power_plan' && args?.plan && args?.plan !== 'get') return true;
  if (name === 'file_operation' && args?.operation === 'write') return true;
  return false;
}

export function getToolRiskLevel(name, args = {}) {
  if (
    name === 'system_power' ||
    name === 'close_application' ||
    name === 'run_system_command' ||
    (name === 'manage_software' && ['install', 'uninstall', 'update'].includes(args?.action)) ||
    (name === 'file_operation' && args?.operation === 'delete') ||
    (name === 'system_diagnostics' && args?.action === 'kill_process') ||
    (name === 'pc_power_tools' && args?.action === 'empty_recycle_bin') ||
    (name === 'schedule_pc_task' && args?.action === 'delayed_command') ||
    (name === 'file_manager_pro' && ['organize_folder', 'move', 'rename'].includes(args?.action))
  ) {
    return 'high';
  }
  if (
    name === 'ui_automate' ||
    name === 'mouse_and_hotkey' ||
    name === 'open_windows_setting' ||
    name === 'toggle_windows_theme' ||
    (name === 'browser_control' && ['youtube_skip_ad', 'launch_debug'].includes(args?.action)) ||
    name === 'type_text' ||
    name === 'press_shortcut' ||
    name === 'open_application' ||
    name === 'control_app_window' ||
    name === 'take_screenshot' ||
    (name === 'file_operation' && args?.operation === 'write') ||
    (name === 'file_manager_pro' && ['mkdir', 'zip', 'unzip'].includes(args?.action)) ||
    (name === 'pc_power_tools' && args?.action === 'power_plan' && args?.plan && args?.plan !== 'get') ||
    (name === 'schedule_pc_task' && args?.action === 'remind') ||
    (name === 'clipboard_history' && args?.action === 'paste_index')
  ) {
    return 'medium';
  }
  return 'low';
}

export function formatToolSummary(name, args = {}) {
  switch (name) {
    case 'open_application':
      return `Open application "${args.app_name || ''}"${args.args ? ` with "${args.args}"` : ''}`;
    case 'close_application':
      return `Force-close application "${args.app_name || ''}"`;
    case 'list_installed_software':
      return `List installed PC software${args.filter ? ` matching "${args.filter}"` : ''}`;
    case 'manage_software':
      return `${String(args.action || 'manage').toUpperCase()} software "${args.package || ''}" via winget`;
    case 'control_app_window':
      return `Window "${args.action || 'focus'}" on "${args.app_name || ''}"`;
    case 'ui_automate':
      return `UI ${args.action || 'inspect'} on "${args.app_name || ''}"${args.element ? ` -> "${args.element}"` : ''}`;
    case 'browser_control':
      return `Browser "${args.action || 'active_tab_info'}"${args.value ? `: ${args.value}` : ''}`;
    case 'generate_image_tool':
      return `Generate image: "${String(args.prompt || '').slice(0, 60)}"`;
    case 'mouse_and_hotkey':
      if (args.action === 'hotkey') return `Press keyboard shortcut "${args.keys || ''}"`;
      if (args.action === 'paste_text') return `Paste text into active window (${String(args.text || '').length} chars)`;
      return `Mouse ${args.action || 'click'} at (${args.x ?? 0}, ${args.y ?? 0})`;
    case 'system_diagnostics':
      return args.action === 'kill_process'
        ? `Kill Windows process "${args.target || ''}"`
        : `Run PC diagnostics (${args.action || 'overview'})`;
    case 'file_manager_pro':
      return `File action "${args.action || ''}": ${args.source || ''}${args.dest ? ` -> ${args.dest}` : ''}`;
    case 'clipboard_history':
      return args.action === 'paste_index'
        ? `Paste clipboard history item #${args.index ?? 0}`
        : 'Read recent clipboard history';
    case 'schedule_pc_task':
      return args.action === 'delayed_command'
        ? `Schedule delayed command (${args.delay_minutes || 1}m): ${args.command || ''}`
        : `Schedule/manage PC task (${args.action || 'list'})`;
    case 'pc_power_tools':
      if (args.action === 'empty_recycle_bin') return 'Permanently empty Windows Recycle Bin';
      if (args.action === 'power_plan') return `Power plan: ${args.plan || 'get'}`;
      return `PC Power / Display tool: ${args.action || 'display_info'}`;
    case 'control_volume':
      return `Set volume (${args.action}${args.level !== undefined ? ` ${args.level}%` : ''})`;
    case 'brightness_control':
      return `Set brightness (${args.action}${args.level !== undefined ? ` ${args.level}%` : ''})`;
    case 'file_operation':
      return `File ${args.operation || 'access'}: ${args.path || args.query || 'home'}`;
    case 'run_system_command':
      return `Execute shell command: ${args.command || ''}`;
    case 'system_power':
      return `System power action: ${args.action || ''}`;
    default:
      return `${name.replace(/_/g, ' ')}`;
  }
}

export function isRemoteEnvironment() {
  return false;
}

export function getPermissionRules() {
  const defaults = isRemoteEnvironment() ? DEFAULT_REMOTE_RULES : DEFAULT_LOCAL_RULES;
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

export function savePermissionRules(rules) {
  const defaults = isRemoteEnvironment() ? DEFAULT_REMOTE_RULES : DEFAULT_LOCAL_RULES;
  const merged = { ...defaults, ...rules };
  localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(merged));
  window.electronAPI?.syncPermissionRules?.(merged).catch?.(() => {});
  return merged;
}

export function clearSessionCategoryPermissions() {
  sessionAllowedCategories.clear();
}

export function allowCategoryForSession(categoryId) {
  sessionAllowedCategories.add(categoryId);
}

export function getCategoryPolicy(categoryId) {
  if (sessionAllowedCategories.has(categoryId)) return 'session';
  const rules = getPermissionRules();
  return rules[categoryId] || 'ask';
}

export function getAuditLog() {
  try {
    const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function appendAuditLog(entry) {
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
      source: isRemoteEnvironment() ? 'remote' : 'local',
      ...entry,
    },
    ...log,
  ].slice(0, 100);
  try {
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export function clearAuditLog() {
  localStorage.removeItem(AUDIT_STORAGE_KEY);
}
