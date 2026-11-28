// Smart Multi-Voice Read-Aloud Engine (Indian English, Hindi, Hinglish + Realistic Human Studio Voices)
import { textToSpeech, isGeminiReady } from './gemini.js';
import { canUseExternalCloud } from './offlineMode.js';

export const VOICE_PROFILES = {
  auto: { id: 'auto', label: 'Auto Detect', shortLabel: 'Auto' },
  english: { id: 'english', label: 'Indian English', shortLabel: 'EN-IN' },
  hindi: { id: 'hindi', label: 'Hindi (Natural)', shortLabel: 'Hindi' },
  hinglish: { id: 'hinglish', label: 'Hinglish (Bilingual)', shortLabel: 'Hinglish' },
};

export const VOICE_PERSONAS = {
  natural_warm: { id: 'natural_warm', label: 'Natural Warm (Human)' },
  calm_pro: { id: 'calm_pro', label: 'Calm Executive (Male)' },
  crisp_studio: { id: 'crisp_studio', label: 'Crisp Studio (Female)' },
  conversational: { id: 'conversational', label: 'Friendly Conversational' },
};

const VOICE_ACCENT_KEY = 'jeeva_voice_accent';
const VOICE_PERSONA_KEY = 'jeeva_voice_persona';

function readStorage(key, fallback = '') {
  try {
    return (typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null) || fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, val) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, val);
  } catch {}
}

export function getVoiceAccent() {
  const v = readStorage(VOICE_ACCENT_KEY, 'indian');
  return v === 'global' ? 'global' : 'indian';
}

export function setVoiceAccent(accent) {
  const clean = accent === 'global' ? 'global' : 'indian';
  writeStorage(VOICE_ACCENT_KEY, clean);
  return clean;
}

export function getVoicePersona() {
  const v = readStorage(VOICE_PERSONA_KEY, 'natural_warm');
  return VOICE_PERSONAS[v] ? v : 'natural_warm';
}

export function setVoicePersona(persona) {
  const clean = VOICE_PERSONAS[persona] ? persona : 'natural_warm';
  writeStorage(VOICE_PERSONA_KEY, clean);
  resetRegionalVoiceCache();
  return clean;
}

const ROMAN_HINDI_PHONETIC = new Map([
  ['accha', 'अच्छा'], ['acha', 'अच्छा'], ['achha', 'अच्छा'], ['ho', 'हो'], ['hai', 'है'], ['hain', 'हैं'], ['hoon', 'हूँ'], ['hun', 'हूँ'], ['nahi', 'नहीं'], ['nhi', 'नहीं'], ['nahin', 'नहीं'], ['kya', 'क्या'], ['kaise', 'कैसे'], ['kyun', 'क्यों'], ['aap', 'आप'], ['main', 'मैं'], ['maine', 'मैंने'], ['mera', 'मेरा'], ['meri', 'मेरी'], ['mere', 'मेरे'], ['bahut', 'बहुत'], ['bohot', 'बहुत'], ['thoda', 'थोड़ा'], ['theek', 'ठीक'], ['thik', 'ठीक'], ['karo', 'करो'], ['karna', 'करना'], ['raha', 'रहा'], ['rahi', 'रही'], ['rahe', 'रहे'], ['chahiye', 'चाहिए'], ['shukriya', 'शुक्रिया'], ['namaste', 'नमस्ते'], ['batao', 'बताओ'], ['samjho', 'समझो'],
]);

/** Convert common Romanized Hindi words to Devanagari before TTS, leaving English intact. */
export function normalizeRomanizedHindiForSpeech(text, profile = 'hinglish') {
  const source = String(text || '');
  if (!['hindi', 'hinglish'].includes(profile)) return source;
  return source.replace(/\b[a-z]+\b/gi, (word) => ROMAN_HINDI_PHONETIC.get(word.toLowerCase()) || word);
}

const HINGLISH_WORDS = new Set([
  'hai', 'hain', 'ho', 'hun', 'hoon', 'hu', 'ka', 'ki', 'ke', 'ko', 'se', 'me', 'mein',
  'par', 'pe', 'ne', 'nahi', 'nhi', 'na', 'kya', 'kaise', 'kasa', 'kab', 'kahan', 'kyun',
  'kyu', 'batao', 'bata', 'sunao', 'padh', 'padho', 'karo', 'kr', 'kro', 'kar', 'raha',
  'rahi', 'rahe', 'gaya', 'gayi', 'gaye', 'diya', 'liya', 'hoga', 'hogi', 'honge', 'hua',
  'hui', 'aap', 'tum', 'hum', 'ham', 'main', 'maine', 'mera', 'meri', 'mere', 'tera',
  'yahan', 'wahan', 'abhi', 'ab', 'aur', 'lekin', 'toh', 'bhi', 'acha', 'accha', 'bahut',
  'bhut', 'bhai', 'yaar', 'samjho', 'samjhao', 'kholo', 'chala', 'chalao', 'dekho', 'band',
  'sab', 'kuch', 'ye', 'yeh', 'wo', 'woh', 'ek', 'do', 'liye', 'lea', 'wala', 'wali',
  'wale', 'dena', 'lena', 'karna', 'hona', 'sakta', 'sakti', 'sakte', 'chahiye', 'zaroor',
  'bilkul', 'thik', 'theek', 'shukriya', 'dhanyawad', 'namaste', 'mausam', 'kaam', 'kam',
  'zyada', 'jyada', 'kaun', 'kaunsi', 'koi', 'koe', 'pehle', 'phala', 'baad', 'sirf',
  'serf', 'bas', 'apna', 'apni', 'apne', 'iske', 'iska', 'uski', 'usko', 'esko', 'esme',
  'isme', 'banaya', 'banao', 'bana', 'dijiye', 'kijiye', 'batayein', 'padhiye', 'sunaiye',
  'hoon', 'tha', 'thi', 'the', 'agar', 'magar', 'phir', 'fir', 'kyunki', 'isliye', 'taaki',
  'matlab', 'samajh', 'jaise', 'waise', 'kitna', 'kitni', 'chalta', 'chalti', 'karega',
  'hoga', 'mil', 'raha', 'dikh', 'sakoon', 'sake', 'chalo', 'aao', 'jao', 'bolo', 'bol',
]);

let selectedMode = readStorage('jeeva_voice_mode', 'auto');
const savedRate = Number(readStorage('jeeva_speech_rate', '1'));
const initialRate = [0.85, 1, 1.25, 1.5].includes(savedRate) ? savedRate : 1;

let currentState = {
  isPlaying: false,
  isPaused: false,
  isLoading: false,
  currentChunk: 0,
  totalChunks: 0,
  rate: initialRate,
  label: '',
  voiceMode: selectedMode,
  detectedProfile: 'hinglish',
  engine: 'gemini',
  audioLevel: 0,
  freqBands: [0, 0, 0, 0, 0],
};

let listeners = new Set();
let activeAudio = null;
let activeGain = null;
let activeAudioCtx = null;
let activeAudioNodes = null;
let activeMeterTimer = null;
let stopRequested = false;
let playbackToken = 0;
let duckScale = 1;

function notify() {
  const snapshot = { ...currentState };
  listeners.forEach(fn => fn(snapshot));
}

export function subscribeSpeech(fn) {
  listeners.add(fn);
  fn({ ...currentState });
  return () => listeners.delete(fn);
}

export function setVoiceMode(mode) {
  if (!VOICE_PROFILES[mode]) return;
  selectedMode = mode;
  writeStorage('jeeva_voice_mode', mode);
  currentState = { ...currentState, voiceMode: mode };
  notify();
}

export function getVoiceMode() {
  return selectedMode;
}

/**
 * Auto-detect whether text is English, Hindi (Devanagari), or Hinglish (mixed / Romanized Hindi).
 */
export function detectVoiceProfile(text) {
  const clean = String(text || '').trim();
  if (!clean) return 'english';

  const devanagariChars = (clean.match(/[\u0900-\u097F]/g) || []).length;
  const latinChars = (clean.match(/[a-zA-Z]/g) || []).length;
  const totalAlpha = devanagariChars + latinChars;

  if (totalAlpha > 0) {
    const devRatio = devanagariChars / totalAlpha;
    if (devRatio >= 0.55) return 'hindi';
    if (devRatio >= 0.08) return 'hinglish';
  }

  const words = clean.toLowerCase().match(/[a-z]+/g) || [];
  if (words.length === 0) return devanagariChars > 0 ? 'hindi' : 'english';

  let hinglishHits = 0;
  for (const w of words) {
    if (HINGLISH_WORDS.has(w)) hinglishHits++;
  }

  const ratio = hinglishHits / words.length;
  if (hinglishHits >= 2 || ratio >= 0.12) {
    return 'hinglish';
  }
  return 'english';
}

/**
 * Cleans markdown, technical symbols, paths, URLs, and spacing so spoken English/Hinglish sounds crystal clear.
 */
export function cleanTextForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' Code snippet. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, ' web link ')
    .replace(/[A-Za-z]:\\(?:[^\s\\/:*?"<>|]+\\)+([^\s\\/:*?"<>|]+)/g, '$1')
    .replace(/^\s*\|?[-:\s|]{3,}\|?\s*$/gm, ' ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n\s*[-*•]\s+/g, ', ')
    .replace(/\n/g, '. ')
    .replace(/([a-z])_([a-z])/gi, '$1 $2')
    .replace(/₹\s*([\d,]+(?:\.\d+)?)/g, '$1 rupees')
    .replace(/\bRs\.?\s*([\d,]+(?:\.\d+)?)/gi, '$1 rupees')
    .replace(/(\d+)\s*%/g, '$1 percent')
    .replace(/(\d+)\s*°\s*C\b/gi, '$1 degrees Celsius')
    .replace(/(\d+)\s*°\s*F\b/gi, '$1 degrees Fahrenheit')
    .replace(/\s*(?:->|=>|→)\s*/g, ', to ')
    .replace(/\s+&\s+/g, ' and ')
    .replace(/\bapprox\b\.?/gi, 'approximately')
    .replace(/\betc\b\.?/gi, 'and so on')
    .replace(/\bvs\.?\b/gi, 'versus')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[#*_~>|]/g, ' ')
    .replace(/\s*,\s*,+/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function findNextSentenceEnd(text) {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '।' || ch === '!' || ch === '?' || ch === '\n') return i;
    if (ch === '.') {
      const prev = i > 0 ? text[i - 1] : '';
      const next = i + 1 < text.length ? text[i + 1] : '';
      // Do NOT split on decimals (3.8, 1.0.0) or dotted abbreviations (Dr., Mr., e.g.)
      if (/\d/.test(prev) && /\d/.test(next)) continue;
      if (next && !/\s/.test(next)) continue;
      return i;
    }
  }
  return -1;
}

// Split with quick ~100 char first chunk and <=220 char chunks without breaking decimal numbers
export function splitIntoChunks(text, maxLen = 220, firstChunkMax = 100) {
  const clean = cleanTextForSpeech(text);
  if (!clean) return [];
  const rawSentences = [];
  let cursor = clean;
  while (cursor.length > 0) {
    const idx = findNextSentenceEnd(cursor);
    if (idx < 0) {
      rawSentences.push(cursor);
      break;
    }
    rawSentences.push(cursor.slice(0, idx + 1));
    cursor = cursor.slice(idx + 1).trimStart();
  }
  const chunks = [];
  let buffer = '';

  for (const s of rawSentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    const limit = chunks.length === 0 ? firstChunkMax : maxLen;
    if ((buffer + ' ' + trimmed).length <= limit) {
      buffer = buffer ? `${buffer} ${trimmed}` : trimmed;
    } else {
      if (buffer) chunks.push(buffer);
      if (trimmed.length <= limit) {
        buffer = trimmed;
      } else {
        const words = trimmed.split(' ');
        let part = '';
        for (const w of words) {
          if ((part + ' ' + w).length <= limit - 16) {
            part = part ? `${part} ${w}` : w;
          } else {
            if (part) chunks.push(part);
            part = w;
          }
        }
        buffer = part;
      }
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

function clearTtsMeter() {
  if (activeMeterTimer) {
    clearInterval(activeMeterTimer);
    activeMeterTimer = null;
  }
  // Reuse one AudioContext across sentence chunks; closing and reopening it
  // after every full stop adds avoidable startup latency.
  if (activeAudioNodes) {
    for (const node of activeAudioNodes) {
      try { node.disconnect(); } catch {}
    }
    activeAudioNodes = null;
  }
  activeGain = null;
  currentState = { ...currentState, audioLevel: 0, freqBands: [0, 0, 0, 0, 0] };
  notify();
}

export function duckSpeech(level = 0.16) {
  duckScale = Math.max(0.05, Math.min(1, Number(level) || 0.16));
  if (activeGain && activeAudioCtx) {
    try {
      activeGain.gain.setTargetAtTime(duckScale, activeAudioCtx.currentTime, 0.03);
    } catch {}
  } else if (activeAudio) {
    activeAudio.volume = duckScale;
  }
}

export function restoreSpeech() {
  duckScale = 1;
  if (activeGain && activeAudioCtx) {
    try {
      activeGain.gain.setTargetAtTime(1, activeAudioCtx.currentTime, 0.05);
    } catch {}
  } else if (activeAudio) {
    activeAudio.volume = 1;
  }
}

export async function fadeOutAndStopSpeech(durationMs = 130) {
  duckScale = 1;
  if (activeGain && activeAudioCtx) {
    try {
      activeGain.gain.setTargetAtTime(0.01, activeAudioCtx.currentTime, 0.03);
      await new Promise((r) => setTimeout(r, durationMs));
    } catch {}
  } else if (activeAudio) {
    activeAudio.volume = 0.05;
    await new Promise((r) => setTimeout(r, Math.min(100, durationMs)));
  }
  stopSpeech();
}

function playAudioUrl(audioUrl) {
  return new Promise((resolve, reject) => {
    if (stopRequested) return resolve();
    clearTtsMeter();
    const audio = new Audio(audioUrl);
    audio.preload = 'auto';
    audio.playbackRate = currentState.rate;
    audio.volume = 1;
    activeAudio = audio;

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = activeAudioCtx && activeAudioCtx.state !== 'closed' ? activeAudioCtx : new Ctx();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const src = ctx.createMediaElementSource(audio);
        const gain = ctx.createGain();
        gain.gain.value = duckScale;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(gain);
        gain.connect(analyser);
        analyser.connect(ctx.destination);
        activeAudioCtx = ctx;
        activeGain = gain;
        activeAudioNodes = [src, gain, analyser];

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        activeMeterTimer = setInterval(() => {
          if (!activeAudio || activeAudio.paused) return;
          analyser.getByteFrequencyData(freqData);
          const step = Math.max(1, Math.floor(freqData.length / 5));
          const bands = [];
          let sumAll = 0;
          for (let b = 0; b < 5; b++) {
            let s = 0;
            for (let k = 0; k < step; k++) s += freqData[b * step + k] || 0;
            const norm = Math.min(1, s / (step * 170));
            bands.push(norm);
            sumAll += norm;
          }
          currentState = { ...currentState, audioLevel: Math.min(1, sumAll / 5), freqBands: bands };
          notify();
        }, 55);
      }
    } catch {
      // Fall back safely to plain HTMLAudio playback if MediaElementSource fails
      audio.volume = duckScale;
    }

    audio.onended = () => {
      if (activeAudio === audio) activeAudio = null;
      clearTtsMeter();
      resolve();
    };
    audio.onerror = () => {
      if (activeAudio === audio) activeAudio = null;
      clearTtsMeter();
      reject(new Error('Audio playback failed'));
    };
    audio.play().catch((err) => {
      clearTtsMeter();
      reject(err);
    });
  });
}

export const SPEECH_TRANSITION_MS = 120;

async function waitForSpeechTransition() {
  await new Promise((resolve) => setTimeout(resolve, SPEECH_TRANSITION_MS));
}

export async function speakText(text, { label = 'Reading aloud...', forceProfile = null } = {}) {
  stopSpeech();
  const rawClean = cleanTextForSpeech(text);
  if (!rawClean) return { ok: true, skipped: true };
  if (!canUseExternalCloud() || !isGeminiReady()) {
    currentState = { ...currentState, isPlaying: false, isLoading: false, engine: 'gemini-unavailable', label: '' };
    notify();
    return { ok: false, reason: 'Gemini API connection is required for voice output.' };
  }

  const profile = forceProfile || (selectedMode === 'auto' ? detectVoiceProfile(rawClean) : selectedMode);
  const clean = normalizeRomanizedHindiForSpeech(rawClean, profile);
  const chunks = splitIntoChunks(clean, 220, 100);
  if (!chunks.length) return { ok: true, skipped: true };

  const myToken = ++playbackToken;
  stopRequested = false;
  currentState = {
    ...currentState,
    isPlaying: true,
    isPaused: false,
    isLoading: true,
    currentChunk: 1,
    totalChunks: chunks.length,
    label,
    voiceMode: selectedMode,
    detectedProfile: profile,
    engine: 'gemini',
  };
  notify();

  try {
    for (let i = 0; i < chunks.length; i++) {
      if (stopRequested || myToken !== playbackToken) break;
      const chunkProfile = forceProfile || (selectedMode === 'auto' ? detectVoiceProfile(chunks[i]) : selectedMode);
      currentState = { ...currentState, isLoading: true, currentChunk: i + 1, totalChunks: chunks.length, detectedProfile: chunkProfile, engine: 'gemini' };
      notify();
      const audioUrl = await textToSpeech(chunks[i], chunkProfile, {
        accent: getVoiceAccent(),
        persona: getVoicePersona(),
      });
      if (stopRequested || myToken !== playbackToken) break;
      currentState = { ...currentState, isLoading: false, engine: 'gemini' };
      notify();
      await playAudioUrl(audioUrl);
      if (i + 1 < chunks.length && !stopRequested && myToken === playbackToken) {
        await waitForSpeechTransition();
      }
    }
    return { ok: true };
  } catch (err) {
    // No native/OS voice fallback: voice remains Gemini-only.
    return { ok: false, error: err?.message || 'Gemini voice generation failed.' };
  } finally {
    if (myToken === playbackToken) {
      currentState = { ...currentState, isPlaying: false, isPaused: false, isLoading: false, currentChunk: 0, totalChunks: 0, label: '' };
      notify();
    }
  }
}

/** Buffers streamed text and speaks it using Gemini TTS only when the response is complete. */
export function createStreamingSpeaker({ label = 'Speaking...', forceProfile = null } = {}) {
  let text = '';
  let cancelled = false;
  return {
    push(fullTextSoFar) {
      if (!cancelled) text = String(fullTextSoFar || '');
    },
    finish(finalText = text) {
      if (!cancelled) speakText(finalText || text, { label, forceProfile }).catch?.(() => {});
    },
    cancel() {
      cancelled = true;
      text = '';
      stopSpeech();
    },
    didStart: () => Boolean(text),
  };
}

export function pauseSpeech() {
  if (activeAudio) {
    activeAudio.pause();
    currentState = { ...currentState, isPaused: true };
    notify();
    return;
  }
}

export function resumeSpeech() {
  if (activeAudio) {
    activeAudio.play().catch(() => {});
    currentState = { ...currentState, isPaused: false };
    notify();
    return;
  }
}

export function stopSpeech() {
  stopRequested = true;
  duckScale = 1;
  playbackToken++;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = '';
    activeAudio = null;
  }
  clearTtsMeter();
  if (activeAudioCtx) {
    const ctx = activeAudioCtx;
    activeAudioCtx = null;
    try { if (ctx.state !== 'closed') ctx.close().catch(() => {}); } catch {}
  }
  currentState = {
    ...currentState,
    isPlaying: false,
    isPaused: false,
    isLoading: false,
    currentChunk: 0,
    totalChunks: 0,
    label: '',
    audioLevel: 0,
    freqBands: [0, 0, 0, 0, 0],
  };
  notify();
}

export function cycleSpeechRate() {
  const rates = [1, 1.25, 1.5, 0.85];
  const next = rates[(rates.indexOf(currentState.rate) + 1) % rates.length];
  writeStorage('jeeva_speech_rate', String(next));
  currentState = { ...currentState, rate: next };
  if (activeAudio) activeAudio.playbackRate = next;
  notify();
  return next;
}
