import {
  LuMic,
  LuVolume2,
  LuAudioLines,
  LuMaximize2,
  LuRadio,
  LuActivity,
  LuMinimize2,
} from 'react-icons/lu';
import { stopSpeech } from '../services/speech';
import { useVoiceEngine } from '../services/useVoiceEngine';

export default function SpeakerPill({
  aiName = 'Jeeva',
  onSend,
  isLoading,
  lastAssistantMessage,
  liveStats,
  voiceEngine: sharedVoice = null,
  onExpandToChat,
  onOpenCortana,
  autoListenSignal,
}) {
  const isElectron = Boolean(window.electronAPI);
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
    micLevel,
    wakeEnabled,
    offlineWakeStatus,
    toggleWake,
    toggleOrb,
  } = sharedVoice || localVoice;

  const displayCaption =
    orbState === 'listening'
      ? liveTranscript || 'Sun raha hoon... Boliye'
      : orbState === 'thinking'
      ? 'Executing command...'
      : orbState === 'speaking'
      ? lastAssistantMessage?.text || 'Speaking...'
      : liveTranscript
      ? lastAssistantMessage?.text || liveTranscript
      : wakeEnabled
      ? `Say "Hey ${aiName}"...`
      : `Tap speaker or click to open ${aiName}`;

  const orbColors =
    orbState === 'listening'
      ? 'bg-sky-500/20 border-sky-400 text-sky-300 shadow-[0_0_20px_rgba(56,189,248,0.45)]'
      : orbState === 'thinking'
      ? 'bg-amber-500/20 border-amber-400 text-amber-300'
      : orbState === 'speaking'
      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_20px_rgba(52,211,153,0.45)]'
      : 'bg-zinc-900 border-zinc-600 text-zinc-200 hover:border-emerald-400/70 hover:text-emerald-300';

  const statBadge = liveStats
    ? `${liveStats.cpuUsedPct !== null && liveStats.cpuUsedPct !== undefined ? `C:${liveStats.cpuUsedPct}% ` : ''}R:${liveStats.ramUsedPct}%`
    : '';

  const pillContent = (
    <div
      className={`flex items-center gap-2.5 bg-obsidian-surface/95 backdrop-blur-md border border-zinc-700/80 shadow-2xl select-none ${
        isElectron ? 'w-screen h-screen px-2.5 rounded-2xl' : 'w-[330px] p-2.5 rounded-2xl'
      }`}
    >
      {/* Left Interactive Speaker / Mic Orb */}
      <button
        type="button"
        onClick={toggleOrb}
        style={{
          WebkitAppRegion: 'no-drag',
          transform: orbState === 'listening' ? `scale(${1 + Math.min(0.14, micLevel * 0.2)})` : undefined,
        }}
        className={`relative w-12 h-12 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all cursor-pointer ${orbColors}`}
        title={
          orbState === 'speaking'
            ? 'Stop speaking'
            : orbState === 'listening'
            ? 'Send command now'
            : 'Tap to speak command'
        }
      >
        {orbState === 'speaking' ? (
          <LuAudioLines className="w-5 h-5 animate-pulse" />
        ) : orbState === 'thinking' ? (
          <LuActivity className="w-5 h-5 animate-spin" />
        ) : orbState === 'listening' ? (
          <LuMic className="w-5 h-5" />
        ) : (
          <LuVolume2 className="w-5 h-5" />
        )}
      </button>

      {/* Center Clickable Area — Click to Open Full Chat Interface */}
      <button
        type="button"
        onClick={() => {
          stopSpeech();
          onExpandToChat();
        }}
        style={{ WebkitAppRegion: 'no-drag' }}
        className="flex-1 min-w-0 text-left py-1 px-1.5 rounded-xl hover:bg-obsidian-elevated/80 transition-colors cursor-pointer"
        title="Click to open Full Interface"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono font-bold tracking-wider text-emerald-400 uppercase truncate">
            {aiName}
          </span>
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              orbState === 'listening'
                ? 'bg-sky-400 animate-ping'
                : orbState === 'speaking'
                ? 'bg-emerald-400 animate-pulse'
                : orbState === 'thinking'
                ? 'bg-amber-400 animate-pulse'
                : wakeEnabled
                ? 'bg-emerald-500/70'
                : 'bg-zinc-600'
            }`}
          />
          {statBadge ? (
            <span className="text-[9px] font-mono text-obsidian-muted ml-auto">{statBadge}</span>
          ) : (
            <span className="text-[10px] font-mono text-obsidian-muted ml-auto">Tap to open</span>
          )}
        </div>
        <p className="text-xs text-obsidian-text truncate mt-0.5 leading-snug">
          {displayCaption}
        </p>
      </button>

      {/* Compact Controls */}
      <div className="flex flex-col gap-1 flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' }}>
        <button
          type="button"
          onClick={toggleWake}
          className={`p-1.5 rounded-lg border transition-colors ${
            wakeEnabled
              ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
              : 'bg-obsidian-bg border-obsidian-border text-obsidian-muted hover:text-obsidian-text'
          }`}
          title={
            wakeEnabled
              ? `Wake Active ("Hey ${aiName}")${offlineWakeStatus?.available ? ' · Offline Windows SAPI' : ''}`
              : 'Wake Word Off'
          }
        >
          <LuRadio className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onExpandToChat}
          className="p-1.5 rounded-lg bg-obsidian-bg border border-obsidian-border text-obsidian-secondary hover:text-obsidian-text transition-colors"
          title="Open Full Interface"
        >
          <LuMaximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  if (isElectron) {
    return pillContent;
  }

  // Browser / Mobile ambient minimal screen (no full chat open until Speaker Pill clicked)
  return (
    <div className="min-h-screen bg-obsidian-bg/95 flex flex-col items-center justify-center p-6 select-none">
      <div className="mb-8 text-center space-y-2">
        <p className="text-xs font-mono uppercase tracking-widest text-emerald-400">
          {aiName} Ambient Speaker
        </p>
        <p className="text-xs text-obsidian-muted">
          {wakeEnabled
            ? `Boliye "Hey ${aiName}" + command, ya interface kholne ke liye pill par click karein`
            : 'Speaker dabakar bolein, ya pill par click karke chat kholein'}
        </p>
      </div>

      {pillContent}

      {onOpenCortana && (
        <button
          type="button"
          onClick={onOpenCortana}
          className="mt-6 inline-flex items-center gap-1.5 text-[11px] font-mono text-obsidian-muted hover:text-obsidian-secondary"
        >
          <LuMinimize2 className="w-3 h-3" />
          Switch to Voice Panel
        </button>
      )}
    </div>
  );
}
