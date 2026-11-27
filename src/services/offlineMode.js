// Offline-First Service Manager & Strict Offline Mode Enforcement
// Prevents unexpected cloud requests when Strict Offline Mode is enabled or internet is unavailable.

const STRICT_OFFLINE_KEY = 'jeeva_strict_offline_mode';

export const SERVICE_CLASSIFICATION = [
  { id: 'local_quick_brain', name: 'Local Quick Brain (<30ms)', tier: 'Fully Offline' },
  { id: 'pc_automation', name: 'Windows PC Control (39 Tools)', tier: 'Fully Offline' },
  { id: 'file_manager', name: 'Smart File Manager & Duplicate Finder', tier: 'Fully Offline' },
  { id: 'memory_rag', name: 'Long-Term Memory RAG & 3-Month History', tier: 'Fully Offline' },
  { id: 'scheduler', name: '90-Day Scheduler & Missed Catch-Up', tier: 'Fully Offline' },
  { id: 'voiceprint_guard', name: '22-Band Owner Voiceprint Guard', tier: 'Fully Offline' },
  { id: 'doc_extract', name: 'Digital PDF / DOCX / CSV / MD Reader', tier: 'Fully Offline' },
  { id: 'local_slm', name: 'On-Device SLM (Qwen 2.5 / Gemma 3)', tier: 'Offline After Setup' },
  { id: 'win_speech', name: 'Windows Speech Recognition (System.Speech)', tier: 'Offline After Setup' },
  { id: 'os_tts', name: 'OS Natural Voices (SpeechSynthesis)', tier: 'Offline After Setup' },
  { id: 'win_ocr', name: 'Windows OCR Screen Reader', tier: 'Requires Windows Capability' },
  { id: 'cloud_relay', name: 'Render Mobile Companion Relay', tier: 'Requires Internet' },
  { id: 'gemini_cloud', name: 'Gemini Cloud Chat, Live Call & Studio TTS', tier: 'Requires API Key' },
  { id: 'voice_clone', name: 'Gemini 3.8 Voice Replication', tier: 'Requires API Key' },
];

export function isStrictOfflineMode() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STRICT_OFFLINE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setStrictOfflineMode(enabled) {
  const clean = Boolean(enabled);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STRICT_OFFLINE_KEY, String(clean));
    }
  } catch {}
  return clean;
}

export function isOnlineNow() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function canUseExternalCloud() {
  return !isStrictOfflineMode() && isOnlineNow();
}

export function assertCloudAllowed(featureName = 'Cloud AI') {
  if (isStrictOfflineMode()) {
    throw new Error(`${featureName} blocked: Strict Offline Mode is enabled.`);
  }
  if (!isOnlineNow()) {
    throw new Error(`${featureName} unavailable: Internet connection is offline.`);
  }
}
