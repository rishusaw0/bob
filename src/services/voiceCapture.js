// Master Voice Capture & Wake-Word Engine:
// 1. High-accuracy Web Speech API with noise suppression + fuzzy custom wake matching
// 2. Automatic MediaRecorder + Adaptive Energy-VAD + Gemini Audio STT (works in Electron & everywhere!)
import { transcribeAudio } from './gemini.js';
import { startMicMeter, stopMicMeter } from './earcon.js';
import { matchWakePhrase, getAiName } from './voiceRouter.js';

let speechApiBrokenInRuntime = false;

export function isBrowserSpeechSupported() {
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

function getSupportedRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

/**
 * Captures a single spoken command with automatic silence end-pointing.
 */
export function startVoiceCapture({
  lang = 'hi-IN',
  autoStopOnSilence = true,
  silenceMs = 1100,
  onInterim = () => {},
  onLevel = () => {},
  onStatus = () => {},
  onResult = () => {},
  onError = () => {},
}) {
  let stopped = false;
  let mediaRecorder = null;
  let audioStream = null;
  let recognition = null;
  let silenceTimer = null;
  let maxCapTimer = null;
  let finalText = '';
  let hasCapturedSpeech = false;

  const cleanup = () => {
    clearTimeout(silenceTimer);
    clearTimeout(maxCapTimer);
    stopMicMeter();
    onLevel(0);
    if (recognition) {
      try {
        recognition.onend = null;
        recognition.onerror = null;
        recognition.stop();
      } catch {}
      recognition = null;
    }
    if (audioStream) {
      audioStream.getTracks().forEach((t) => t.stop());
      audioStream = null;
    }
  };

  const startMediaRecorderFallback = async () => {
    if (stopped) return;
    try {
      onStatus('listening-audio');
      onInterim('Listening...');
      audioStream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
      const mimeType = getSupportedRecorderMime();

      const chunks = [];
      mediaRecorder = mimeType ? new MediaRecorder(audioStream, { mimeType }) : new MediaRecorder(audioStream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const usedMime = (mediaRecorder?.mimeType || 'audio/webm').split(';')[0];
        cleanup();
        if (!chunks.length) {
          onResult('');
          return;
        }
        try {
          onStatus('transcribing');
          onInterim('Understanding command...');
          const blob = new Blob(chunks, { type: usedMime });
          const reader = new FileReader();
          reader.onloadend = async () => {
            try {
              const dataUrl = reader.result;
              const base64 = String(dataUrl).split(',')[1];
              const text = await transcribeAudio(base64, usedMime, { aiName: getAiName(), mode: 'command' });
              onResult(text);
            } catch (err) {
              onError(err.message || 'Voice transcription failed');
            }
          };
          reader.readAsDataURL(blob);
        } catch (err) {
          onError(err.message || 'Audio processing failed');
        }
      };

      mediaRecorder.start(200);

      // Adaptive noise-floor VAD sharing the exact same audioStream
      let speechStarted = false;
      let noiseFloor = 0.035;
      let samples = 0;

      startMicMeter((lvl) => {
        onLevel(lvl);
        if (!autoStopOnSilence || stopped) return;

        samples++;
        if (samples < 12 && !speechStarted) {
          noiseFloor = noiseFloor * 0.8 + lvl * 0.2;
        }

        const speechThreshold = Math.max(0.085, noiseFloor * 2.1);
        if (lvl > speechThreshold) {
          speechStarted = true;
          clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
          }, silenceMs + 150);
        } else if (speechStarted && !silenceTimer) {
          silenceTimer = setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
          }, silenceMs + 150);
        }
      }, audioStream);

      maxCapTimer = setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      }, 13000);
    } catch (err) {
      cleanup();
      onError('Microphone access denied: ' + (err.message || err));
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
      startMicMeter(onLevel);

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
          stopMicMeter();
          startMediaRecorderFallback();
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
          cleanup();
          onResult('');
        }
      };

      recognition.start();
    } catch {
      startMediaRecorderFallback();
    }
  } else {
    startMediaRecorderFallback();
  }

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        return;
      }
      const out = finalText.trim();
      cleanup();
      onResult(out);
    },
    cancel() {
      stopped = true;
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.onstop = null;
        try {
          mediaRecorder.stop();
        } catch {}
      }
      cleanup();
    },
  };
}

/**
 * Passive Wake-Word Listener ("Hey <AiName>"):
 * - Uses instant native SpeechRecognition when available (Chrome/Edge/Android)
 * - Automatically falls back to Zero-Idle-API Adaptive VAD + Short Clip Gemini Wake Check in Electron!
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
  let audioStream = null;
  let vadRecorder = null;
  let vadSilenceTimer = null;
  let vadMaxTimer = null;

  const stopAll = () => {
    cancelled = true;
    clearTimeout(restartTimer);
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
    if (vadRecorder && vadRecorder.state === 'recording') {
      vadRecorder.onstop = null;
      try {
        vadRecorder.stop();
      } catch {}
    }
    vadRecorder = null;
    stopMicMeter();
    if (audioStream) {
      audioStream.getTracks().forEach((t) => t.stop());
      audioStream = null;
    }
  };

  // Fallback for Electron Desktop: only records short burst when clear vocal energy crosses noise floor
  const startEnergyVadWakeLoop = async () => {
    if (cancelled) return;
    try {
      audioStream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
      const mimeType = getSupportedRecorderMime();
      let isCapturingPhrase = false;
      let inFlightCheck = false;
      let noiseFloor = 0.025;
      let warmSamples = 0;
      let voicedFrames = 0;

      const beginClip = () => {
        if (cancelled || isCapturingPhrase || inFlightCheck || !audioStream) return;
        isCapturingPhrase = true;
        const chunks = [];
        const mr = mimeType ? new MediaRecorder(audioStream, { mimeType }) : new MediaRecorder(audioStream);
        vadRecorder = mr;

        mr.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        mr.onstop = async () => {
          isCapturingPhrase = false;
          vadRecorder = null;
          clearTimeout(vadMaxTimer);
          clearTimeout(vadSilenceTimer);
          if (cancelled || chunks.length === 0) return;

          const usedMime = (mr.mimeType || 'audio/webm').split(';')[0];
          const blob = new Blob(chunks, { type: usedMime });
          if (blob.size < 1800) return; // Skip tiny clicks/pops

          inFlightCheck = true;
          try {
            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            if (cancelled) return;
            const base64 = String(dataUrl).split(',')[1];
            const transcript = await transcribeAudio(base64, usedMime, { aiName, mode: 'wake' });
            if (cancelled) return;
            const match = matchWakePhrase(transcript, aiName);
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

        mr.start(150);
        vadMaxTimer = setTimeout(() => {
          if (mr.state === 'recording') mr.stop();
        }, 4400);
      };

      startMicMeter((lvl) => {
        if (cancelled) return;
        warmSamples++;
        if (warmSamples < 16 && !isCapturingPhrase) {
          noiseFloor = noiseFloor * 0.8 + lvl * 0.2;
          return;
        }

        // Far-field tuned threshold (~1-3m room voice works cleanly with 2.4x boost)
        const wakeThreshold = Math.max(0.038, noiseFloor * 1.75);
        if (lvl > wakeThreshold && !inFlightCheck) {
          voicedFrames++;
          if (!isCapturingPhrase && voicedFrames >= 2) {
            beginClip();
          }
          if (isCapturingPhrase) {
            clearTimeout(vadSilenceTimer);
            vadSilenceTimer = setTimeout(() => {
              if (vadRecorder && vadRecorder.state === 'recording') {
                vadRecorder.stop();
              }
            }, 720);
          }
        } else {
          voicedFrames = Math.max(0, voicedFrames - 1);
          if (!isCapturingPhrase && !inFlightCheck) {
            noiseFloor = noiseFloor * 0.96 + lvl * 0.04;
          } else if (isCapturingPhrase && !vadSilenceTimer) {
            vadSilenceTimer = setTimeout(() => {
              if (vadRecorder && vadRecorder.state === 'recording') {
                vadRecorder.stop();
              }
            }, 720);
          }
        }
      }, audioStream, { boost: 2.6 });
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
              if (event.results[i].isFinal && match.command.length >= 3) {
                stopAll();
                onWakeTriggered(match.command);
                return;
              }
              if (event.results[i].isFinal || match.command.length === 0) {
                stopAll();
                onWakeTriggered('');
                return;
              }
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
            startEnergyVadWakeLoop();
          }
        };

        rec.onend = () => {
          if (!cancelled) {
            restartTimer = setTimeout(startSpeechWake, 400);
          }
        };

        rec.start();
      } catch {
        startEnergyVadWakeLoop();
      }
    };
    startSpeechWake();
  } else {
    startEnergyVadWakeLoop();
  }

  return { stop: stopAll };
}
