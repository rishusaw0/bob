// Windows desktop IPC bridge. No browser, mobile, LAN-pairing or hosted relay mode.
export function isDesktopElectron() {
  return Boolean(window.electronAPI);
}

export function getSystemAPI() {
  return window.electronAPI || null;
}
