const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // System actions
  openApp: (appName, args) => ipcRenderer.invoke('system:openApp', appName, args),
  openURL: (url) => ipcRenderer.invoke('system:openURL', url),
  openSetting: (setting) => ipcRenderer.invoke('system:openSetting', setting),
  theme: (mode) => ipcRenderer.invoke('system:theme', mode),
  battery: () => ipcRenderer.invoke('system:battery'),
  wifi: (mode) => ipcRenderer.invoke('system:wifi', mode),
  runCommand: (cmd) => ipcRenderer.invoke('system:runCommand', cmd),
  readFile: (path) => ipcRenderer.invoke('system:readFile', path),
  readBinaryFile: (path) => ipcRenderer.invoke('system:readBinaryFile', path),
  extractDocText: (payload) => ipcRenderer.invoke('system:extractDocText', payload),
  writeFile: (path, content) => ipcRenderer.invoke('system:writeFile', path, content),
  listFiles: (dir) => ipcRenderer.invoke('system:listFiles', dir),
  searchFiles: (query, dir) => ipcRenderer.invoke('system:searchFiles', query, dir),
  deleteFile: (path) => ipcRenderer.invoke('system:deleteFile', path),
  clipboard: (action, text) => ipcRenderer.invoke('system:clipboard', action, text),
  systemInfo: () => ipcRenderer.invoke('system:info'),
  screenshot: () => ipcRenderer.invoke('system:screenshot'),
  volume: (action, level) => ipcRenderer.invoke('system:volume', action, level),
  media: (action) => ipcRenderer.invoke('system:media', action),
  brightness: (action, level) => ipcRenderer.invoke('system:brightness', action, level),
  power: (action) => ipcRenderer.invoke('system:power', action),
  runningApps: () => ipcRenderer.invoke('system:runningApps'),
  closeApp: (appName) => ipcRenderer.invoke('system:closeApp', appName),
  typeText: (text) => ipcRenderer.invoke('system:typeText', text),
  minimizeAll: () => ipcRenderer.invoke('system:minimizeAll'),
  saveDesktopFile: (filename, content) => ipcRenderer.invoke('system:saveDesktopFile', filename, content),
  saveImage: (dataUrl, filename) => ipcRenderer.invoke('system:saveImage', dataUrl, filename),
  liveStats: () => ipcRenderer.invoke('system:liveStats'),
  adbControl: (action, arg) => ipcRenderer.invoke('system:adbControl', action, arg),

  // App & Software Engine
  listInstalledApps: (filter) => ipcRenderer.invoke('system:listInstalledApps', filter),
  manageSoftware: (action, pkg) => ipcRenderer.invoke('system:manageSoftware', action, pkg),
  windowControl: (action, targetApp) => ipcRenderer.invoke('system:windowControl', action, targetApp),
  uiAutomate: (action, appName, element, value) =>
    ipcRenderer.invoke('system:uiAutomate', action, appName, element, value),
  screenRead: (mode, targetText) => ipcRenderer.invoke('system:screenRead', mode, targetText),

  // Advanced Workstation & Automation
  mouseAction: (sub, x, y, x2, y2, delta, coordSpace) =>
    ipcRenderer.invoke('system:mouseAction', sub, x, y, x2, y2, delta, coordSpace),
  sendHotkey: (combo) => ipcRenderer.invoke('system:sendHotkey', combo),
  typeClipboard: (text) => ipcRenderer.invoke('system:typeClipboard', text),
  diagnostics: (sub, extra) => ipcRenderer.invoke('system:diagnostics', sub, extra),
  manageProcess: (sub, target) => ipcRenderer.invoke('system:manageProcess', sub, target),
  filePro: (sub, source, dest) => ipcRenderer.invoke('system:filePro', sub, source, dest),
  powerProfile: (plan) => ipcRenderer.invoke('system:powerProfile', plan),
  emptyRecycleBin: () => ipcRenderer.invoke('system:emptyRecycleBin'),
  clipboardHistory: (sub, index) => ipcRenderer.invoke('clipboard:history', sub, index),
  scheduler: (sub, arg1, arg2, arg3) => ipcRenderer.invoke('scheduler:manage', sub, arg1, arg2, arg3),
  memoryRag: (sub, contentOrQuery, category) => ipcRenderer.invoke('memory:rag', sub, contentOrQuery, category),
  macros: (sub, payload, stats) => ipcRenderer.invoke('macros:manage', sub, payload, stats),
  onWatchdogAlert: (cb) => {
    const listener = (_, alert) => cb(alert);
    ipcRenderer.on('watchdog:alert', listener);
    return () => ipcRenderer.removeListener('watchdog:alert', listener);
  },
  browserControl: (sub, value) => ipcRenderer.invoke('system:browserControl', sub, value),

  // Auto-Updater
  checkForUpdates: (cfg) => ipcRenderer.invoke('updater:check', cfg),
  downloadUpdate: (url) => ipcRenderer.invoke('updater:download', url),
  getUpdaterState: () => ipcRenderer.invoke('updater:getState'),
  onUpdaterStatus: (cb) => {
    const listener = (_, st) => cb(st);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
  episodicLog: (entry) => ipcRenderer.invoke('episodic:log', entry),
  episodicQuery: (filters) => ipcRenderer.invoke('episodic:query', filters),
  episodicSummaries: (days) => ipcRenderer.invoke('episodic:summaries', days),
  episodicForgetDay: (dateKey) => ipcRenderer.invoke('episodic:forgetDay', dateKey),
  episodicClear: () => ipcRenderer.invoke('episodic:clear'),
  onUpdaterStatus: (cb) => {
    const listener = (_, st) => cb(st);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
  onOpenPcControl: (cb) => {
    const listener = (_, tab) => cb(tab);
    ipcRenderer.on('ui:openPcControl', listener);
    return () => ipcRenderer.removeListener('ui:openPcControl', listener);
  },
  onOpenSettings: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('ui:openSettings', listener);
    return () => ipcRenderer.removeListener('ui:openSettings', listener);
  },
  onSchedulerFired: (cb) => {
    const handler = (_, payload) => cb(payload);
    ipcRenderer.on('scheduler:fired', handler);
    return () => ipcRenderer.removeListener('scheduler:fired', handler);
  },
  onSchedulerUpdated: (cb) => {
    const handler = (_, items) => cb(items);
    ipcRenderer.on('scheduler:updated', handler);
    return () => ipcRenderer.removeListener('scheduler:updated', handler);
  },
  onClipboardUpdated: (cb) => {
    const handler = (_, items) => cb(items);
    ipcRenderer.on('clipboard:updated', handler);
    return () => ipcRenderer.removeListener('clipboard:updated', handler);
  },

  // Bridge, Vault & Permissions
  vaultSaveKey: (key) => ipcRenderer.invoke('vault:saveKey', key),
  vaultGetKey: () => ipcRenderer.invoke('vault:getKey'),
  syncPermissionRules: (rules) => ipcRenderer.invoke('permissions:sync', rules),
  getPermissionRules: () => ipcRenderer.invoke('permissions:get'),
  getHostAuditLog: () => ipcRenderer.invoke('permissions:auditGet'),
  clearHostAuditLog: () => ipcRenderer.invoke('permissions:auditClear'),
  getAutoLaunch: () => ipcRenderer.invoke('app:getAutoLaunch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('app:setAutoLaunch', enabled),

  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  setWindowMode: (mode) => ipcRenderer.invoke('window:setMode', mode),
  wakeRestore: (mode) => ipcRenderer.invoke('window:wakeRestore', mode),
  hideToTray: () => ipcRenderer.invoke('window:hideToTray'),
  onWindowModeChange: (cb) => {
    const handler = (_, mode) => cb(mode);
    ipcRenderer.on('window:modeChanged', handler);
    return () => ipcRenderer.removeListener('window:modeChanged', handler);
  },
  onHotkeyWake: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('hotkey:wake', handler);
    return () => ipcRenderer.removeListener('hotkey:wake', handler);
  },
  updateNotchState: (state, options) => ipcRenderer.invoke('notch:update', state, options),
  notchAction: (action, payload) => ipcRenderer.invoke('notch:action', action, payload),
  getWindowPrefs: () => ipcRenderer.invoke('window:getPrefs'),
  saveWindowPrefs: (patch) => ipcRenderer.invoke('window:savePrefs', patch),
  getDisplays: () => ipcRenderer.invoke('window:getDisplays'),
  onNotchState: (cb) => {
    const handler = (_, state) => cb(state);
    ipcRenderer.on('notch:state', handler);
    return () => ipcRenderer.removeListener('notch:state', handler);
  },
  onNotchEvent: (cb) => {
    const handler = (_, ev) => cb(ev);
    ipcRenderer.on('notch:event', handler);
    return () => ipcRenderer.removeListener('notch:event', handler);
  },
  emergencyStop: () => ipcRenderer.invoke('app:emergencyStop'),
  getDiagnostics: () => ipcRenderer.invoke('app:getDiagnostics'),
  onEmergencyStop: (cb) => {
    const handler = (_, ev) => cb(ev);
    ipcRenderer.on('app:emergencyStop', handler);
    return () => ipcRenderer.removeListener('app:emergencyStop', handler);
  },
});
