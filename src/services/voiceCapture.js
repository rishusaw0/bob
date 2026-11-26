// Master Voice Capture & Wake-Word Engine:
// 1. 16 kHz Mono PCM Ring Buffer + Pre-Roll WAV Capture + Adaptive VAD (Electron & Universal fallback)
// 2. Native Web Speech API for Chrome/Edge/Android browsers (zero API cost)
import { transcribeAudio } from './gemini.js';
import { matchWakePhrase, getAiName } from './voiceRouter.js';

let speechApiBrokenInRuntime = false;

export function isBrowserSpeechSupported() {
  if (typeof window === 'undefined') return false;
  // Electron Chromium lacks Google's Chrome Speech API key and always fails with 'network'
  if (window.electronAPI) return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) && !speechApiBrokenInRuntime;
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
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
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

function calcRmsLevel(samples, gainBoost = 3.6) {
  if (!samples || !samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, rms * gainBoost);
}

/**
 * Opens a shared 16kHz PCM ring-buffer + processor session on the active microphone.
 */
async function createPcmStreamMonitor({ preRollSeconds = 0.75, gainBoost = 3.6, onFrame }) {
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
    const pcm16k = downsampleFloat32(raw, ctx.sampleRate, 16000);
    const level = calcRmsLevel(pcm16k, gainBoost);

    preRollChunks.push(pcm16k);
    preRollTotal += pcm16k.length;
    while (preRollTotal > maxPreRollSamples && preRollChunks.length > 1) {
      const dropped = preRollChunks.shift();
      preRollTotal -= dropped.length;
    }

    onFrame?.(pcm16k, level, () => preRollChunks.slice());
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
 * Captures a single spoken command with pre-roll WAV capture + adaptive VAD end-pointing.
 */
export function startVoiceCapture({
  lang = 'hi-IN',
  autoStopOnSilence = true,
  silenceMs = 1150,
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
    onLevel(0);
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
      onResult('');
      return;
    }

    const pcm = concatFloat32(captured);
    if (pcm.length < 3200) {
      onResult('');
      return;
    }

    try {
      onStatus('transcribing');
      onInterim('Understanding command...');
      const wavBase64 = encodeWavBase64(pcm, 16000);
      const rawText = await transcribeAudio(wavBase64, 'audio/wav', {
        aiName: getAiName(),
        mode: 'command',
      });
      onResult(cleanSttTranscript(rawText));
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
        preRollSeconds: 0.6,
        gainBoost: 3.6,
        onFrame: (pcm16k, lvl, getPreRoll) => {
          if (stopped) return;
          onLevel(lvl);

          if (!speechStarted) {
            // Update noise floor ONLY on quiet background frames so sudden speech doesn't inflate threshold
            if (lvl < Math.max(0.055, noiseFloor * 2.2)) {
              noiseFloor = noiseFloor * 0.88 + lvl * 0.12;
            }
            const startThresh = Math.max(0.032, Math.min(0.14, noiseFloor * 2.0));
            if (lvl > startThresh) {
              voicedFrames++;
              if (voicedFrames >= 2) {
                speechStarted = true;
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
            if (lvl > sustainThresh) {
              clearTimeout(silenceTimer);
              silenceTimer = setTimeout(() => {
                if (!stopped) {
                  stopped = true;
                  finishPcmCapture(true);
                }
              }, silenceMs);
            } else if (!silenceTimer) {
              silenceTimer = setTimeout(() => {
                if (!stopped) {
                  stopped = true;
                  finishPcmCapture(true);
                }
              }, silenceMs);
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
        }, 5500);
      }

      maxCapTimer = setTimeout(() => {
        if (!stopped) {
          stopped = true;
          finishPcmCapture(speechStarted || recordedChunks.length > 0);
        }
      }, 14000);
    } catch (err) {
      cleanup();
      onError('Microphone access denied: ' + (err?.message || err));
    }
  };

  if (isBrowserSpeechSupported()) {
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
              onResult(out);
            }, silenceMs);
          }
        }
      };

      recognition.onerror = (ev) => {
        const errCode = ev?.error || '';
        if (errCode === 'no-speech' || errCode === 'aborted') {
          stopped = true;
          cleanup();
          onResult('');
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
          onResult(out);
        } else if (!stopped) {
          stopped = true;
          cleanup();
          onResult('');
        }
      };

      recognition.start();
    } catch {
      startPcmCommandCapture();
    }
  } else {
    startPcmCommandCapture();
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
      onResult(out);
    },
    cancel() {
      stopped = true;
      recordedChunks = [];
      cleanup();
    },
  };
}

/**
 * Passive Wake-Word Listener ("Hey <AiName>"):
 * - Chrome/Edge/Android: zero-cost native SpeechRecognition with deferred inline-command wait
 * - Electron Desktop: continuous 16kHz PCM circular Pre-Roll Ring Buffer (never clips "Hey"!) + WAV VAD
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
        // Require at least ~0.45s total audio (pre-roll + speech)
        if (pcm.length < 7200) return;

        inFlightCheck = true;
        try {
          const wavBase64 = encodeWavBase64(pcm, 16000);
          if (cancelled) return;
          const rawTranscript = await transcribeAudio(wavBase64, 'audio/wav', {
            aiName,
            mode: 'wake',
          });
          if (cancelled) return;
          const cleaned = cleanSttTranscript(rawTranscript);
          const match = matchWakePhrase(cleaned, aiName);
          if (match.matched) {
            stopAll();
            onWakeTriggered(match.command);
          }
        } catch {
          // Silently resume passive listening
        } finally {
          inFlightCheck = false;
        }
      };

      pcmSession = await createPcmStreamMonitor({
        preRollSeconds: 0.75,
        gainBoost: 3.8,
        onFrame: (pcm16k, lvl, getPreRoll) => {
          if (cancelled) return;
          warmFrames++;
          if (warmFrames < 10 && !isCapturing) {
            noiseFloor = noiseFloor * 0.8 + lvl * 0.2;
            return;
          }

          const wakeThresh = Math.max(0.032, Math.min(0.14, noiseFloor * 1.9));
          if (!isCapturing) {
            if (lvl > wakeThresh && !inFlightCheck) {
              voicedFrames++;
              if (voicedFrames >= 2) {
                isCapturing = true;
                voicedFrames = 0;
                activeVoicedAfterTrigger = 2;
                phraseChunks = getPreRoll();
                vadMaxTimer = setTimeout(() => finishWakeClip(), 4200);
                vadSilenceTimer = setTimeout(() => finishWakeClip(), 680);
              }
            } else {
              voicedFrames = Math.max(0, voicedFrames - 1);
              if (!inFlightCheck && lvl < wakeThresh) {
                noiseFloor = noiseFloor * 0.96 + lvl * 0.04;
              }
            }
          } else {
            phraseChunks.push(pcm16k);
            if (lvl > Math.max(0.024, noiseFloor * 1.6)) {
              activeVoicedAfterTrigger++;
              clearTimeout(vadSilenceTimer);
              vadSilenceTimer = setTimeout(() => finishWakeClip(), 680);
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
                onWakeTriggered(match.command);
                return;
              }
              if (event.results[i].isFinal) {
                stopAll();
                onWakeTriggered('');
                return;
              }
              // Defer briefly on interim "Hey Jeeva" so same-breath inline commands arrive intact
              inlineWaitTimer = setTimeout(() => {
                if (!cancelled) {
                  stopAll();
                  onWakeTriggered(match.command);
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
