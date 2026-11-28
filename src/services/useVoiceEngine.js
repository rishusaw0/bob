// Global Always-On Voice Hook: Tiered Router + Deictic Context + Barge-In + Speaker Voiceprint + Gemini Live
import { useState, useEffect, useRef, useCallback } from 'react';
import { playWakeChime, playDoneChime } from './earcon.js';
import {
  subscribeSpeech,
  stopSpeech,
  duckSpeech,
  restoreSpeech,
  fadeOutAndStopSpeech,
} from './speech.js';
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
import { startLiveVoiceCall } from './liveAudio.js';

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
  const [offlineWakeStatus, setOfflineWakeStatus] = useState({ available: null, running: false, culture: '' });
  const [externalMicBusy, setExternalMicBusy] = useState(false);
  const [speechState, setSpeechState] = useState({
    isPlaying: false,
    detectedProfile: 'hinglish',
    audioLevel: 0,
    freqBands: [0, 0, 0, 0, 0],
  });
  const [liveActive, setLiveActive] = useState(false);
  const [liveState, setLiveState] = useState('idle');

  const captureRef = useRef(null);
  const wakeListenerRef = useRef(null);
  const bargeInRef = useRef(null);
  const liveSessionRef = useRef(null);
  const phaseRef = useRef('idle');
  const offlineUnsupportedRef = useRef(false);
  const voiceFollowUpPendingRef = useRef(false);
  const prevSpeakingRef = useRef(false);
  const followUpTimerRef = useRef(null);
  const notchHiddenRef = useRef(false);
  const notchHideTimerRef = useRef(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    offlineUnsupportedRef.current = false;
  }, [aiName]);

  useEffect(() => subscribeSpeech(setSpeechState), []);

  useEffect(() => {
    const onWakeChanged = (ev) => {
      if (typeof ev?.detail === 'boolean') setWakeEnabled(ev.detail);
    };
    const onTriggerChanged = () => {
      offlineUnsupportedRef.current = false;
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

  const orbState = liveActive
    ? liveState === 'connecting'
      ? 'thinking'
      : liveState
    : isLoading
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
    window.electronAPI?.offlineVoiceStop?.().catch?.(() => {});
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
        const pct = Math.round((speakerCheck.score || 0) * 100);
        setLiveTranscript(`Voice blocked (${pct}% match — Owner only)`);
        toast.error(`Voice Protection: Owner voice match nahi hui (${pct}%). Command blocked.`);
        speakText(
          'Access denied. Yeh owner ki aawaz match nahi hui, isliye command block kar diya gaya hai.',
          { instant: true }
        ).catch(() => {});
        setPhase('idle');
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
    if (!enabled || !wakeEnabled || liveActive || !speechState.isPlaying || externalMicBusy || phase !== 'idle') {
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
        await fadeOutAndStopSpeech(110);
        if (stopOnly) {
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
    liveActive,
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
      !liveActive &&
      !externalMicBusy &&
      !isLoading &&
      phaseRef.current === 'idle'
    ) {
      voiceFollowUpPendingRef.current = false;
      followUpTimerRef.current = setTimeout(() => {
        if (!liveActive && !isLoading && phaseRef.current === 'idle') {
          startCommandListening({ isFollowUp: true, noSpeechTimeoutMs: 4500 });
        }
      }, 280);
    } else if (!speechState.isPlaying && !isLoading && phaseRef.current === 'idle') {
      // Clear stale pending flag if voice turn produced no spoken output
      const clearTimer = setTimeout(() => {
        if (!speechState.isPlaying) voiceFollowUpPendingRef.current = false;
      }, 1200);
      return () => clearTimeout(clearTimer);
    }
  }, [speechState.isPlaying, enabled, wakeEnabled, liveActive, externalMicBusy, isLoading, startCommandListening]);

  // Persistent Always-On Wake Word Listener ("Hey <AiName>") across ALL window states
  useEffect(() => {
    if (!enabled || !wakeEnabled || orbState !== 'idle' || externalMicBusy || liveActive) {
      stopWakeListener();
      return;
    }

    let cancelled = false;
    let unsubOffline = null;
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

      if (!offlineUnsupportedRef.current && api?.offlineVoiceStart && api?.onOfflineVoiceEvent) {
        unsubOffline = api.onOfflineVoiceEvent((ev) => {
          if (cancelled) return;
          if (ev.type === 'status') {
            setOfflineWakeStatus({
              available: ev.available,
              running: Boolean(ev.running),
              culture: ev.culture || '',
              reason: ev.reason || '',
            });
            if (ev.available === false) {
              offlineUnsupportedRef.current = true;
              startFallbackWake();
            }
          } else if (ev.type === 'wake') {
            api.offlineVoiceStop?.().catch?.(() => {});
            handleWakeActivation(ev.command);
          }
        });
        const offlineSpec = wakeTrigger ? `${aiName}|${wakeTrigger}` : aiName;
        api.offlineVoiceStart(offlineSpec).catch(() => {
          offlineUnsupportedRef.current = true;
          startFallbackWake();
        });
      } else {
        startFallbackWake();
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubOffline?.();
      stopWakeListener();
    };
  }, [enabled, aiName, wakeTrigger, wakeEnabled, orbState, externalMicBusy, liveActive, handleWakeActivation, stopWakeListener]);

  const stopLiveCall = useCallback(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.stop();
      liveSessionRef.current = null;
    }
    setLiveActive(false);
    setLiveState('idle');
    setMicLevel(0);
    setMicBands([0, 0, 0, 0, 0]);
  }, []);

  const toggleLiveCall = useCallback(async () => {
    if (liveActive || liveSessionRef.current) {
      stopLiveCall();
      return;
    }
    stopSpeech();
    stopWakeListener();
    stopBargeIn();
    stopCommandCapture(false);
    setLiveTranscript('Connecting Gemini Live Call...');
    setLiveActive(true);
    setLiveState('connecting');

    try {
      const sess = await startLiveVoiceCall({
        aiName,
        requestPermission,
        onStateChange: (st) => {
          setLiveState(st);
          if (st === 'idle') {
            liveSessionRef.current = null;
            setLiveActive(false);
          }
        },
        onTranscript: ({ role, text }) => {
          if (text) setLiveTranscript(`${role === 'user' ? 'You' : aiName}: ${text}`);
        },
        onAudioMetrics: (lvl, bands) => {
          setMicLevel(lvl);
          if (bands) setMicBands(bands);
        },
        onError: (errMsg) => {
          setLiveTranscript(errMsg || 'Live Call ended');
        },
      });
      liveSessionRef.current = sess;
    } catch (err) {
      setLiveActive(false);
      setLiveState('idle');
      setLiveTranscript(err?.message || 'Gemini Live failed to connect');
    }
  }, [
    liveActive,
    stopLiveCall,
    stopWakeListener,
    stopBargeIn,
    stopCommandCapture,
    aiName,
    requestPermission,
  ]);

  const toggleOrb = useCallback(() => {
    if (liveActive) {
      stopLiveCall();
      return;
    }
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
  }, [liveActive, stopLiveCall, speechState.isPlaying, phase, isLoading, stopCommandCapture, startCommandListening]);

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
      stopLiveCall();
    };
  }, [stopCommandCapture, stopWakeListener, stopBargeIn, stopLiveCall]);

  return {
    phase,
    orbState,
    liveTranscript,
    setLiveTranscript,
    micLevel: activeAudioLevel,
    freqBands: activeFreqBands,
    wakeEnabled,
    offlineWakeStatus,
    toggleWake,
    speechState,
    toggleOrb,
    liveActive,
    liveState,
    toggleLiveCall,
  };
}
