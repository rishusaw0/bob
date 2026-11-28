// Gemini-only service policy. Offline operation is limited to deterministic Windows utilities.

const STRICT_OFFLINE_KEY = 'jeeva_strict_offline_mode';

export const SERVICE_CLASSIFICATION = [
  { id: 'pc_automation', name: 'Deterministic Windows PC controls', tier: 'Fully Offline' },
  { id: 'file_manager', name: 'Smart File Manager & Duplicate Finder', tier: 'Fully Offline' },
  { id: 'scheduler', name: '90-Day Scheduler & Missed Catch-Up', tier: 'Fully Offline' },
  { id: 'voiceprint_guard', name: '22-Band Owner Voiceprint Guard', tier: 'Fully Offline' },
  { id: 'win_ocr', name: 'Windows OCR Screen Reader', tier: 'Requires Windows Capability' },
  { id: 'gemini_cloud', name: 'Gemini 3.5 Flash-Lite chat, transcription & Gemini TTS', tier: 'Requires API Key and internet' },
];

export function isStrictOfflineMode() {
  // Ignore legacy preference flags; AI is online Gemini-only, offline utilities still run.
  return false;
}

export function setStrictOfflineMode(enabled) {
  const clean = false;
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STRICT_OFFLINE_KEY);
  } catch {}
  return clean;
}

export function isOnlineNow() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function canUseExternalCloud() {
  return isOnlineNow();
}

export function assertCloudAllowed(featureName = 'Cloud AI') {
  if (!isOnlineNow()) {
    throw new Error(`${featureName} unavailable: Internet connection is offline.`);
  }
}
