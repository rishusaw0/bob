// Global Always-On Voice Hook powering Full Mode, Tray/Minimized Background Wake, Mini Speaker Pill & Cortana Overlay
import { useState, useEffect, useRef, useCallback } from 'react';
import { playWakeChime, playDoneChime } from './earcon.js';
import { subscribeSpeech, stopSpeech } from './speech.js';
import { startVoiceCapture, startWakeWordListener } from './voiceCapture.js';
import {
  getWakeWordEnabled,
  setWakeWordEnabled as persistWakeEnabled,
  getWakeOpenMode,
} from './voiceRouter.js';

export function useVoiceEngine({ aiName, onSend, isLoading, autoListenSignal, onWakeOpen, enabled = true }) {
  const [phase, setPhase] = useState('idle'); // 'idle' | 'listening' | 'thinking'
  const [liveTranscript, setLiveTranscript] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [wakeEnabled, setWakeEnabled] = useState(() => getWakeWordEnabled());
  const [offlineWakeStatus, setOfflineWakeStatus] = useState({ available: null, running: false, culture: '' });
  const [speechState, setSpeechState] = useState({ isPlaying: false, detectedProfile: 'hinglish' });

  const captureRef = useRef(null);
  const wakeListenerRef = useRef(null);
  const phaseRef = useRef('idle');

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => subscribeSpeech(setSpeechState), []);

  useEffect(() => {
    const onWakeChanged = (ev) => {
      if (typeof ev?.detail === 'boolean') setWakeEnabled(ev.detail);
    };
    window.addEventListener('jeeva-wake-settings-changed', onWakeChanged);
    return () => window.removeEventListener('jeeva-wake-settings-changed', onWakeChanged);
  }, []);

  const orbState = isLoading
    ? 'thinking'
    : speechState.isPlaying
      ? 'speaking'
      : phase === 'listening'
        ? 'listening'
        : 'idle';

  const stopWakeListener = useCallback(() => {
    if (wakeListenerRef.current) {
      wakeListenerRef.current.stop();
      wakeListenerRef.current = null;
    }
    window.electronAPI?.offlineVoiceStop?.().catch?.(() => {});
  }, []);

  const stopCommandCapture = useCallback((submitNow = false) => {
    if (captureRef.current) {
      if (submitNow) captureRef.current.stop();
      else captureRef.current.cancel();
      captureRef.current = null;
    }
    setMicLevel(0);
  }, []);

  const submitVoiceCommand = useCallback(
    async (cmdText) => {
      const cleaned = (cmdText || '').trim();
      if (!cleaned) {
        setPhase('idle');
        return;
      }
      setLiveTranscript(cleaned);
      setPhase('thinking');
      playDoneChime();
      try {
        await onSend(cleaned, null, { fromVoice: true });
      } finally {
        setPhase('idle');
      }
    },
    [onSend]
  );

  const startCommandListening = useCallback(() => {
    stopSpeech();
    stopWakeListener();
    stopCommandCapture(false);

    setLiveTranscript('');
    setPhase('listening');
    playWakeChime();

    captureRef.current = startVoiceCapture({
      lang: 'hi-IN',
      autoStopOnSilence: true,
      silenceMs: 1150,
      onInterim: (txt) => setLiveTranscript(txt),
      onLevel: (lvl) => setMicLevel(lvl),
      onResult: (finalCmd) => {
        captureRef.current = null;
        setMicLevel(0);
        if (finalCmd && finalCmd.trim()) {
          submitVoiceCommand(finalCmd);
        } else {
          setPhase('idle');
        }
      },
      onError: (errMsg) => {
        captureRef.current = null;
        setMicLevel(0);
        setLiveTranscript(errMsg || 'Could not hear audio');
        setPhase('idle');
      },
    });
  }, [stopWakeListener, stopCommandCapture, submitVoiceCommand]);

  const handleWakeActivation = useCallback(
    async (inlineCmd) => {
      const targetMode = getWakeOpenMode();
      onWakeOpen?.(targetMode);
      try {
        await window.electronAPI?.wakeRestore?.(targetMode);
      } catch {}

      if (inlineCmd && inlineCmd.trim()) {
        playWakeChime();
        submitVoiceCommand(inlineCmd);
      } else {
        startCommandListening();
      }
    },
    [onWakeOpen, submitVoiceCommand, startCommandListening]
  );

  useEffect(() => {
    if (enabled && autoListenSignal > 0) {
      startCommandListening();
    }
  }, [enabled, autoListenSignal, startCommandListening]);

  // Persistent Always-On Wake Word Listener ("Hey <AiName>") across ALL window states (even minimized / tray!)
  useEffect(() => {
    if (!enabled || !wakeEnabled || orbState !== 'idle') {
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
        onWakeTriggered: (inlineCmd) => {
          wakeListenerRef.current = null;
          if (cancelled) return;
          handleWakeActivation(inlineCmd);
        },
      });
    };

    const timer = setTimeout(() => {
      if (cancelled || phaseRef.current !== 'idle') return;

      if (api?.offlineVoiceStart && api?.onOfflineVoiceEvent) {
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
              startFallbackWake();
            }
          } else if (ev.type === 'wake') {
            api.offlineVoiceStop?.().catch?.(() => {});
            handleWakeActivation(ev.command);
          }
        });
        api.offlineVoiceStart(aiName).catch(() => startFallbackWake());
      } else {
        startFallbackWake();
      }
    }, 650);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubOffline?.();
      stopWakeListener();
    };
  }, [enabled, aiName, wakeEnabled, orbState, handleWakeActivation, stopWakeListener]);

  useEffect(() => {
    return () => {
      stopCommandCapture(false);
      stopWakeListener();
    };
  }, [stopCommandCapture, stopWakeListener]);

  const toggleOrb = useCallback(() => {
    if (speechState.isPlaying) {
      stopSpeech();
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

  return {
    phase,
    orbState,
    liveTranscript,
    setLiveTranscript,
    micLevel,
    wakeEnabled,
    offlineWakeStatus,
    toggleWake,
    speechState,
    toggleOrb,
  };
}
