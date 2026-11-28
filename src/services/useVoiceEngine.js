// Global Always-On Voice Hook: Tiered Router + Deictic Context + Barge-In + Speaker Voiceprint + Gemini Live
import { useState, useEffect, useRef, useCallback } from 'react';
import { playWakeChime, playDoneChime, playErrorChime } from './earcon.js';
import {
  subscribeSpeech,
  stopSpeech,
  duckSpeech,
  restoreSpeech,
  fadeOutAndStopSpeech,
  speakText,
} from './speech.js';
import { toast } from './toast.js';
import {
  startVoiceCapture,
  startWakeWordListener,
  startBargeInMonitor,
} from './voiceCapture.js';
import {
  getWakeWordEnabled,
  setWakeWordEnabled as persistWakeEnabled,
  getWakeOpenMode,
  getWakeTriggerPhrase,
} from './voiceRouter.js';
import { captureVoiceContextSnapshot } from './voiceContext.js';
import { verifySpeakerVoiceprint } from './speakerVerify.js';

export function useVoiceEngine({
  aiName,
  onSend,
  isLoading,
  autoListenSignal,
  onWakeOpen,
  requestPermission = null,
  enabled = true,
}) {
  const [phase, setPhase] = useState('idle'); // 'idle' | 'listening' | 'thinking'
  const [liveTranscript, setLiveTranscript] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [micBands, setMicBands] = useState([0, 0, 0, 0, 0]);
  const [wakeEnabled, setWakeEnabled] = useState(() => getWakeWordEnabled());
  const [wakeTrigger, setWakeTrigger] = useState(() => getWakeTriggerPhrase());
  const [externalMicBusy, setExternalMicBusy] = useState(false);
  const [speechState, setSpeechState] = useState({
    isPlaying: false,
    detectedProfile: 'hinglish',
    audioLevel: 0,
    freqBands: [0, 0, 0, 0, 0],
  });

  const captureRef = useRef(null);
  const wakeListenerRef = useRef(null);
  const bargeInRef = useRef(null);
  const phaseRef = useRef('idle');
  const isLoadingRef = useRef(isLoading);
  const voiceFollowUpPendingRef = useRef(false);
  const prevSpeakingRef = useRef(false);
  const followUpTimerRef = useRef(null);
  const notchHiddenRef = useRef(false);
  const notchHideTimerRef = useRef(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => subscribeSpeech(setSpeechState), []);

  useEffect(() => {
    const onWakeChanged = (ev) => {
      if (typeof ev?.detail === 'boolean') setWakeEnabled(ev.detail);
    };
    const onTriggerChanged = () => {
      setWakeTrigger(getWakeTriggerPhrase());
    };
    const onExternalMic = (ev) => {
      setExternalMicBusy(Boolean(ev?.detail));
    };
    window.addEventListener('jeeva-wake-settings-changed', onWakeChanged);
    window.addEventListener('jeeva-wake-trigger-updated', onTriggerChanged);
    window.addEventListener('jeeva-mic-active', onExternalMic);
    return () => {
      window.removeEventListener('jeeva-wake-settings-changed', onWakeChanged);
      window.removeEventListener('jeeva-wake-trigger-updated', onTriggerChanged);
      window.removeEventListener('jeeva-mic-active', onExternalMic);
    };
  }, []);

  const orbState = isLoading
    ? 'thinking'
    : speechState.isPlaying
      ? 'speaking'
      : phase === 'listening'
        ? 'listening'
        : 'idle';

  const activeAudioLevel = orbState === 'speaking' ? (speechState.audioLevel || 0) : micLevel;
  const activeFreqBands = orbState === 'speaking' ? speechState.freqBands : micBands;

  const stopWakeListener = useCallback(() => {
    if (wakeListenerRef.current) {
      wakeListenerRef.current.stop();
      wakeListenerRef.current = null;
    }
  }, []);

  const stopBargeIn = useCallback(() => {
    if (bargeInRef.current) {
      bargeInRef.current.stop();
      bargeInRef.current = null;
    }
  }, []);

  const stopCommandCapture = useCallback((submitNow = false) => {
    if (captureRef.current) {
      if (submitNow) captureRef.current.stop();
      else captureRef.current.cancel();
      captureRef.current = null;
    }
    setMicLevel(0);
    setMicBands([0, 0, 0, 0, 0]);
  }, []);

  const submitVoiceCommand = useCallback(
    async (cmdText, opts = {}) => {
      const cleaned = (cmdText || '').trim();
      if (!cleaned) {
        setPhase('idle');
        return;
      }
      clearTimeout(followUpTimerRef.current);
      voiceFollowUpPendingRef.current = true;
      setLiveTranscript(cleaned);
      setPhase('thinking');
      playDoneChime();

      const speakerCheck = opts?.pcm16k
        ? verifySpeakerVoiceprint(opts.pcm16k)
        : { active: false, verified: true, score: 1 };

      if (speakerCheck.active && !speakerCheck.verified) {
        try {
          const pct = Math.round((speakerCheck.score || 0) * 100);
          setLiveTranscript(`Voice blocked (${pct}% match — Owner only)`);
          toast.error(`Voice Protection: Owner voice match nahi hui (${pct}%). Command blocked.`);
          speakText(
            'Access denied. Yeh owner ki aawaz match nahi hui, isliye command block kar diya gaya hai.',
            { instant: true }
          ).catch(() => {});
        } finally {
          phaseRef.current = 'idle';
          setPhase('idle');
        }
        return;
      }

      try {
        const ctxSnap = await captureVoiceContextSnapshot(cleaned);
        await onSend(ctxSnap.enrichedPrompt, ctxSnap.attachment, {
          fromVoice: true,
          rawVoiceText: cleaned,
          speakerVerified: speakerCheck.verified,
          speakerScore: speakerCheck.score,
        });
      } finally {
        phaseRef.current = 'idle';
        setPhase('idle');
      }
    },
    [onSend]
  );

  const startCommandListening = useCallback(
    ({ isFollowUp = false, noSpeechTimeoutMs = 5800 } = {}) => {
      clearTimeout(followUpTimerRef.current);
      clearTimeout(notchHideTimerRef.current);
      notchHiddenRef.current = false;
      if (!isFollowUp) stopSpeech();
      stopWakeListener();
      stopBargeIn();
      stopCommandCapture(false);

      setLiveTranscript(isFollowUp ? 'Listening for follow-up...' : '');
      phaseRef.current = 'listening';
      setPhase('listening');
      if (!isFollowUp) playWakeChime();

      const beginMicCapture = () => {
        if (phaseRef.current !== 'listening') return;
        captureRef.current = startVoiceCapture({
          lang: 'hi-IN',
          autoStopOnSilence: true,
          silenceMs: 740,
          noSpeechTimeoutMs,
          onInterim: (txt) => setLiveTranscript(txt),
          onLevel: (lvl, bands) => {
            setMicLevel(lvl);
            if (bands) setMicBands(bands);
          },
          onResult: (finalCmd, info) => {
            captureRef.current = null;
            setMicLevel(0);
            setMicBands([0, 0, 0, 0, 0]);
            if (finalCmd && finalCmd.trim()) {
              submitVoiceCommand(finalCmd, { pcm16k: info?.pcm16k || null });
            } else {
              if (isFollowUp) setLiveTranscript('');
              setPhase('idle');
            }
          },
          onError: (errMsg) => {
            captureRef.current = null;
            setMicLevel(0);
            setMicBands([0, 0, 0, 0, 0]);
            setLiveTranscript(isFollowUp ? '' : errMsg || 'Could not hear audio');
            setPhase('idle');
            if (!isFollowUp) {
              setTimeout(() => {
                setLiveTranscript((cur) => (cur === (errMsg || 'Could not hear audio') ? '' : cur));
              }, 2800);
            }
          },
        });
      };

      if (!isFollowUp) {
        setTimeout(beginMicCapture, 130);
      } else {
        beginMicCapture();
      }
    },
    [stopWakeListener, stopBargeIn, stopCommandCapture, submitVoiceCommand]
  );

  const handleWakeActivation = useCallback(
    (inlineCmd, info = {}) => {
      notchHiddenRef.current = false;
      clearTimeout(notchHideTimerRef.current);
      const targetMode = getWakeOpenMode();
      if (targetMode !== 'notch') {
        onWakeOpen?.(targetMode);
      }
      window.electronAPI?.wakeRestore?.(targetMode)?.catch?.(() => {});

      if (inlineCmd && inlineCmd.trim()) {
        playWakeChime();
        submitVoiceCommand(inlineCmd, { pcm16k: info?.pcm16k || null });
      } else {
        startCommandListening();
      }
    },
    [onWakeOpen, submitVoiceCommand, startCommandListening]
  );

  useEffect(() => {
    if (enabled && autoListenSignal > 0) {
      notchHiddenRef.current = false;
      startCommandListening();
    }
  }, [enabled, autoListenSignal, startCommandListening]);

  // Sync live voice activity (listening / thinking / speaking / waveform) -> Top-Center Camera Notch Island
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.updateNotchState) return;

    if (orbState !== 'idle') {
      clearTimeout(notchHideTimerRef.current);
      if (!notchHiddenRef.current) {
        api.updateNotchState({
          visible: true,
          orbState,
          aiName,
          transcript: liveTranscript,
          freqBands: activeFreqBands,
          error: '',
        }).catch(() => {});
      }
    } else if (!voiceFollowUpPendingRef.current) {
      clearTimeout(notchHideTimerRef.current);
      notchHideTimerRef.current = setTimeout(() => {
        // Never allow background idle updates to override an explicit user hide
        if (notchHiddenRef.current) {
          api.updateNotchState({
            visible: false,
            standby: false,
            orbState: 'idle',
            aiName,
          }).catch(() => {});
          return;
        }
        const keepStandby = typeof document !== 'undefined' && document.hidden;
        api.updateNotchState({
          visible: keepStandby,
          standby: keepStandby,
          orbState: 'idle',
          aiName,
        }).catch(() => {});
      }, 900);
    }
  }, [orbState, aiName, liveTranscript, activeFreqBands]);

  // Real-time Barge-In monitor while JEEVA TTS is speaking (say "Ruk" / "Stop" or interrupt naturally)
  useEffect(() => {
    if (!enabled || !wakeEnabled || !speechState.isPlaying || externalMicBusy || phase !== 'idle') {
      stopBargeIn();
      return;
    }

    bargeInRef.current = startBargeInMonitor({
      aiName,
      onDuckSpeech: () => duckSpeech(0.16),
      onRestoreSpeech: () => restoreSpeech(),
      onBargeIn: async ({ stopOnly, command, pcm16k }) => {
        bargeInRef.current = null;
        voiceFollowUpPendingRef.current = false;
        await fadeOutAndStopSpeech(90);
        if (stopOnly) {
          playErrorChime();
          setLiveTranscript('Stopped.');
          setTimeout(() => setLiveTranscript(''), 1500);
        } else if (command && command.trim()) {
          submitVoiceCommand(command, { pcm16k });
        } else {
          startCommandListening();
        }
      },
    });

    return () => {
      stopBargeIn();
    };
  }, [
    enabled,
    wakeEnabled,
    speechState.isPlaying,
    externalMicBusy,
    phase,
    aiName,
    stopBargeIn,
    submitVoiceCommand,
    startCommandListening,
  ]);

  // 4.5-Second Warm Follow-Up Window right after TTS finishes speaking a voice reply
  useEffect(() => {
    const wasPlaying = prevSpeakingRef.current;
    prevSpeakingRef.current = speechState.isPlaying;

    if (
      wasPlaying &&
      !speechState.isPlaying &&
      voiceFollowUpPendingRef.current &&
      enabled &&
      wakeEnabled &&
      !externalMicBusy &&
      !isLoading &&
      phaseRef.current === 'idle'
    ) {
      voiceFollowUpPendingRef.current = false;
      followUpTimerRef.current = setTimeout(() => {
        if (!isLoadingRef.current && phaseRef.current === 'idle') {
          startCommandListening({ isFollowUp: true, noSpeechTimeoutMs: 4500 });
        }
      }, 280);
      return () => clearTimeout(followUpTimerRef.current);
    } else if (!speechState.isPlaying && !isLoading && phaseRef.current === 'idle') {
      // Clear stale pending flag if voice turn produced no spoken output
      const clearTimer = setTimeout(() => {
        if (!speechState.isPlaying) voiceFollowUpPendingRef.current = false;
      }, 1200);
      return () => clearTimeout(clearTimer);
    }
  }, [speechState.isPlaying, enabled, wakeEnabled, externalMicBusy, isLoading, startCommandListening]);

  // Persistent Always-On Wake Word Listener ("Hey <AiName>") across ALL window states
  useEffect(() => {
    if (!enabled || !wakeEnabled || orbState !== 'idle' || externalMicBusy) {
      stopWakeListener();
      return;
    }

    let cancelled = false;
    const api = window.electronAPI;

    const startFallbackWake = () => {
      if (cancelled || wakeListenerRef.current || phaseRef.current !== 'idle') return;
      wakeListenerRef.current = startWakeWordListener({
        aiName,
        lang: 'hi-IN',
        onWakeTriggered: (inlineCmd, info) => {
          wakeListenerRef.current = null;
          if (cancelled) return;
          handleWakeActivation(inlineCmd, info);
        },
      });
    };

    const timer = setTimeout(() => {
      if (cancelled || phaseRef.current !== 'idle') return;

      // Wake phrases are recognized from PCM audio by Gemini transcription; no local ASR engines.
      startFallbackWake();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopWakeListener();
    };
  }, [enabled, aiName, wakeTrigger, wakeEnabled, orbState, externalMicBusy, handleWakeActivation, stopWakeListener]);

  const toggleOrb = useCallback(() => {
    if (speechState.isPlaying) {
      voiceFollowUpPendingRef.current = false;
      fadeOutAndStopSpeech(110);
      return;
    }
    if (phase === 'listening') {
      stopCommandCapture(true);
    } else if (!isLoading) {
      startCommandListening();
    }
  }, [speechState.isPlaying, phase, isLoading, stopCommandCapture, startCommandListening]);

  const toggleWake = useCallback(() => {
    setWakeEnabled((prev) => persistWakeEnabled(!prev));
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onNotchEvent) return;
    return api.onNotchEvent((ev) => {
      if (ev?.action === 'hide') {
        notchHiddenRef.current = true;
        voiceFollowUpPendingRef.current = false;
        fadeOutAndStopSpeech(90);
        stopCommandCapture(false);
        setPhase('idle');
      } else if (ev?.action === 'toggle_mic') {
        toggleOrb();
      } else if (ev?.action === 'send_text' && ev?.text) {
        onSend?.(ev.text, null, { fromVoice: false, rawVoiceText: ev.text });
      } else if (ev?.action === 'send_attachment' && ev?.attachment) {
        onSend?.(ev.text || '', ev.attachment, { fromVoice: false, rawVoiceText: ev.text || '' });
      }
    });
  }, [toggleOrb, stopCommandCapture, onSend]);

  useEffect(() => {
    return () => {
      clearTimeout(followUpTimerRef.current);
      clearTimeout(notchHideTimerRef.current);
      stopCommandCapture(false);
      stopWakeListener();
      stopBargeIn();
    };
  }, [stopCommandCapture, stopWakeListener, stopBargeIn]);

  return {
    phase,
    orbState,
    liveTranscript,
    setLiveTranscript,
    micLevel: activeAudioLevel,
    freqBands: activeFreqBands,
    wakeEnabled,
    toggleWake,
    speechState,
    toggleOrb,
  };
}
