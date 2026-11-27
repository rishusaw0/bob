// Smart Multi-Voice Read-Aloud Engine (Indian English, Hindi, Hinglish + Realistic Human Studio Voices)
import { textToSpeech, resetRegionalVoiceCache, isGeminiReady } from './gemini.js';

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
const CUSTOM_VOICE_ID_KEY = 'jeeva_custom_voice_id';
const CUSTOM_VOICES_LIST_KEY = 'jeeva_custom_voices_list';
const PREFERRED_NATIVE_VOICE_KEY = 'jeeva_native_voice';
const SPEECH_SPEED_MODE_KEY = 'jeeva_speech_speed';

const ttsAudioCache = new Map();

export function getSpeechSpeedMode() {
  const v = readStorage(SPEECH_SPEED_MODE_KEY, 'hybrid_fast');
  return ['hybrid_fast', 'instant_local', 'cloud_studio'].includes(v) ? v : 'hybrid_fast';
}

export function setSpeechSpeedMode(mode) {
  const clean = ['hybrid_fast', 'instant_local', 'cloud_studio'].includes(mode) ? mode : 'hybrid_fast';
  writeStorage(SPEECH_SPEED_MODE_KEY, clean);
  return clean;
}

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
  resetRegionalVoiceCache();
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

export function getActiveCustomVoiceId() {
  return readStorage(CUSTOM_VOICE_ID_KEY, '');
}

export function setActiveCustomVoiceId(voiceId) {
  const clean = String(voiceId || '').trim();
  writeStorage(CUSTOM_VOICE_ID_KEY, clean);
  return clean;
}

export function getCustomClonedVoices() {
  try {
    const raw = readStorage(CUSTOM_VOICES_LIST_KEY, '[]');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomClonedVoice({ id, displayName }) {
  const list = getCustomClonedVoices().filter((v) => v.id !== id);
  list.unshift({
    id,
    displayName: displayName || 'My Cloned Voice',
    createdAt: new Date().toLocaleString('en-IN'),
  });
  writeStorage(CUSTOM_VOICES_LIST_KEY, JSON.stringify(list.slice(0, 8)));
  setActiveCustomVoiceId(id);
  return list;
}

export function removeCustomClonedVoice(voiceId) {
  const list = getCustomClonedVoices().filter((v) => v.id !== voiceId);
  writeStorage(CUSTOM_VOICES_LIST_KEY, JSON.stringify(list));
  if (getActiveCustomVoiceId() === voiceId) {
    setActiveCustomVoiceId('');
  }
  return list;
}

export function getPreferredNativeVoice() {
  return readStorage(PREFERRED_NATIVE_VOICE_KEY, '');
}

export function setPreferredNativeVoice(voiceName) {
  writeStorage(PREFERRED_NATIVE_VOICE_KEY, String(voiceName || ''));
}

export function getAvailableSpeechVoices() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const voices = window.speechSynthesis.getVoices() || [];
  return voices
    .filter((v) => /^(en|hi)/i.test(v.lang || ''))
    .map((v) => ({ name: v.name, lang: v.lang, localService: v.localService }));
}

// Warm up Chromium speechSynthesis voices asynchronously on startup
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      try {
        window.speechSynthesis.getVoices();
      } catch {}
    };
  } catch {}
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
let activeUtterance = null;
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

function scoreVoiceCandidate(v, targetLangOrder) {
  const lang = String(v.lang || '').toLowerCase();
  const name = String(v.name || '').toLowerCase();
  let langScore = 0;
  for (let i = 0; i < targetLangOrder.length; i++) {
    if (lang.startsWith(targetLangOrder[i])) {
      langScore = (targetLangOrder.length - i) * 100;
      break;
    }
  }
  if (!langScore) return -1;

  let qualityBonus = 0;
  if (/natural|neural|online/i.test(name)) qualityBonus += 120;
  if (/google/i.test(name)) qualityBonus += 60;
  if (/neerja|prabhat|swara|madhur|ava|andrew|aria|guy|jenny|veena|rishi|google\s+.*india|google हिन्दी/i.test(name)) {
    qualityBonus += 75;
  }
  if (/india/i.test(name)) qualityBonus += 45;
  if (/\b(david|zira|mark|heera|ravi|kalpana|hemant)\b/i.test(name) && !/natural|neural|online/i.test(name)) {
    qualityBonus -= 45;
  }
  return langScore + qualityBonus;
}

function pickNativeVoice(profile) {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return null;

  const preferredName = getPreferredNativeVoice();
  if (preferredName && profile !== 'hindi') {
    const manual = voices.find((v) => v.name === preferredName);
    if (manual) return manual;
  }

  const indianAccent = getVoiceAccent() === 'indian';
  const targetLangOrder =
    profile === 'hindi'
      ? ['hi-in', 'hi', 'en-in']
      : profile === 'hinglish' || indianAccent
        ? ['en-in', 'hi-in', 'en-gb', 'en-us', 'en']
        : ['en-us', 'en-gb', 'en-in', 'en'];

  let best = null;
  let bestScore = -1;
  for (const v of voices) {
    const sc = scoreVoiceCandidate(v, targetLangOrder);
    if (sc > bestScore) {
      bestScore = sc;
      best = v;
    }
  }
  return best || voices[0];
}

function speakChunkNative(text, profile) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || stopRequested) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    const indianAccent = getVoiceAccent() === 'indian';
    utterance.lang = profile === 'hindi' ? 'hi-IN' : indianAccent || profile === 'hinglish' ? 'en-IN' : 'en-US';
    const voice = pickNativeVoice(profile);
    if (voice) utterance.voice = voice;
    utterance.rate = Math.min(1.5, Math.max(0.82, currentState.rate * 0.98));
    utterance.pitch = 1.02;

    let done = false;
    let pulseTimer = setInterval(() => {
      if (stopRequested) return;
      const lvl = 0.28 + Math.random() * 0.45;
      currentState = {
        ...currentState,
        audioLevel: lvl,
        freqBands: [lvl * 0.8, lvl, lvl * 0.9, lvl * 0.7, lvl * 0.5],
      };
      notify();
    }, 90);

    const safetyMs = Math.max(4500, text.length * 140);
    let safetyTimer = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (activeUtterance === utterance) activeUtterance = null;
      if (safetyTimer) clearTimeout(safetyTimer);
      if (pulseTimer) {
        clearInterval(pulseTimer);
        pulseTimer = null;
      }
      currentState = { ...currentState, audioLevel: 0, freqBands: [0, 0, 0, 0, 0] };
      notify();
      resolve();
    };
    const scheduleSafety = () => {
      if (done) return;
      safetyTimer = setTimeout(() => {
        if (done) return;
        if (currentState.isPaused) {
          scheduleSafety();
          return;
        }
        finish();
      }, safetyMs);
    };
    scheduleSafety();
    activeUtterance = utterance;
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  });
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

export async function speakText(text, { label = 'Reading aloud...', forceProfile = null, instant = false } = {}) {
  const wasSpeaking = typeof window !== 'undefined' && Boolean(window.speechSynthesis?.speaking || activeAudio);
  stopSpeech();
  const rawClean = cleanTextForSpeech(text);
  if (!rawClean) return;
  const initialProfile = forceProfile || (selectedMode === 'auto' ? detectVoiceProfile(rawClean) : selectedMode);
  const clean = normalizeRomanizedHindiForSpeech(rawClean, initialProfile);

  // Brief 12ms yield only when interrupting active Chromium speechSynthesis so the next utterance never drops
  if (wasSpeaking && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    await new Promise((r) => setTimeout(r, 12));
  }

  const myToken = ++playbackToken;
  stopRequested = false;

  const chunks = splitIntoChunks(clean, 220, 100);
  if (!chunks.length) return;

  const speedMode = getSpeechSpeedMode();
  const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
  const canUseStudio = speedMode !== 'instant_local' && isOnline && isGeminiReady() && !instant;
  const useInstantDirect = !canUseStudio;

  currentState = {
    ...currentState,
    isPlaying: true,
    isPaused: false,
    isLoading: !useInstantDirect,
    currentChunk: 1,
    totalChunks: chunks.length,
    label,
    voiceMode: selectedMode,
    detectedProfile: initialProfile,
    engine: useInstantDirect ? 'instant-local' : 'gemini',
  };
  notify();

  // Fast Direct Local Voice path (when offline, instant_local mode, or Gemini key not yet configured)
  if (useInstantDirect) {
    for (let i = 0; i < chunks.length; i++) {
      if (stopRequested || myToken !== playbackToken) break;
      const chunkProfile =
        forceProfile || (selectedMode === 'auto' ? detectVoiceProfile(chunks[i]) : selectedMode);
      currentState = {
        ...currentState,
        isLoading: false,
        currentChunk: i + 1,
        totalChunks: chunks.length,
        detectedProfile: chunkProfile,
        engine: 'instant-local',
      };
      notify();
      await speakChunkNative(chunks[i], chunkProfile);
      if (i + 1 < chunks.length && !stopRequested && myToken === playbackToken) await waitForSpeechTransition();
    }
    if (myToken === playbackToken) {
      currentState = {
        ...currentState,
        isPlaying: false,
        isPaused: false,
        isLoading: false,
        currentChunk: 0,
        totalChunks: 0,
        label: '',
      };
      notify();
    }
    return;
  }

  // Prefetch helper with race timeout + phrase cache so Human Studio TTS never hangs
  const timeoutMs = speedMode === 'cloud_studio' ? 4500 : 2400;
  const fetchChunkAudio = (idx) => {
    const chunkText = chunks[idx];
    const profile =
      forceProfile || (selectedMode === 'auto' ? detectVoiceProfile(chunkText) : selectedMode);
    return fetchStudioChunkAudio(chunkText, profile, timeoutMs);
  };

  let nextPromise = fetchChunkAudio(0).catch((err) => ({ error: err }));

  for (let i = 0; i < chunks.length; i++) {
    if (stopRequested || myToken !== playbackToken) break;

    const chunkProfile =
      forceProfile || (selectedMode === 'auto' ? detectVoiceProfile(chunks[i]) : selectedMode);

    currentState = {
      ...currentState,
      isLoading: true,
      currentChunk: i + 1,
      totalChunks: chunks.length,
      detectedProfile: chunkProfile,
    };
    notify();

    // Start prefetching next chunk while awaiting/playing current chunk
    const upcomingPromise =
      i + 1 < chunks.length ? fetchChunkAudio(i + 1).catch((err) => ({ error: err })) : null;

    const result = await nextPromise;
    nextPromise = upcomingPromise;

    if (stopRequested || myToken !== playbackToken) break;

    currentState = { ...currentState, isLoading: false };
    notify();

    if (result && result.url) {
      currentState = {
        ...currentState,
        engine: 'gemini',
        detectedProfile: result.profile || chunkProfile,
      };
      notify();
      try {
        await playAudioUrl(result.url);
        if (i + 1 < chunks.length && !stopRequested && myToken === playbackToken) await waitForSpeechTransition();
      } catch {
        currentState = { ...currentState, engine: 'fallback' };
        notify();
        await speakChunkNative(chunks[i], chunkProfile);
        if (i + 1 < chunks.length && !stopRequested && myToken === playbackToken) await waitForSpeechTransition();
      }
    } else {
      // Fallback to OS voice only if Gemini TTS API fails
      currentState = { ...currentState, engine: 'fallback' };
      notify();
      await speakChunkNative(chunks[i], chunkProfile);
      if (i + 1 < chunks.length && !stopRequested && myToken === playbackToken) await waitForSpeechTransition();
    }
  }

  if (myToken === playbackToken) {
    currentState = {
      ...currentState,
      isPlaying: false,
      isPaused: false,
      isLoading: false,
      currentChunk: 0,
      totalChunks: 0,
      label: '',
    };
    notify();
  }
}

function fetchStudioChunkAudio(chunkText, profile, timeoutMs = 2400) {
  const accent = getVoiceAccent();
  const persona = getVoicePersona();
  const customVoiceId = getActiveCustomVoiceId();
  const cacheKey = `${customVoiceId || 'default'}:${accent}:${persona}:${profile}:${chunkText}`;
  if (ttsAudioCache.has(cacheKey)) {
    return Promise.resolve({ url: ttsAudioCache.get(cacheKey), profile });
  }
  const ttsPromise = textToSpeech(chunkText, profile, { accent, persona, customVoiceId }).then((url) => {
    if (ttsAudioCache.size >= 24) {
      const firstKey = ttsAudioCache.keys().next().value;
      ttsAudioCache.delete(firstKey);
    }
    ttsAudioCache.set(cacheKey, url);
    return { url, profile };
  });
  const timerPromise = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('TTS timeout — fast local fallback')), timeoutMs)
  );
  return Promise.race([ttsPromise, timerPromise]);
}

/**
 * Progressive Streaming Speaker: speaks completed sentences immediately as tokens stream in,
 * using Realistic Human Studio TTS when online & configured, with instant OS fallback.
 */
export function createStreamingSpeaker({ label = 'Speaking...', forceProfile = null } = {}) {
  const wasSpeaking = typeof window !== 'undefined' && Boolean(window.speechSynthesis?.speaking || activeAudio);
  stopSpeech();
  const myToken = ++playbackToken;
  stopRequested = false;

  let consumedLen = 0;
  let lastRaw = '';
  let started = false;
  let streamFinished = false;
  const queue = [];
  let draining = false;
  let spokenChunks = 0;
  let totalQueued = 0;
  const prefetchedPromises = new Map();

  const canUseStudioNow = () => {
    const mode = getSpeechSpeedMode();
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    return mode !== 'instant_local' && online && isGeminiReady();
  };

  const getChunkProfile = (text) =>
    forceProfile || (selectedMode === 'auto' ? detectVoiceProfile(text) : selectedMode);

  const primeStudioChunk = (text) => {
    if (!canUseStudioNow() || prefetchedPromises.has(text)) return;
    const timeoutMs = getSpeechSpeedMode() === 'cloud_studio' ? 4500 : 2400;
    const p = fetchStudioChunkAudio(text, getChunkProfile(text), timeoutMs).catch(() => null);
    prefetchedPromises.set(text, p);
  };

  const drainQueue = async () => {
    if (draining) return;
    draining = true;
    try {
      if (wasSpeaking && spokenChunks === 0 && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        await new Promise((r) => setTimeout(r, 12));
      }
      while (queue.length > 0 && !stopRequested && myToken === playbackToken) {
        const nextText = queue.shift();
        const subChunks = splitIntoChunks(nextText, 220, 100);
        for (let i = 0; i < subChunks.length; i++) {
          const chunk = subChunks[i];
          if (stopRequested || myToken !== playbackToken) break;
          const profile = getChunkProfile(chunk);
          spokenChunks++;
          const useStudio = canUseStudioNow();
          if (useStudio && i + 1 < subChunks.length) {
            primeStudioChunk(subChunks[i + 1]);
          } else if (useStudio && queue.length > 0) {
            primeStudioChunk(queue[0]);
          }
          currentState = {
            ...currentState,
            isPlaying: true,
            isPaused: false,
            isLoading: useStudio && !prefetchedPromises.has(chunk),
            currentChunk: spokenChunks,
            totalChunks: Math.max(spokenChunks, totalQueued),
            label,
            voiceMode: selectedMode,
            detectedProfile: profile,
            engine: useStudio ? 'gemini' : 'instant-local',
          };
          notify();

          let playedStudio = false;
          if (useStudio) {
            primeStudioChunk(chunk);
            const studioRes = await prefetchedPromises.get(chunk);
            prefetchedPromises.delete(chunk);
            if (stopRequested || myToken !== playbackToken) break;
            if (studioRes?.url) {
              currentState = { ...currentState, isLoading: false, engine: 'gemini' };
              notify();
              try {
                await playAudioUrl(studioRes.url);
                playedStudio = true;
              } catch {
                playedStudio = false;
              }
            }
          }
          if (!playedStudio && !stopRequested && myToken === playbackToken) {
            currentState = { ...currentState, isLoading: false, engine: 'instant-local' };
            notify();
            await speakChunkNative(chunk, profile);
          }
          // Apply the same short, natural transition to streamed assistant replies.
          if ((i + 1 < subChunks.length || queue.length > 0) && !stopRequested && myToken === playbackToken) {
            await waitForSpeechTransition();
          }
        }
      }
    } finally {
      draining = false;
      if (streamFinished && queue.length === 0 && myToken === playbackToken) {
        currentState = {
          ...currentState,
          isPlaying: false,
          isPaused: false,
          isLoading: false,
          currentChunk: 0,
          totalChunks: 0,
          label: '',
        };
        notify();
      }
    }
  };

  const enqueueText = (rawSegment) => {
    const rawCleaned = cleanTextForSpeech(rawSegment);
    if (!rawCleaned) return;
    const cleaned = normalizeRomanizedHindiForSpeech(rawCleaned, getChunkProfile(rawCleaned));
    started = true;
    totalQueued++;
    if (canUseStudioNow() && queue.length < 2) {
      const firstSub = splitIntoChunks(cleaned, 220, 100)[0];
      if (firstSub) primeStudioChunk(firstSub);
    }
    queue.push(cleaned);
    drainQueue();
  };

  const push = (fullTextSoFar) => {
    if (stopRequested || myToken !== playbackToken) return;
    const raw = String(fullTextSoFar || '');
    if (raw.length < consumedLen) {
      // Stream restarted for a new tool hop; advance safely without clipping previous speech
      consumedLen = 0;
    }
    lastRaw = raw;

    // Avoid cutting inside an unclosed ``` code fence
    const slice = raw.slice(consumedLen);
    if ((slice.match(/```/g) || []).length % 2 === 1) return;

    // Extract complete sentences without breaking decimals (or clean word boundary past 105 chars)
    let searchFrom = 0;
    while (searchFrom < slice.length) {
      const rest = slice.slice(searchFrom);
      const sentEnd = findNextSentenceEnd(rest);
      if (sentEnd >= 16) {
        const segment = rest.slice(0, sentEnd + 1);
        consumedLen += sentEnd + 1;
        searchFrom += sentEnd + 1;
        enqueueText(segment);
      } else if (rest.length >= 105) {
        const spaceIdx = rest.lastIndexOf(' ', 105);
        const cut = spaceIdx >= 30 ? spaceIdx : 105;
        const segment = rest.slice(0, cut);
        consumedLen += cut;
        searchFrom += cut;
        enqueueText(segment);
      } else {
        break;
      }
    }
  };

  const finish = (finalText = lastRaw) => {
    streamFinished = true;
    if (stopRequested || myToken !== playbackToken) return;
    const raw = String(finalText || lastRaw || '');
    const tail = raw.slice(consumedLen).trim();
    consumedLen = raw.length;
    if (tail) {
      enqueueText(tail);
    } else if (!draining && queue.length === 0 && myToken === playbackToken) {
      currentState = {
        ...currentState,
        isPlaying: false,
        isPaused: false,
        isLoading: false,
        currentChunk: 0,
        totalChunks: 0,
        label: '',
      };
      notify();
    }
  };

  const cancel = () => {
    streamFinished = true;
    queue.length = 0;
    if (myToken === playbackToken) stopSpeech();
  };

  return {
    push,
    finish,
    cancel,
    didStart: () => started,
  };
}

export function pauseSpeech() {
  if (activeAudio) {
    activeAudio.pause();
    currentState = { ...currentState, isPaused: true };
    notify();
    return;
  }
  if (window.speechSynthesis?.speaking && !window.speechSynthesis.paused) {
    window.speechSynthesis.pause();
    currentState = { ...currentState, isPaused: true };
    notify();
  }
}

export function resumeSpeech() {
  if (activeAudio) {
    activeAudio.play().catch(() => {});
    currentState = { ...currentState, isPaused: false };
    notify();
    return;
  }
  if (window.speechSynthesis?.paused) {
    window.speechSynthesis.resume();
    currentState = { ...currentState, isPaused: false };
    notify();
  }
}

export function stopSpeech() {
  stopRequested = true;
  duckScale = 1;
  playbackToken++;
  activeUtterance = null;
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
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
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
