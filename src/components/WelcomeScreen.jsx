import {
  LuAppWindow,
  LuPlay,
  LuBell,
  LuCpu,
  LuPencil,
  LuMonitor,
  LuKey,
  LuArrowUpRight,
} from 'react-icons/lu';
import CortanaOrb from './CortanaOrb';
import { getAiName, getWakeTriggerPhrase } from '../services/voiceRouter';

export default function WelcomeScreen({
  onSuggestionClick,
  isReady,
  onSetupClick,
  voiceEngine,
}) {
  const aiName = getAiName();
  const wakePhrase = getWakeTriggerPhrase();
  const orbState = voiceEngine?.orbState || 'idle';
  const liveTranscript = voiceEngine?.transcript || '';

  const statusCopy =
    orbState === 'listening'
      ? liveTranscript || 'Sun raha hoon... Boliye'
      : orbState === 'thinking'
      ? 'Action execute kar raha hoon...'
      : orbState === 'speaking'
      ? 'Bol raha hoon...'
      : `Tap Orb ya bolo "${wakePhrase}"`;

  const capabilities = [
    {
      icon: LuBell,
      title: 'Set Smart Reminder',
      prompt: '10 minute baad paani peene ka reminder lagao',
      meta: 'Voice + Notch alert on time',
    },
    {
      icon: LuAppWindow,
      title: 'Open & Control Apps',
      prompt: 'Chrome kholo aur YouTube open karo',
      meta: 'Launch, close, switch, shortcuts',
    },
    {
      icon: LuPlay,
      title: 'Play Music or Video',
      prompt: 'YouTube par Kesariya play karo',
      meta: 'Instant voice playback',
    },
    {
      icon: LuPencil,
      title: 'Type Anywhere by Voice',
      prompt: 'Notepad mein Hello, this is a quick note type karo',
      meta: 'Dictate into any Windows app',
    },
    {
      icon: LuMonitor,
      title: 'Read Screen & Click',
      prompt: 'Screen padh kar sunao aur buttons batao',
      meta: 'See & act on active window',
    },
    {
      icon: LuCpu,
      title: 'PC Health & Controls',
      prompt: 'Battery aur PC memory status check karo',
      meta: 'Volume, brightness, Wi-Fi, clean',
    },
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center px-6 py-6 bg-jeeva-grid relative">
      <div className="w-full max-w-2xl my-auto">
        <div className="flex flex-col items-center text-center mb-7">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full cyber-pill text-xs text-sky-200/90 mb-5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.95)] animate-pulse" />
            <span>{aiName} Voice PC Agent · Always Ready</span>
          </div>

          <div className="mb-4">
            <CortanaOrb
              state={orbState}
              audioLevel={voiceEngine?.audioLevel || 0}
              freqBands={voiceEngine?.freqBands || null}
              onClick={() => voiceEngine?.toggleMic?.()}
            />
          </div>

          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gradient-futuristic mb-1.5">
            {statusCopy}
          </h1>
          <p className="text-xs sm:text-sm text-obsidian-secondary max-w-md leading-relaxed">
            Sawaal pucho, PC commands chalao, ya reminder set karo — Hindi aur English dono me.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {capabilities.map((item, idx) => {
            const Icon = item.icon;
            return (
              <button
                key={idx}
                onClick={() => onSuggestionClick(item.prompt)}
                className="group text-left p-3.5 rounded-xl cyber-card"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-400/20 flex items-center justify-center text-sky-300 group-hover:text-emerald-300 group-hover:border-sky-400/50 group-hover:shadow-[0_0_12px_rgba(56,189,248,0.25)] transition-all">
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <LuArrowUpRight className="w-3.5 h-3.5 text-obsidian-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-[13px] font-medium text-obsidian-text leading-snug mb-1">
                  {item.title}
                </p>
                <p className="text-[11px] text-obsidian-muted">
                  {item.meta}
                </p>
              </button>
            );
          })}
        </div>

        {!isReady && (
          <div className="mt-5 flex items-center justify-between gap-3 p-3.5 rounded-xl glass-panel border border-sky-500/20">
            <p className="text-xs text-obsidian-secondary">
              PC controls, reminders aur memory offline bhi kaam karte hain. Voice answers ke liye Gemini connect karo.
            </p>
            <button
              onClick={onSetupClick}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-400 to-sky-400 text-zinc-950 text-xs font-semibold hover:brightness-110 shadow-[0_0_16px_rgba(56,189,248,0.28)] transition-all whitespace-nowrap"
            >
              <LuKey className="w-3.5 h-3.5" />
              Connect Gemini
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
