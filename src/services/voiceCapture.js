// Master Voice Capture, Spectral Vocal-Band VAD, Adaptive Silence & Barge-In Engine:
// 1. 16 kHz Mono PCM Pre-Roll Ring Buffer + Goertzel Vocal-Band Speech Scoring + WAV Capture
// 2. Adaptive Utterance Silence Grace (snappy for short cmds, patient for multi-step sentences)
// 3. Real-Time Barge-In Monitor during TTS / Audio Playback
import { transcribeAudio, getGeminiConnectionInfo } from './gemini.js';
import { isStrictOfflineMode } from './offlineMode.js';
import { matchWakePhrase, getAiName } from './voiceRouter.js';

let speechApiBrokenInRuntime = false;

const VAD_SENSITIVITY_KEY = 'jeeva_vad_sensitivity';

export function getVadSensitivity() {
  try {
    const v = (typeof localStorage !== 'undefined' ? localStorage.getItem(VAD_SENSITIVITY_KEY) : null) || 'balanced';
    return ['high', 'balanced', 'noisy_room'].includes(v) ? v : 'balanced';
  } catch {
    return 'balanced';
  }
}

export function setVadSensitivity(mode) {
  const clean = ['high', 'balanced', 'noisy_room'].includes(mode) ? mode : 'balanced';
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(VAD_SENSITIVITY_KEY, clean);
  } catch {}
  return clean;
}

function getVadThresholdConfig() {
  const mode = getVadSensitivity();
  if (mode === 'high') {
    return { minStart: 0.02, snrMult: 1.65, wakeMin: 0.024, wakeSnr: 1.65, minVocalRatio: 0.28 };
  }
  if (mode === 'noisy_room') {
    return { minStart: 0.052, snrMult: 2.45, wakeMin: 0.056, wakeSnr: 2.35, minVocalRatio: 0.42 };
  }
  return { minStart: 0.03, snrMult: 1.95, wakeMin: 0.032, wakeSnr: 1.9, minVocalRatio: 0.34 };
}

/**
 * 1st-order IIR high-pass filter (fc ~180Hz at 16kHz) removes fan hum, AC drone & desk thuds.
 */
export function applyHighPassRumbleFilter(samples, alpha = 0.93) {
  if (!samples || !samples.length) return new Float32Array(0);
  const out = new Float32Array(samples.length);
  let prevIn = samples[0];
  let prevOut = 0;
  for (let i = 0; i < samples.length; i++) {
    const cur = samples[i];
    const hp = alpha * (prevOut + cur - prevIn);
    out[i] = hp;
    prevIn = cur;
    prevOut = hp;
  }
  return out;
}

/**
 * Trims dead leading/trailing silence (preserving 120ms padding) and applies smooth AGC gain
 * up to ~0.70 peak so quiet/far laptop microphones transcribe clearly without clipping.
 */
export function normalizePcmForStt(pcm16k, sampleRate = 16000) {
  if (!pcm16k || !pcm16k.length) return new Float32Array(0);
  let peak = 0;
  for (let i = 0; i < pcm16k.length; i++) {
    const a = Math.abs(pcm16k[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-4) return pcm16k;

  const trimGate = Math.max(0.008, peak * 0.08);
  let first = 0;
  let last = pcm16k.length - 1;
  while (first < last && Math.abs(pcm16k[first]) < trimGate) first++;
  while (last > first && Math.abs(pcm16k[last]) < trimGate) last--;

  const pad = Math.round(sampleRate * 0.12);
  const start = Math.max(0, first - pad);
  const end = Math.min(pcm16k.length, last + pad + 1);
  const slice = pcm16k.subarray(start, end);

  const gain = peak < 0.65 ? Math.min(10, 0.7 / peak) : 1;
  const out = new Float32Array(slice.length);
  for (let i = 0; i < slice.length; i++) {
    const v = slice[i] * gain;
    // Soft knee saturation past 0.85 prevents digital harshness
    out[i] = Math.abs(v) > 0.85 ? Math.tanh(v) : v;
  }
  return out;
}

export function isBrowserSpeechSupported() {
  if (typeof window === 'undefined') return false;
  if (window.electronAPI) return false;
  if (isStrictOfflineMode()) return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) && !speechApiBrokenInRuntime;
}

/**
 * Centralized local-first audio transcription adapter.
 * Enforces Strict Offline Mode: NEVER sends mic audio to Gemini Cloud when Strict Offline is ON.
 */
async function transcribeCapturedAudio(wavBase64, opts = {}) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (api?.offlineVoiceTranscribe) {
    const localWhisper = await api.offlineVoiceTranscribe(wavBase64, { language: 'auto' }).catch(() => null);
    if (localWhisper?.ok && localWhisper?.text) {
      return localWhisper.text;
    }
  }
  if (isStrictOfflineMode()) {
    throw new Error('Strict Offline Mode: Cloud transcription blocked. Configure local Whisper.cpp or Windows Speech pack.');
  }
  return await transcribeAudio(wavBase64, 'audio/wav', opts);
}

const AUDIO_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
};

export function downsampleFloat32(samples, inRate, outRate = 16000) {
  if (!samples || !samples.length) return new Float32Array(0);
  if (!inRate || inRate <= outRate) return samples;
  const ratio = inRate / outRate;
  const newLength = Math.max(1, Math.round(samples.length / ratio));
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < newLength) {
    const nextOffsetBuffer = Math.min(samples.length, Math.round((offsetResult + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
      accum += samples[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function uint8ToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function encodeWavBase64(pcmSamples, sampleRate = 16000) {
  const numSamples = pcmSamples.length;
  const dataLength = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcmSamples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return uint8ToBase64(new Uint8Array(buffer));
}

export function pcmFloat32ToInt16Base64(pcmSamples) {
  const buf = new ArrayBuffer(pcmSamples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < pcmSamples.length; i++) {
    const s = Math.max(-1, Math.min(1, pcmSamples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return uint8ToBase64(new Uint8Array(buf));
}

export function cleanSttTranscript(raw) {
  let txt = String(raw || '').trim();
  if (!txt) return '';
  txt = txt.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (/^(\[|\()?(silence|inaudible|noise|background noise|no speech|blank_audio|music|applause|laughter|sigh|cough|static|unintelligible)(\]|\))?\.?$/i.test(txt)) {
    return '';
  }
  txt = txt
    .replace(/\[(?:silence|inaudible|noise|background noise|music|blank_audio)\]/gi, '')
    .replace(/\((?:silence|inaudible|noise|background noise|music)\)/gi, '')
    .trim();
  if (/^[.\s,?!…-]+$/.test(txt)) return '';
  return txt;
}

function concatFloat32(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

function goertzelPower(samples, freqHz, sampleRate = 16000) {
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

/**
 * Computes vocal-band probability (300-3200Hz voice concentration + ZCR) to filter thuds/fan hum.
 */
export function computeVocalVadMetrics(samples, gainBoost = 3.6, sampleRate = 16000) {
  if (!samples || !samples.length) {
    return { level: 0, zcr: 0, vocalRatio: 0, bands: [0, 0, 0, 0, 0], isVocalFrame: false };
  }
  let sqSum = 0;
  let crossings = 0;
  for (let i = 0; i < samples.length; i++) {
    sqSum += samples[i] * samples[i];
    if (i > 0 && ((samples[i - 1] >= 0 && samples[i] < 0) || (samples[i - 1] < 0 && samples[i] >= 0))) {
      crossings++;
    }
  }
  const rms = Math.sqrt(sqSum / samples.length);
  const level = Math.min(1, rms * gainBoost);
  const zcr = crossings / samples.length;

  const lowRumble = goertzelPower(samples, 95, sampleRate);
  const bandFreqs = [340, 680, 1200, 1950, 2900];
  let vocalSum = 0;
  const bands = bandFreqs.map((f) => {
    const p = goertzelPower(samples, f, sampleRate);
    vocalSum += p;
    return Math.min(1, Math.sqrt(p) * gainBoost * 1.4);
  });

  const vocalRatio = vocalSum / (vocalSum + lowRumble + 1e-8);
  const isVocalFrame = vocalRatio > 0.34 && zcr >= 0.006 && zcr <= 0.45;

  return { level, zcr, vocalRatio, bands, isVocalFrame };
}

/**
 * Adapts trailing silence cutoff dynamically: snappy ~480ms on crisp commands, ~1020ms on longer speech.
 */
export function computeAdaptiveSilenceMs(speechDurationMs, baseSilenceMs = 740) {
  if (speechDurationMs <= 900) return Math.max(450, Math.min(540, baseSilenceMs - 220));
  if (speechDurationMs <= 2200) return Math.max(620, Math.min(760, baseSilenceMs));
  return Math.min(1080, Math.max(880, baseSilenceMs + 180));
}

/**
 * Opens a shared 16kHz PCM ring-buffer + vocal-band analyser session on active microphone.
 */
export async function createPcmStreamMonitor({ preRollSeconds = 0.75, gainBoost = 3.6, onFrame }) {
  const stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }

  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(2048, 1, 1);
  const silentSink = ctx.createGain();
  silentSink.gain.value = 0;

  source.connect(processor);
  processor.connect(silentSink);
  silentSink.connect(ctx.destination);

  const maxPreRollSamples = Math.round(16000 * preRollSeconds);
  let preRollChunks = [];
  let preRollTotal = 0;
  let closed = false;

  processor.onaudioprocess = (ev) => {
    if (closed) return;
    const raw = ev.inputBuffer.getChannelData(0);
    const down = downsampleFloat32(raw, ctx.sampleRate, 16000);
    const pcm16k = applyHighPassRumbleFilter(down);
    const metrics = computeVocalVadMetrics(pcm16k, gainBoost, 16000);

    preRollChunks.push(pcm16k);
    preRollTotal += pcm16k.length;
    while (preRollTotal > maxPreRollSamples && preRollChunks.length > 1) {
      const dropped = preRollChunks.shift();
      preRollTotal -= dropped.length;
    }

    onFrame?.(pcm16k, metrics, () => preRollChunks.slice());
  };

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      processor.onaudioprocess = null;
      source.disconnect();
      processor.disconnect();
      silentSink.disconnect();
    } catch {}
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch {}
    try {
      if (ctx.state !== 'closed') ctx.close().catch(() => {});
    } catch {}
    preRollChunks = [];
  };

  return { close };
}

/**
 * Captures a single spoken command with pre-roll WAV capture + spectral vocal VAD + adaptive silence.
 */
export function startVoiceCapture({
  lang = 'hi-IN',
  autoStopOnSilence = true,
  silenceMs = 950,
  noSpeechTimeoutMs = 5800,
  skipStt = false,
  onInterim = () => {},
  onLevel = () => {},
  onStatus = () => {},
  onResult = () => {},
  onError = () => {},
}) {
  let stopped = false;
  let pcmSession = null;
  let recognition = null;
  let silenceTimer = null;
  let noSpeechTimer = null;
  let maxCapTimer = null;
  let finalText = '';
  let hasCapturedSpeech = false;
  let recordedChunks = [];
  let speechStarted = false;
  let speechStartAt = 0;

  const clearTimers = () => {
    clearTimeout(silenceTimer);
    clearTimeout(noSpeechTimer);
    clearTimeout(maxCapTimer);
    silenceTimer = null;
    noSpeechTimer = null;
    maxCapTimer = null;
  };

  const cleanup = () => {
    clearTimers();
    onLevel(0, [0, 0, 0, 0, 0]);
    if (recognition) {
      try {
        recognition.onend = null;
        recognition.onerror = null;
        recognition.stop();
      } catch {}
      recognition = null;
    }
    if (pcmSession) {
      pcmSession.close();
      pcmSession = null;
    }
  };

  const finishPcmCapture = async (shouldTranscribe) => {
    const captured = recordedChunks;
    recordedChunks = [];
    cleanup();

    if (!shouldTranscribe || !captured.length) {
      onResult('', { pcm16k: null });
      return;
    }

    const pcm = concatFloat32(captured);
    if (pcm.length < 3200) {
      onResult('', { pcm16k: null });
      return;
    }

    if (skipStt) {
      onResult('', { pcm16k: pcm });
      return;
    }

    try {
      onStatus('transcribing');
      onInterim('Understanding command...');
      const cleanPcm = normalizePcmForStt(pcm, 16000);
      const wavBase64 = encodeWavBase64(cleanPcm.length >= 1600 ? cleanPcm : pcm, 16000);
      try {
        const rawText = await transcribeCapturedAudio(wavBase64, {
          aiName: getAiName(),
          mode: 'command',
        });
        const cleaned = cleanSttTranscript(rawText);
        if (cleaned) {
          onResult(cleaned, { pcm16k: cleanPcm });
          return;
        }
      } catch (sttErr) {
        // Automatic offline Windows SAPI dictation fallback if Gemini STT unavailable/offline
        const api = typeof window !== 'undefined' ? window.electronAPI : null;
        if (api?.offlineVoiceDictate) {
          onStatus('offline-dictating');
          onInterim('Trying offline speech engine...');
          const dict = await api.offlineVoiceDictate(6).catch(() => null);
          const offText = cleanSttTranscript(dict?.text || '');
          if (offText) {
            onResult(offText, { pcm16k: cleanPcm });
            return;
          }
        }
        throw sttErr;
      }
      onResult('', { pcm16k: cleanPcm });
    } catch (err) {
      onError(err?.message || 'Voice transcription failed');
    }
  };

  const startPcmCommandCapture = async () => {
    if (stopped) return;
    try {
      onStatus('listening-audio');
      let noiseFloor = 0.018;
      let voicedFrames = 0;

      pcmSession = await createPcmStreamMonitor({
        preRollSeconds: 1.15,
        gainBoost: 3.6,
        onFrame: (pcm16k, metrics, getPreRoll) => {
          if (stopped) return;
          const { level: lvl, bands, isVocalFrame } = metrics;
          onLevel(lvl, bands);

          if (!speechStarted) {
            if (lvl < Math.max(0.055, noiseFloor * 2.2)) {
              noiseFloor = noiseFloor * 0.88 + lvl * 0.12;
            }
            const vadCfg = getVadThresholdConfig();
            const startThresh = Math.max(vadCfg.minStart, Math.min(0.16, noiseFloor * vadCfg.snrMult));
            if (lvl > startThresh && ((isVocalFrame && metrics.vocalRatio >= vadCfg.minVocalRatio) || lvl > startThresh * 1.5)) {
              voicedFrames++;
              if (voicedFrames >= 2) {
                speechStarted = true;
                speechStartAt = Date.now();
                clearTimeout(noSpeechTimer);
                noSpeechTimer = null;
                recordedChunks = getPreRoll();
              }
            } else {
              voicedFrames = Math.max(0, voicedFrames - 1);
            }
          } else {
            recordedChunks.push(pcm16k);
          }

          if (autoStopOnSilence && speechStarted) {
            const sustainThresh = Math.max(0.024, Math.min(0.11, noiseFloor * 1.6));
            const dynamicPause = computeAdaptiveSilenceMs(Date.now() - speechStartAt, silenceMs);
            if (lvl > sustainThresh && isVocalFrame) {
              clearTimeout(silenceTimer);
              silenceTimer = setTimeout(() => {
                if (!stopped) {
                  stopped = true;
                  finishPcmCapture(true);
                }
              }, dynamicPause);
            } else if (!silenceTimer) {
              silenceTimer = setTimeout(() => {
                if (!stopped) {
                  stopped = true;
                  finishPcmCapture(true);
                }
              }, dynamicPause);
            }
          }
        },
      });

      if (autoStopOnSilence) {
        noSpeechTimer = setTimeout(() => {
          if (!stopped && !speechStarted) {
            stopped = true;
            finishPcmCapture(false);
          }
        }, noSpeechTimeoutMs);
      }

      maxCapTimer = setTimeout(() => {
        if (!stopped) {
          stopped = true;
          finishPcmCapture(speechStarted || recordedChunks.length > 0);
        }
      }, 15000);
    } catch (err) {
      cleanup();
      onError('Microphone access denied: ' + (err?.message || err));
    }
  };

  if (!skipStt && isBrowserSpeechSupported()) {
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SR();
      recognition.lang = lang;
      recognition.continuous = true;
      recognition.interimResults = true;
      onStatus('listening-speech');

      recognition.onresult = (event) => {
        let interim = '';
        let newlyFinal = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) newlyFinal += t + ' ';
          else interim += t;
        }
        if (newlyFinal) finalText += newlyFinal;
        const combined = (finalText + interim).trim();
        if (combined) {
          hasCapturedSpeech = true;
          onInterim(combined);
          if (autoStopOnSilence) {
            clearTimeout(silenceTimer);
            silenceTimer = setTimeout(() => {
              const out = (finalText || combined).trim();
              stopped = true;
              cleanup();
              onResult(out, { pcm16k: null });
            }, silenceMs);
          }
        }
      };

      recognition.onerror = (ev) => {
        const errCode = ev?.error || '';
        if (errCode === 'no-speech' || errCode === 'aborted') {
          stopped = true;
          cleanup();
          onResult('', { pcm16k: null });
          return;
        }
        if (!hasCapturedSpeech && (errCode === 'network' || errCode === 'service-not-allowed' || errCode === 'not-allowed')) {
          if (errCode === 'network' || errCode === 'service-not-allowed') {
            speechApiBrokenInRuntime = true;
          }
          if (recognition) {
            try {
              recognition.onend = null;
              recognition.stop();
            } catch {}
            recognition = null;
          }
          startPcmCommandCapture();
          return;
        }
        cleanup();
        onError(errCode || 'Speech error');
      };

      recognition.onend = () => {
        if (!stopped && hasCapturedSpeech) {
          stopped = true;
          const out = finalText.trim();
          cleanup();
          onResult(out, { pcm16k: null });
        } else if (!stopped) {
          stopped = true;
          cleanup();
          onResult('', { pcm16k: null });
        }
      };

      if (autoStopOnSilence) {
        noSpeechTimer = setTimeout(() => {
          if (!stopped && !hasCapturedSpeech) {
            stopped = true;
            cleanup();
            onResult('', { pcm16k: null });
          }
        }, noSpeechTimeoutMs);
      }
      recognition.start();
    } catch {
      startPcmCommandCapture();
    }
  } else {
    // If offline or no Gemini Cloud STT configured, try Windows SAPI dictation directly first so user doesn't speak twice
    const conn = getGeminiConnectionInfo?.() || {};
    const canUseCloudStt =
      (typeof navigator === 'undefined' || navigator.onLine !== false) &&
      Boolean(conn.apiKey || conn.useServerProxy);
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!canUseCloudStt && api?.offlineVoiceDictate) {
      onStatus('offline-dictating');
      onInterim('Listening (offline speech engine)...');
      api.offlineVoiceDictate(7)
        .then((dict) => {
          if (stopped) return;
          const offText = cleanSttTranscript(dict?.text || '');
          if (offText) {
            stopped = true;
            cleanup();
            onResult(offText, { pcm16k: null });
          } else {
            startPcmCommandCapture();
          }
        })
        .catch(() => {
          if (!stopped) startPcmCommandCapture();
        });
    } else {
      startPcmCommandCapture();
    }
  }

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (pcmSession) {
        finishPcmCapture(speechStarted && recordedChunks.length > 0);
        return;
      }
      const out = finalText.trim();
      cleanup();
      onResult(out, { pcm16k: null });
    },
    cancel() {
      stopped = true;
      recordedChunks = [];
      cleanup();
    },
  };
}

/**
 * Passive Wake-Word Listener ("Hey <AiName>") with spectral vocal-band VAD & Pre-Roll WAV.
 */
export function startWakeWordListener({
  aiName,
  lang = 'hi-IN',
  onWakeTriggered = () => {},
  onError = () => {},
}) {
  let cancelled = false;
  let rec = null;
  let restartTimer = null;
  let inlineWaitTimer = null;
  let pcmSession = null;
  let vadSilenceTimer = null;
  let vadMaxTimer = null;

  const stopAll = () => {
    cancelled = true;
    clearTimeout(restartTimer);
    clearTimeout(inlineWaitTimer);
    clearTimeout(vadSilenceTimer);
    clearTimeout(vadMaxTimer);
    if (rec) {
      try {
        rec.onend = null;
        rec.onerror = null;
        rec.stop();
      } catch {}
      rec = null;
    }
    if (pcmSession) {
      pcmSession.close();
      pcmSession = null;
    }
  };

  const startPcmWakeLoop = async () => {
    if (cancelled) return;
    try {
      let isCapturing = false;
      let inFlightCheck = false;
      let noiseFloor = 0.018;
      let warmFrames = 0;
      let voicedFrames = 0;
      let activeVoicedAfterTrigger = 0;
      let phraseChunks = [];

      const finishWakeClip = async () => {
        if (!isCapturing) return;
        isCapturing = false;
        clearTimeout(vadSilenceTimer);
        clearTimeout(vadMaxTimer);
        vadSilenceTimer = null;
        vadMaxTimer = null;

        const chunks = phraseChunks;
        const spokeEnough = activeVoicedAfterTrigger >= 2;
        phraseChunks = [];
        activeVoicedAfterTrigger = 0;

        if (cancelled || !spokeEnough || !chunks.length) return;
        const pcm = concatFloat32(chunks);
        if (pcm.length < 7200) return;

        inFlightCheck = true;
        try {
          const cleanPcm = normalizePcmForStt(pcm, 16000);
          const wavBase64 = encodeWavBase64(cleanPcm.length >= 2400 ? cleanPcm : pcm, 16000);
          if (cancelled) return;
          const rawTranscript = await transcribeCapturedAudio(wavBase64, {
            aiName,
            mode: 'wake',
          });
          if (cancelled) return;
          const cleaned = cleanSttTranscript(rawTranscript);
          const match = matchWakePhrase(cleaned, aiName);
          if (match.matched) {
            stopAll();
            onWakeTriggered(match.command, { pcm16k: pcm });
          }
        } catch {
          // Silently resume passive listening
        } finally {
          inFlightCheck = false;
        }
      };

      pcmSession = await createPcmStreamMonitor({
        preRollSeconds: 1.15,
        gainBoost: 3.8,
        onFrame: (pcm16k, metrics, getPreRoll) => {
          if (cancelled) return;
          const { level: lvl, isVocalFrame } = metrics;
          warmFrames++;
          if (warmFrames < 10 && !isCapturing) {
            noiseFloor = noiseFloor * 0.8 + lvl * 0.2;
            return;
          }

          const vadCfg = getVadThresholdConfig();
          const wakeThresh = Math.max(vadCfg.wakeMin, Math.min(0.16, noiseFloor * vadCfg.wakeSnr));
          if (!isCapturing) {
            if (lvl > wakeThresh && isVocalFrame && metrics.vocalRatio >= vadCfg.minVocalRatio && !inFlightCheck) {
              voicedFrames++;
              if (voicedFrames >= 2) {
                isCapturing = true;
                voicedFrames = 0;
                activeVoicedAfterTrigger = 2;
                phraseChunks = getPreRoll();
                vadMaxTimer = setTimeout(() => finishWakeClip(), 3600);
                vadSilenceTimer = setTimeout(() => finishWakeClip(), 480);
              }
            } else {
              voicedFrames = Math.max(0, voicedFrames - 1);
              if (!inFlightCheck && lvl < wakeThresh) {
                noiseFloor = noiseFloor * 0.96 + lvl * 0.04;
              }
            }
          } else {
            phraseChunks.push(pcm16k);
            if (lvl > Math.max(0.024, noiseFloor * 1.6) && isVocalFrame) {
              activeVoicedAfterTrigger++;
              clearTimeout(vadSilenceTimer);
              vadSilenceTimer = setTimeout(() => finishWakeClip(), 480);
            }
          }
        },
      });
    } catch (err) {
      onError('Wake mic error: ' + (err?.message || err));
    }
  };

  if (isBrowserSpeechSupported()) {
    const startSpeechWake = () => {
      if (cancelled) return;
      try {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        rec = new SR();
        rec.lang = lang;
        rec.continuous = true;
        rec.interimResults = true;

        rec.onresult = (event) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const phrase = event.results[i][0].transcript;
            const match = matchWakePhrase(phrase, aiName);
            if (match.matched) {
              clearTimeout(inlineWaitTimer);
              if (event.results[i].isFinal && match.command.length >= 2) {
                stopAll();
                onWakeTriggered(match.command, { pcm16k: null });
                return;
              }
              if (event.results[i].isFinal) {
                stopAll();
                onWakeTriggered('', { pcm16k: null });
                return;
              }
              inlineWaitTimer = setTimeout(() => {
                if (!cancelled) {
                  stopAll();
                  onWakeTriggered(match.command, { pcm16k: null });
                }
              }, 550);
            }
          }
        };

        rec.onerror = (ev) => {
          const code = ev?.error || '';
          if (code === 'network' || code === 'service-not-allowed') {
            speechApiBrokenInRuntime = true;
            try {
              rec.onend = null;
              rec.stop();
            } catch {}
            rec = null;
            startPcmWakeLoop();
          }
        };

        rec.onend = () => {
          if (!cancelled) {
            restartTimer = setTimeout(startSpeechWake, 400);
          }
        };

        rec.start();
      } catch {
        startPcmWakeLoop();
      }
    };
    startSpeechWake();
  } else {
    startPcmWakeLoop();
  }

  return { stop: stopAll };
}

const BARGE_STOP_REGEX = /\b(ruk|ruko|stop|wait|band|cancel|pause|chup|bas|sun|suno|hold on)\b|रुक|रुको|बंद|चुप/i;

/**
 * Lightweight Barge-In Listener while TTS is speaking:
 * Ducks TTS immediately on clear vocal speech onset and verifies interrupt/command cleanly.
 */
export function startBargeInMonitor({
  aiName = 'Jeeva',
  onDuckSpeech = () => {},
  onRestoreSpeech = () => {},
  onBargeIn = () => {},
}) {
  let cancelled = false;
  let pcmSession = null;
  let isCapturing = false;
  let inFlight = false;
  let noiseFloor = 0.03;
  let warmFrames = 0;
  let vocalFrames = 0;
  let chunks = [];
  let silenceTimer = null;
  let maxTimer = null;

  const stop = () => {
    cancelled = true;
    clearTimeout(silenceTimer);
    clearTimeout(maxTimer);
    if (pcmSession) {
      pcmSession.close();
      pcmSession = null;
    }
  };

  const evaluateInterrupt = async () => {
    if (!isCapturing) return;
    isCapturing = false;
    clearTimeout(silenceTimer);
    clearTimeout(maxTimer);
    const clip = chunks;
    chunks = [];

    const pcm = concatFloat32(clip);
    if (cancelled || pcm.length < 5600) {
      onRestoreSpeech();
      return;
    }

    inFlight = true;
    try {
      const wavB64 = encodeWavBase64(pcm, 16000);
      const raw = await transcribeCapturedAudio(wavB64, { aiName, mode: 'wake' });
      if (cancelled) return;
      const cleaned = cleanSttTranscript(raw);
      if (!cleaned) {
        onRestoreSpeech();
        return;
      }

      const wake = matchWakePhrase(cleaned, aiName);
      if (BARGE_STOP_REGEX.test(cleaned)) {
        stop();
        onBargeIn({ stopOnly: true, command: '', pcm16k: pcm });
        return;
      }
      if (wake.matched) {
        stop();
        onBargeIn({ stopOnly: false, command: wake.command, pcm16k: pcm });
        return;
      }
      if (cleaned.split(/\s+/).length >= 2) {
        stop();
        onBargeIn({ stopOnly: false, command: cleaned, pcm16k: pcm });
        return;
      }
      onRestoreSpeech();
    } catch {
      onRestoreSpeech();
    } finally {
      inFlight = false;
    }
  };

  createPcmStreamMonitor({
    preRollSeconds: 0.45,
    gainBoost: 3.0,
    onFrame: (pcm16k, metrics, getPreRoll) => {
      if (cancelled || inFlight) return;
      const { level: lvl, isVocalFrame, vocalRatio } = metrics;
      warmFrames++;
      if (warmFrames < 8) {
        noiseFloor = noiseFloor * 0.8 + lvl * 0.2;
        return;
      }

      // Higher threshold during playback so speaker echo never self-interrupts
      const bargeThresh = Math.max(0.085, Math.min(0.24, noiseFloor * 2.35));
      if (!isCapturing) {
        if (lvl > bargeThresh && isVocalFrame && vocalRatio > 0.44) {
          vocalFrames++;
          if (vocalFrames >= 3) {
            isCapturing = true;
            vocalFrames = 0;
            onDuckSpeech();
            chunks = getPreRoll();
            maxTimer = setTimeout(() => evaluateInterrupt(), 2200);
            silenceTimer = setTimeout(() => evaluateInterrupt(), 550);
          }
        } else {
          vocalFrames = Math.max(0, vocalFrames - 1);
          if (lvl < bargeThresh * 0.8) noiseFloor = noiseFloor * 0.95 + lvl * 0.05;
        }
      } else {
        chunks.push(pcm16k);
        if (lvl > Math.max(0.04, noiseFloor * 1.5) && isVocalFrame) {
          clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => evaluateInterrupt(), 550);
        }
      }
    },
  })
    .then((sess) => {
      if (cancelled) sess.close();
      else pcmSession = sess;
    })
    .catch(() => {});

  return { stop };
}
