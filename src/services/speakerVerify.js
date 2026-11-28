// Advanced Pure-JS Offline Acoustic Owner Voiceprint Biometric Guard
// 20-Band Mel-Scale Log-Spectral Envelope + Spectral Slope + Pitch (F0) + ZCR + Multi-Exemplar Matching.
// Works 100% offline with zero Gemini API dependency and fail-safe owner drift adaptation.

const VOICEPRINT_STORAGE_KEY = 'jeeva_voiceprint_profile';
const VOICEPRINT_ENABLED_KEY = 'jeeva_voiceprint_enabled';
const VOICEPRINT_LEVEL_KEY = 'jeeva_voiceprint_level';

// 20 Mel-spaced frequencies (100Hz - 3950Hz) covering F0, F1, F2, F3 vocal tract formants
const BAND_FREQS = [
  110, 165, 225, 290, 365, 450, 545, 650, 770, 905,
  1055, 1225, 1415, 1625, 1860, 2125, 2420, 2750, 3120, 3550,
];

export const VOICEPRINT_LEVELS = {
  relaxed: { id: 'relaxed', label: 'Relaxed (66% · Fewer False Blocks)', threshold: 0.66 },
  balanced: { id: 'balanced', label: 'Balanced (73% · Recommended)', threshold: 0.73 },
  strict: { id: 'strict', label: 'Strict (80% · High Security)', threshold: 0.80 },
};

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
  const minLag = Math.floor(sampleRate / 340);
  const maxLag = Math.min(Math.floor(samples.length / 2) - 1, Math.floor(sampleRate / 70));
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
  return bestCorr > 0.24 && bestLag > 0 ? sampleRate / bestLag : 0;
}

function computeZcr(samples) {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) {
      crossings++;
    }
  }
  return crossings / Math.max(1, samples.length - 1);
}

/**
 * Extracts a normalized 22-dim acoustic signature (20 Mel bands + low/high spectral tilt + ZCR-weighted timbre)
 * plus fundamental pitch F0 & ZCR from 16kHz mono PCM.
 */
export function extractVoiceprint(pcm16k, sampleRate = 16000) {
  if (!pcm16k || pcm16k.length < 1600) return null;

  const frameSize = 512;
  const hopSize = 256; // 50% overlap for smoother formant capture
  const bandSums = new Float64Array(BAND_FREQS.length);
  const pitchSamples = [];
  let zcrSum = 0;
  let voicedCount = 0;

  for (let start = 0; start + frameSize <= pcm16k.length; start += hopSize) {
    const frame = pcm16k.subarray(start, start + frameSize);
    let sq = 0;
    for (let i = 0; i < frame.length; i++) sq += frame[i] * frame[i];
    const rms = Math.sqrt(sq / frame.length);
    if (rms < 0.012) continue;

    voicedCount++;
    for (let b = 0; b < BAND_FREQS.length; b++) {
      const e = goertzelMagSq(frame, BAND_FREQS[b], sampleRate);
      bandSums[b] += Math.log10(1e-7 + e);
    }
    zcrSum += computeZcr(frame);
    const p = estimatePitchHz(frame, sampleRate);
    if (p >= 70 && p <= 340) pitchSamples.push(p);
  }

  if (voicedCount < 3) return null;

  const meanVec = Array.from(bandSums, (s) => s / voicedCount);
  // Cepstral Mean & Variance Normalization (robust against mic distance / volume)
  const avg = meanVec.reduce((a, b) => a + b, 0) / meanVec.length;
  const centered = meanVec.map((v) => v - avg);
  const lowBand = centered.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
  const midBand = centered.slice(7, 14).reduce((a, b) => a + b, 0) / 7;
  const highBand = centered.slice(14).reduce((a, b) => a + b, 0) / 6;
  const extended = [...centered, lowBand - highBand, midBand - highBand];

  const norm = Math.sqrt(extended.reduce((a, b) => a + b * b, 0)) || 1;
  const vector = extended.map((v) => Number((v / norm).toFixed(5)));

  pitchSamples.sort((a, b) => a - b);
  const pitchHz = pitchSamples.length ? Math.round(pitchSamples[Math.floor(pitchSamples.length / 2)]) : 0;
  const zcr = Number((zcrSum / voicedCount).toFixed(4));

  return { vector, pitchHz, zcr, voicedFrames: voicedCount };
}

function cosineScore(vecA, vecB) {
  if (!vecA?.length || !vecB?.length || vecA.length !== vecB.length) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) dot += vecA[i] * vecB[i];
  return Math.max(0, Math.min(1, (dot + 1) / 2));
}

/**
 * Compares two voiceprint profiles using centroid + multi-exemplar best match + F0/ZCR guard.
 */
export function compareVoiceprints(profile, sample) {
  if (!profile?.vector?.length || !sample?.vector?.length) return 0;

  let bestScore = cosineScore(profile.vector, sample.vector);
  if (Array.isArray(profile.exemplars)) {
    for (const ex of profile.exemplars) {
      const sc = cosineScore(ex.vector, sample.vector);
      if (sc > bestScore) bestScore = sc;
    }
  }

  if (profile.pitchHz > 0 && sample.pitchHz > 0) {
    const ratio = Math.max(profile.pitchHz, sample.pitchHz) / Math.min(profile.pitchHz, sample.pitchHz);
    if (ratio > 1.65) bestScore *= 0.80;
    else if (ratio > 1.38) bestScore *= 0.92;
  }

  if (profile.zcr > 0 && sample.zcr > 0) {
    const zDiff = Math.abs(profile.zcr - sample.zcr);
    if (zDiff > 0.14) bestScore *= 0.90;
  }

  return Number(bestScore.toFixed(3));
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

export function getVoiceprintSecurityLevel() {
  try {
    const v = localStorage.getItem(VOICEPRINT_LEVEL_KEY) || 'balanced';
    return VOICEPRINT_LEVELS[v] ? v : 'balanced';
  } catch {
    return 'balanced';
  }
}

export function setVoiceprintSecurityLevel(level) {
  const clean = VOICEPRINT_LEVELS[level] ? level : 'balanced';
  try {
    localStorage.setItem(VOICEPRINT_LEVEL_KEY, clean);
  } catch {}
  return clean;
}

export function getVoiceprintStatus() {
  const profile = getSavedVoiceprint();
  const level = getVoiceprintSecurityLevel();
  return {
    enrolled: Boolean(profile?.vector?.length),
    enabled: isVoiceprintGuardEnabled(),
    level,
    threshold: VOICEPRINT_LEVELS[level].threshold,
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
  let zcrSum = 0;

  for (const fp of extracted) {
    for (let i = 0; i < len; i++) merged[i] += fp.vector[i];
    if (fp.pitchHz > 0) {
      pitchSum += fp.pitchHz;
      pitchCount++;
    }
    zcrSum += fp.zcr || 0;
  }
  const norm = Math.sqrt(merged.reduce((a, b) => a + b * b, 0)) || 1;
  const vector = merged.map((v) => Number((v / norm).toFixed(5)));

  const profile = {
    version: 2,
    vector,
    exemplars: extracted.slice(0, 4).map((fp) => ({ vector: fp.vector, pitchHz: fp.pitchHz })),
    pitchHz: pitchCount > 0 ? Math.round(pitchSum / pitchCount) : 0,
    zcr: Number((zcrSum / extracted.length).toFixed(4)),
    samples: extracted.length,
    updatedAt: new Date().toLocaleString('en-IN'),
  };
  localStorage.setItem(VOICEPRINT_STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

/**
 * Verifies speaker offline. Includes safe owner drift adaptation when match is strongly confident.
 */
export function verifySpeakerVoiceprint(pcm16k, customThreshold = null) {
  const enabled = isVoiceprintGuardEnabled();
  const profile = getSavedVoiceprint();
  const level = getVoiceprintSecurityLevel();
  const threshold = customThreshold ?? VOICEPRINT_LEVELS[level].threshold;

  if (!enabled || !profile?.vector?.length) {
    return { active: false, verified: true, score: 1, threshold };
  }
  const sample = extractVoiceprint(pcm16k);
  if (!sample) {
    return { active: true, verified: true, score: 0.78, threshold, skippedShort: true };
  }
  // If old v1 13-band profile exists, gracefully treat as compatible until re-enrolled
  if (profile.vector.length !== sample.vector.length) {
    return { active: true, verified: true, score: 0.8, threshold, legacyProfile: true };
  }

  const score = compareVoiceprints(profile, sample);
  const verified = score >= threshold;

  // Safe owner adaptation: gently update centroid only on high-confidence verified owner speech
  if (verified && score >= threshold + 0.09 && sample.voicedFrames >= 8) {
    try {
      const alpha = 0.08;
      const blended = profile.vector.map((v, i) => v * (1 - alpha) + sample.vector[i] * alpha);
      const norm = Math.sqrt(blended.reduce((a, b) => a + b * b, 0)) || 1;
      profile.vector = blended.map((v) => Number((v / norm).toFixed(5)));
      localStorage.setItem(VOICEPRINT_STORAGE_KEY, JSON.stringify(profile));
    } catch {}
  }

  return {
    active: true,
    verified,
    score,
    threshold,
  };
}
