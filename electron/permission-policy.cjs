// Strict Electron Permission Policy (Default Deny)
// Only permits audio-only microphone access for trusted local application origins.

function isTrustedRendererOrigin(originUrl) {
  const o = String(originUrl || '').trim();
  if (!o) return false;
  return o.startsWith('file://') || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(o);
}

function evaluateElectronPermission({ permission = '', origin = '', mediaTypes = null } = {}) {
  if (!isTrustedRendererOrigin(origin)) {
    return false;
  }
  const perm = String(permission || '').trim();
  if (perm === 'audioCapture') {
    return true;
  }
  if (perm === 'media') {
    // Deny camera ('video') unless explicitly audio-only or unspecified audio mic check
    if (Array.isArray(mediaTypes) && mediaTypes.length > 0) {
      return mediaTypes.every((t) => t === 'audio');
    }
    return true;
  }
  // Default deny: camera, geolocation, notifications, midi, usb, hid, serial, unknown, etc.
  return false;
}

module.exports = {
  isTrustedRendererOrigin,
  evaluateElectronPermission,
};
