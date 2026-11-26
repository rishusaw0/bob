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
  browserControl: (sub, value) => ipcRenderer.invoke('system:browserControl', sub, value),

  // Offline SAPI Voice Engine & Auto-Updater
  offlineVoiceStart: (aiName) => ipcRenderer.invoke('voice:offlineStart', aiName),
  offlineVoiceStop: () => ipcRenderer.invoke('voice:offlineStop'),
  offlineVoiceSetName: (aiName) => ipcRenderer.invoke('voice:offlineSetName', aiName),
  offlineVoiceStatus: () => ipcRenderer.invoke('voice:offlineStatus'),
  onOfflineVoiceEvent: (cb) => {
    const listener = (_, ev) => cb(ev);
    ipcRenderer.on('voice:offlineEvent', listener);
    return () => ipcRenderer.removeListener('voice:offlineEvent', listener);
  },
  checkForUpdates: (cfg) => ipcRenderer.invoke('updater:check', cfg),
  downloadUpdate: (url) => ipcRenderer.invoke('updater:download', url),
  getUpdaterState: () => ipcRenderer.invoke('updater:getState'),
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

  // Bridge, Vault, Permissions & Cloud Relay
  getBridgeInfo: () => ipcRenderer.invoke('bridge:info'),
  vaultSaveKey: (key) => ipcRenderer.invoke('vault:saveKey', key),
  vaultGetKey: () => ipcRenderer.invoke('vault:getKey'),
  syncPermissionRules: (rules) => ipcRenderer.invoke('permissions:sync', rules),
  getPermissionRules: () => ipcRenderer.invoke('permissions:get'),
  getHostAuditLog: () => ipcRenderer.invoke('permissions:auditGet'),
  clearHostAuditLog: () => ipcRenderer.invoke('permissions:auditClear'),
  relayConnect: (cfg) => ipcRenderer.invoke('relay:connect', cfg),
  relayDisconnect: () => ipcRenderer.invoke('relay:disconnect'),
  relayRegeneratePairToken: () => ipcRenderer.invoke('relay:regeneratePairToken'),
  relayStatus: () => ipcRenderer.invoke('relay:status'),
  onRelayStatusChange: (cb) => {
    const handler = (_, status) => cb(status);
    ipcRenderer.on('relay:statusChanged', handler);
    return () => ipcRenderer.removeListener('relay:statusChanged', handler);
  },
  onDeepLinked: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('relay:deepLinked', handler);
    return () => ipcRenderer.removeListener('relay:deepLinked', handler);
  },
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
});
