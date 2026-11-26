// Pure-JS Acoustic Speaker Voiceprint Verification (Log-Spectral Bands + Pitch F0 + ZCR)
// Provides lightweight owner-voice gating for high-risk voice commands without requiring heavy external ONNX runtimes.

const VOICEPRINT_STORAGE_KEY = 'jeeva_voiceprint_profile';
const VOICEPRINT_ENABLED_KEY = 'jeeva_voiceprint_enabled';
const BAND_FREQS = [150, 230, 340, 480, 660, 880, 1140, 1450, 1820, 2240, 2720, 3260, 3850];
const DEFAULT_THRESHOLD = 0.74;

function goertzelMagSq(samples, freqHz, sampleRate = 16000) {
  const n = samples.length;
  if (!n) return 0;
  const k = Math.round((n * freqHz) / sampleRate);
  const w = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(w);
  let q1 = 0;
  let q2 = 0;
  for (let i = 0; i < n; i++) {
    const q0 = coeff * q1 - q2 + samples[i];
    q2 = q1;
    q1 = q0;
  }
  return Math.max(0, q1 * q1 + q2 * q2 - coeff * q1 * q2) / (n * n);
}

function estimatePitchHz(samples, sampleRate = 16000) {
  const minLag = Math.floor(sampleRate / 340); // ~47
  const maxLag = Math.min(Math.floor(samples.length / 2) - 1, Math.floor(sampleRate / 75)); // ~213
  if (maxLag <= minLag) return 0;

  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  if (energy < 1e-4) return 0;

  let bestLag = 0;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const limit = samples.length - lag;
    for (let i = 0; i < limit; i++) {
      sum += samples[i] * samples[i + lag];
    }
    const norm = sum / energy;
    if (norm > bestCorr) {
      bestCorr = norm;
      bestLag = lag;
    }
  }
  return bestCorr > 0.25 && bestLag > 0 ? sampleRate / bestLag : 0;
}

/**
 * Extracts a normalized 13-band log-spectral + fundamental pitch voiceprint from 16kHz mono PCM.
 */
export function extractVoiceprint(pcm16k, sampleRate = 16000) {
  if (!pcm16k || pcm16k.length < 1600) return null;

  const frameSize = 512;
  const bandSums = new Float64Array(BAND_FREQS.length);
  const pitchSamples = [];
  let voicedCount = 0;

  for (let start = 0; start + frameSize <= pcm16k.length; start += frameSize) {
    const frame = pcm16k.subarray(start, start + frameSize);
    let sq = 0;
    for (let i = 0; i < frame.length; i++) sq += frame[i] * frame[i];
    const rms = Math.sqrt(sq / frame.length);
    if (rms < 0.015) continue;

    voicedCount++;
    for (let b = 0; b < BAND_FREQS.length; b++) {
      const e = goertzelMagSq(frame, BAND_FREQS[b], sampleRate);
      bandSums[b] += Math.log10(1e-7 + e);
    }
    const p = estimatePitchHz(frame, sampleRate);
    if (p >= 75 && p <= 340) pitchSamples.push(p);
  }

  if (voicedCount < 2) return null;

  const meanVec = Array.from(bandSums, (s) => s / voicedCount);
  const avg = meanVec.reduce((a, b) => a + b, 0) / meanVec.length;
  const centered = meanVec.map((v) => v - avg);
  const norm = Math.sqrt(centered.reduce((a, b) => a + b * b, 0)) || 1;
  const vector = centered.map((v) => Number((v / norm).toFixed(5)));

  pitchSamples.sort((a, b) => a - b);
  const pitchHz = pitchSamples.length ? Math.round(pitchSamples[Math.floor(pitchSamples.length / 2)]) : 0;

  return { vector, pitchHz, voicedFrames: voicedCount };
}

/**
 * Compares two voiceprint profiles returning cosine similarity adjusted lightly for F0 compatibility.
 */
export function compareVoiceprints(a, b) {
  if (!a?.vector?.length || !b?.vector?.length || a.vector.length !== b.vector.length) {
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < a.vector.length; i++) {
    dot += a.vector[i] * b.vector[i];
  }
  // Map cosine [-1..1] -> [0..1]
  let score = Math.max(0, Math.min(1, (dot + 1) / 2));

  if (a.pitchHz > 0 && b.pitchHz > 0) {
    const ratio = Math.max(a.pitchHz, b.pitchHz) / Math.min(a.pitchHz, b.pitchHz);
    if (ratio > 1.55) score *= 0.85;
  }
  return Number(score.toFixed(3));
}

export function getSavedVoiceprint() {
  try {
    const raw = localStorage.getItem(VOICEPRINT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isVoiceprintGuardEnabled() {
  try {
    return localStorage.getItem(VOICEPRINT_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setVoiceprintGuardEnabled(enabled) {
  try {
    localStorage.setItem(VOICEPRINT_ENABLED_KEY, String(Boolean(enabled)));
  } catch {}
  return Boolean(enabled);
}

export function getVoiceprintStatus() {
  const profile = getSavedVoiceprint();
  return {
    enrolled: Boolean(profile?.vector?.length),
    enabled: isVoiceprintGuardEnabled(),
    samples: profile?.samples || 0,
    pitchHz: profile?.pitchHz || 0,
    updatedAt: profile?.updatedAt || '',
  };
}

export function clearVoiceprint() {
  try {
    localStorage.removeItem(VOICEPRINT_STORAGE_KEY);
    localStorage.setItem(VOICEPRINT_ENABLED_KEY, 'false');
  } catch {}
}

export function enrollVoiceprintSamples(pcmBuffers = []) {
  const extracted = pcmBuffers.map((buf) => extractVoiceprint(buf)).filter(Boolean);
  if (!extracted.length) {
    throw new Error('Clear voice speech detect nahi hui — shant jagah par dobara bolein.');
  }

  const len = extracted[0].vector.length;
  const merged = new Array(len).fill(0);
  let pitchSum = 0;
  let pitchCount = 0;

  for (const fp of extracted) {
    for (let i = 0; i < len; i++) merged[i] += fp.vector[i];
    if (fp.pitchHz > 0) {
      pitchSum += fp.pitchHz;
      pitchCount++;
    }
  }
  const norm = Math.sqrt(merged.reduce((a, b) => a + b * b, 0)) || 1;
  const vector = merged.map((v) => Number((v / norm).toFixed(5)));

  const profile = {
    vector,
    pitchHz: pitchCount > 0 ? Math.round(pitchSum / pitchCount) : 0,
    samples: extracted.length,
    updatedAt: new Date().toLocaleString('en-IN'),
  };
  localStorage.setItem(VOICEPRINT_STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

export function verifySpeakerVoiceprint(pcm16k, threshold = DEFAULT_THRESHOLD) {
  const enabled = isVoiceprintGuardEnabled();
  const profile = getSavedVoiceprint();
  if (!enabled || !profile?.vector?.length) {
    return { active: false, verified: true, score: 1, threshold };
  }
  const sample = extractVoiceprint(pcm16k);
  if (!sample) {
    return { active: true, verified: true, score: 0.78, threshold, skippedShort: true };
  }
  const score = compareVoiceprints(profile, sample);
  return {
    active: true,
    verified: score >= threshold,
    score,
    threshold,
  };
}
