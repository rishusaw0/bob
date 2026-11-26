// Smart Multi-Voice Read-Aloud Engine (Indian English, Hindi, Hinglish + Clear Pronunciation Normalizer)
import { textToSpeech, resetRegionalVoiceCache } from './gemini.js';

export const VOICE_PROFILES = {
  auto: { id: 'auto', label: 'Auto Detect', shortLabel: 'Auto' },
  english: { id: 'english', label: 'Indian English', shortLabel: 'EN-IN' },
  hindi: { id: 'hindi', label: 'Hindi (Natural)', shortLabel: 'Hindi' },
  hinglish: { id: 'hinglish', label: 'Hinglish (Bilingual)', shortLabel: 'Hinglish' },
};

const VOICE_ACCENT_KEY = 'jeeva_voice_accent';
const PREFERRED_NATIVE_VOICE_KEY = 'jeeva_native_voice';

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

let currentState = {
  isPlaying: false,
  isPaused: false,
  isLoading: false,
  currentChunk: 0,
  totalChunks: 0,
  rate: 1,
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
    .replace(/\n{2,}/g, '. ')
    .replace(/\n\s*[-*•]\s+/g, ', ')
    .replace(/\n/g, '. ')
    .replace(/([a-z])_([a-z])/gi, '$1 $2')
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

// Split with quick ~140 char first sentence and <=240 char chunks so OS TTS never hits Chromium's cutoff bug
function splitIntoChunks(text, maxLen = 240, firstChunkMax = 140) {
  const clean = cleanTextForSpeech(text);
  if (!clean) return [];
  const rawSentences = clean.match(/[^।.!?\n]+[।.!?\n]*/g) || [clean];
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
  if (/natural|neural|online/i.test(name)) qualityBonus += 45;
  if (/neerja|prabhat|swara|madhur|ravi|heera|kalpana|hemant|veena|rishi|google\s+.*india|google हिन्दी/i.test(name)) {
    qualityBonus += 35;
  }
  if (/india/i.test(name)) qualityBonus += 25;
  if (/google/i.test(name)) qualityBonus += 15;
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
      ? ['hi-in', 'hi']
      : profile === 'hinglish'
        ? ['en-in', 'hi-in', 'en-gb', 'en']
        : indianAccent
          ? ['en-in', 'en-gb', 'en-us', 'en']
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
    // Slight clarity pacing tuning so words enunciate cleanly without sounding rushed
    utterance.rate = Math.min(1.5, Math.max(0.75, currentState.rate * 0.96));
    utterance.pitch = 1.0;

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

    const finish = () => {
      if (pulseTimer) {
        clearInterval(pulseTimer);
        pulseTimer = null;
      }
      currentState = { ...currentState, audioLevel: 0, freqBands: [0, 0, 0, 0, 0] };
      notify();
      resolve();
    };
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
  activeGain = null;
  if (activeAudioCtx) {
    try {
      if (activeAudioCtx.state !== 'closed') activeAudioCtx.close().catch(() => {});
    } catch {}
    activeAudioCtx = null;
  }
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
    audio.playbackRate = currentState.rate;
    audio.volume = 1;
    activeAudio = audio;

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
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

export async function speakText(text, { label = 'Reading aloud...', forceProfile = null } = {}) {
  stopSpeech();
  const clean = cleanTextForSpeech(text);
  if (!clean) return;

  const myToken = ++playbackToken;
  stopRequested = false;

  const chunks = splitIntoChunks(clean, 240, 140);
  if (!chunks.length) return;

  const initialProfile =
    forceProfile || (selectedMode === 'auto' ? detectVoiceProfile(clean) : selectedMode);

  currentState = {
    ...currentState,
    isPlaying: true,
    isPaused: false,
    isLoading: true,
    currentChunk: 1,
    totalChunks: chunks.length,
    label,
    voiceMode: selectedMode,
    detectedProfile: initialProfile,
    engine: 'gemini',
  };
  notify();

  // Prefetch helper: determines voice profile per chunk if in Auto mode
  const accent = getVoiceAccent();
  const fetchChunkAudio = (idx) => {
    const chunkText = chunks[idx];
    const profile =
      forceProfile || (selectedMode === 'auto' ? detectVoiceProfile(chunkText) : selectedMode);
    return textToSpeech(chunkText, profile, { accent }).then((url) => ({ url, profile }));
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
      } catch {
        currentState = { ...currentState, engine: 'fallback' };
        notify();
        await speakChunkNative(chunks[i], chunkProfile);
      }
    } else {
      // Fallback to OS voice only if Gemini TTS API fails
      currentState = { ...currentState, engine: 'fallback' };
      notify();
      await speakChunkNative(chunks[i], chunkProfile);
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
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = '';
    activeAudio = null;
  }
  clearTtsMeter();
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
  currentState = { ...currentState, rate: next };
  if (activeAudio) activeAudio.playbackRate = next;
  notify();
  return next;
}
