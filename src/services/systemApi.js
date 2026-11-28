// Desktop-only system bridge. All privileged actions stay inside Electron IPC.
export function isDesktopElectron() {
  return Boolean(typeof window !== 'undefined' && window.electronAPI);
}

export function getSystemAPI() {
  return isDesktopElectron() ? window.electronAPI : null;
}
