// Smart Multi-Voice Read-Aloud Engine (English, Hindi, Hinglish + Auto-Detect)
import { textToSpeech } from './gemini.js';

export const VOICE_PROFILES = {
  auto: { id: 'auto', label: 'Auto Detect', shortLabel: 'Auto' },
  english: { id: 'english', label: 'English (Studio)', shortLabel: 'English' },
  hindi: { id: 'hindi', label: 'Hindi (Natural)', shortLabel: 'Hindi' },
  hinglish: { id: 'hinglish', label: 'Hinglish (Bilingual)', shortLabel: 'Hinglish' },
};

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

let selectedMode = localStorage.getItem('jeeva_voice_mode') || 'auto';

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
  localStorage.setItem('jeeva_voice_mode', mode);
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

function cleanTextForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' Code snippet. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_~>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Split with quick ~150 char first sentence chunk for snappy first-word latency, ~360 chars thereafter
function splitIntoChunks(text, maxLen = 360, firstChunkMax = 150) {
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

function pickNativeVoice(profile) {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return null;

  // Prefer natural/online neural voices if Edge/Windows has them installed
  const preferredLangs =
    profile === 'hindi'
      ? ['hi-in', 'hi']
      : profile === 'hinglish'
      ? ['en-in', 'hi-in', 'en']
      : ['en-us', 'en-gb', 'en-in', 'en'];

  for (const lang of preferredLangs) {
    const natural = voices.find(
      v => v.lang.toLowerCase().startsWith(lang) && /natural|neural|online|google/i.test(v.name)
    );
    if (natural) return natural;
    const any = voices.find(v => v.lang.toLowerCase().startsWith(lang));
    if (any) return any;
  }
  return voices[0];
}

function speakChunkNative(text, profile) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || stopRequested) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = profile === 'hindi' ? 'hi-IN' : profile === 'hinglish' ? 'en-IN' : 'en-US';
    const voice = pickNativeVoice(profile);
    if (voice) utterance.voice = voice;
    utterance.rate = currentState.rate;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
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

  const chunks = splitIntoChunks(clean, 420);
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
  const fetchChunkAudio = (idx) => {
    const chunkText = chunks[idx];
    const profile =
      forceProfile || (selectedMode === 'auto' ? detectVoiceProfile(chunkText) : selectedMode);
    return textToSpeech(chunkText, profile).then((url) => ({ url, profile }));
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
