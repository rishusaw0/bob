import {
  LuAppWindow,
  LuPlay,
  LuFileText,
  LuCpu,
  LuPencil,
  LuMonitor,
  LuKey,
  LuArrowUpRight,
} from 'react-icons/lu';
import { getAiName, getWakeTriggerPhrase } from '../services/voiceRouter';

export default function WelcomeScreen({ onSuggestionClick, isReady, onSetupClick }) {
  const aiName = getAiName();
  const wakePhrase = getWakeTriggerPhrase();

  const capabilities = [
    {
      icon: LuPlay,
      title: 'Play Any Song or Video',
      prompt: 'YouTube par Kesariya play karo',
      meta: 'Try: "Play [video name]"',
    },
    {
      icon: LuPencil,
      title: 'Type Anywhere in Any App',
      prompt: 'Notepad mein Hello, this is a quick note type karo',
      meta: 'Try: "Notepad mein ... likho"',
    },
    {
      icon: LuAppWindow,
      title: 'Open & Control Any App',
      prompt: 'Chrome kholo aur YouTube open karo',
      meta: 'Launch, close, scroll, shortcuts',
    },
    {
      icon: LuMonitor,
      title: 'Read Screen & Click Buttons',
      prompt: 'Screen padh kar sunao aur buttons batao',
      meta: 'Works 100% offline on PC',
    },
    {
      icon: LuCpu,
      title: 'Battery, Speed & Storage',
      prompt: 'Battery aur PC memory status check karo',
      meta: 'Volume, brightness, Wi-Fi, health',
    },
    {
      icon: LuFileText,
      title: 'Read & Summarize PDFs',
      prompt: 'Kal maine kya pucha tha?',
      meta: 'Read full or short summary + memory',
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-7">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-obsidian-surface border border-obsidian-border text-xs text-obsidian-secondary mb-4">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>{aiName} Voice Assistant · Say &quot;{wakePhrase}&quot;</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-obsidian-text mb-2">
            Hi! How can {aiName} help you today?
          </h1>
          <p className="text-sm text-obsidian-secondary leading-relaxed">
            Speak naturally in Hindi or English — open apps, play any video, type anywhere, or drop a PDF.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {capabilities.map((item, idx) => {
            const Icon = item.icon;
            return (
              <button
                key={idx}
                onClick={() => onSuggestionClick(item.prompt)}
                className="group text-left p-3.5 rounded-xl bg-obsidian-surface hover:bg-obsidian-elevated border border-obsidian-border hover:border-zinc-700 transition-all"
              >
                <div className="flex items-center justify-between mb-2.5">
                  <div className="w-7 h-7 rounded-md bg-obsidian-bg border border-obsidian-border flex items-center justify-center text-obsidian-secondary group-hover:text-obsidian-text transition-colors">
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
          <div className="mt-5 flex items-center justify-between gap-3 p-3 rounded-xl bg-obsidian-surface border border-obsidian-border">
            <p className="text-xs text-obsidian-secondary">
              Offline Voice, Apps, Typing, Video Play &amp; PDF Reader work right now. Add Cloud AI anytime for complex answers.
            </p>
            <button
              onClick={onSetupClick}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-medium hover:bg-white transition-colors whitespace-nowrap"
            >
              <LuKey className="w-3.5 h-3.5" />
              Setup Cloud AI
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
