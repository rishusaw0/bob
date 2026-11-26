import { useState } from 'react';
import {
  LuMaximize2,
  LuMinus,
  LuX,
  LuRadio,
  LuArrowUp,
  LuSquare,
  LuWrench,
  LuSettings,
  LuSmartphone,
  LuVolume2,
  LuPhone,
  LuPhoneOff,
} from 'react-icons/lu';
import CortanaOrb from './CortanaOrb';
import { stopSpeech, VOICE_PROFILES } from '../services/speech';
import { useVoiceEngine } from '../services/useVoiceEngine';

export default function CortanaView({
  aiName = 'Jeeva',
  onSend,
  isLoading,
  lastAssistantMessage,
  voiceEngine: sharedVoice = null,
  onExpandToChat,
  onSwitchSpeaker,
  onOpenSettings,
  onOpenMobileModal,
  voiceMode,
  onVoiceModeChange,
  autoListenSignal,
}) {
  const [textInput, setTextInput] = useState('');
  const localVoice = useVoiceEngine({
    aiName,
    onSend,
    isLoading,
    autoListenSignal,
    enabled: !sharedVoice,
  });
  const {
    orbState,
    liveTranscript,
    setLiveTranscript,
    micLevel,
    freqBands,
    wakeEnabled,
    toggleWake,
    speechState,
    toggleOrb,
    liveActive,
    liveState,
    toggleLiveCall,
  } = sharedVoice || localVoice;

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (!textInput.trim() || isLoading) return;
    const cmd = textInput.trim();
    setTextInput('');
    setLiveTranscript(cmd);
    onSend(cmd, null, { fromVoice: true });
  };

  const statusText = liveActive
    ? liveState === 'connecting'
      ? 'Connecting Gemini Live Call...'
      : liveState === 'speaking'
      ? 'Gemini Live Speaking...'
      : liveState === 'thinking'
      ? 'Running PC Tool...'
      : 'Gemini Live Connected — Speak freely'
    : orbState === 'listening'
    ? 'Listening...'
    : orbState === 'thinking'
    ? 'Executing...'
    : orbState === 'speaking'
    ? `Speaking (${VOICE_PROFILES[speechState.detectedProfile]?.shortLabel || 'Auto'})...`
    : wakeEnabled
    ? `Say "Hey ${aiName}" or tap orb`
    : 'Tap orb or press Alt+Space';

  return (
    <div className="h-screen flex flex-col bg-obsidian-bg text-obsidian-text overflow-hidden select-none border border-obsidian-border">
      {/* Compact Frameless Top Bar */}
      <header className="title-bar h-10 flex items-center justify-between px-3 bg-obsidian-surface border-b border-obsidian-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-zinc-100 text-zinc-950 flex items-center justify-center font-mono text-[10px] font-bold">
            JV
          </div>
          <span className="text-xs font-semibold tracking-tight text-obsidian-text uppercase">
            {aiName} VOICE
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={toggleLiveCall}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors ${
              liveActive
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                : 'text-obsidian-muted hover:text-emerald-300 hover:bg-obsidian-elevated'
            }`}
            title="Toggle Real-Time Gemini Live Audio Call"
          >
            {liveActive ? <LuPhoneOff className="w-3 h-3" /> : <LuPhone className="w-3 h-3" />}
            {liveActive ? 'End Live' : 'Live Call'}
          </button>

          <button
            onClick={toggleWake}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors ${
              wakeEnabled
                ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                : 'text-obsidian-muted hover:text-obsidian-text hover:bg-obsidian-elevated'
            }`}
            title={`Toggle "Hey ${aiName}" Wake-Word Listener`}
          >
            <LuRadio className="w-3 h-3" />
            {wakeEnabled ? `Hey ${aiName}` : 'Wake OFF'}
          </button>

          {onSwitchSpeaker && (
            <button
              onClick={onSwitchSpeaker}
              className="p-1.5 rounded text-obsidian-secondary hover:text-emerald-300 hover:bg-obsidian-elevated transition-colors"
              title="Minimize to Floating Speaker Pill"
            >
              <LuVolume2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={onExpandToChat}
            className="p-1.5 rounded text-obsidian-secondary hover:text-obsidian-text hover:bg-obsidian-elevated transition-colors"
            title="Expand to Full Chat Window"
          >
            <LuMaximize2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onOpenMobileModal}
            className="p-1.5 rounded text-obsidian-secondary hover:text-obsidian-text hover:bg-obsidian-elevated transition-colors"
            title="Connect Phone"
          >
            <LuSmartphone className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onOpenSettings}
            className="p-1.5 rounded text-obsidian-secondary hover:text-obsidian-text hover:bg-obsidian-elevated transition-colors"
            title="Preferences"
          >
            <LuSettings className="w-3.5 h-3.5" />
          </button>

          {window.electronAPI && (
            <>
              <button
                onClick={() => window.electronAPI.minimize()}
                className="p-1.5 rounded text-obsidian-muted hover:text-obsidian-text hover:bg-obsidian-elevated"
                title="Minimize"
              >
                <LuMinus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => window.electronAPI.close()}
                className="p-1.5 rounded text-obsidian-muted hover:text-white hover:bg-red-600/90"
                title="Close"
              >
                <LuX className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </header>

      {/* Center Interactive Voice Canvas */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col items-center justify-between">
        <div className="flex flex-col items-center text-center mt-2">
          <CortanaOrb
            state={orbState}
            audioLevel={micLevel}
            freqBands={freqBands}
            liveActive={liveActive}
            onClick={toggleOrb}
          />
          <p className="text-xs font-mono text-obsidian-secondary mt-2">{statusText}</p>
        </div>

        {/* Live Transcript + Response Card */}
        <div className="w-full space-y-2.5 my-3">
          {liveTranscript && (
            <div className="px-3 py-2 rounded-lg bg-obsidian-surface border border-obsidian-border text-xs text-obsidian-text">
              <span className="text-[10px] font-mono uppercase text-obsidian-muted block mb-0.5">
                You said
              </span>
              <p className="leading-relaxed">{liveTranscript}</p>
            </div>
          )}

          {lastAssistantMessage && (
            <div className="px-3 py-2.5 rounded-lg bg-obsidian-elevated/80 border border-obsidian-border text-xs text-zinc-200 max-h-40 overflow-y-auto">
              {lastAssistantMessage.tools?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {lastAssistantMessage.tools.map((t, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-obsidian-bg border border-obsidian-border text-[10px] font-mono text-emerald-400"
                    >
                      <LuWrench className="w-2.5 h-2.5" />
                      {t.name}
                    </span>
                  ))}
                </div>
              )}
              <p className="leading-relaxed whitespace-pre-wrap">{lastAssistantMessage.text}</p>
              {lastAssistantMessage.image && (
                <img
                  src={lastAssistantMessage.image}
                  alt="Capture"
                  className="mt-2 rounded border border-obsidian-border max-h-24 object-contain"
                />
              )}
            </div>
          )}
        </div>

        {/* Quick Voice/Click Shortcuts */}
        <div className="w-full grid grid-cols-2 gap-1.5">
          {[
            { label: 'Volume 30%', cmd: 'Volume ko 30 percent par set karo' },
            { label: 'Brightness 60%', cmd: 'Brightness 60 percent karo' },
            { label: 'Play / Pause', cmd: 'Media play ya pause karo' },
            { label: 'Screenshot', cmd: 'Screenshot le lo' },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => {
                setLiveTranscript(item.cmd);
                onSend(item.cmd, null, { fromVoice: true });
              }}
              className="px-2.5 py-1.5 rounded-lg bg-obsidian-surface hover:bg-obsidian-elevated border border-obsidian-border text-[11px] text-obsidian-secondary hover:text-obsidian-text transition-colors text-left truncate"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom Compact Command Bar */}
      <form
        onSubmit={handleTextSubmit}
        className="p-2.5 border-t border-obsidian-border bg-obsidian-surface flex items-center gap-1.5"
      >
        <select
          value={voiceMode}
          onChange={(e) => onVoiceModeChange(e.target.value)}
          className="bg-obsidian-bg border border-obsidian-border rounded-lg px-2 py-1.5 text-[10px] font-mono text-obsidian-secondary focus:outline-none"
          title="Voice Language Profile"
        >
          <option value="auto">Auto</option>
          <option value="english">EN</option>
          <option value="hindi">HI</option>
          <option value="hinglish">Hinglish</option>
        </select>

        <input
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          placeholder={`Ask ${aiName} or command...`}
          className="flex-1 bg-obsidian-bg border border-obsidian-border rounded-lg px-2.5 py-1.5 text-xs text-obsidian-text placeholder:text-obsidian-muted focus:outline-none focus:border-zinc-600"
        />

        {speechState.isPlaying ? (
          <button
            type="button"
            onClick={stopSpeech}
            className="p-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300"
            title="Stop Speaking"
          >
            <LuSquare className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!textInput.trim() || isLoading}
            className="p-1.5 rounded-lg bg-zinc-100 text-zinc-950 disabled:opacity-40"
            title="Send"
          >
            <LuArrowUp className="w-3.5 h-3.5" />
          </button>
        )}
      </form>
    </div>
  );
}
