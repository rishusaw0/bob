import {
  LuAppWindow,
  LuCamera,
  LuFileText,
  LuCpu,
  LuFolderOpen,
  LuClock,
  LuKey,
  LuArrowUpRight,
} from 'react-icons/lu';

export default function WelcomeScreen({ onSuggestionClick, isReady, onSetupClick }) {
  const capabilities = [
    {
      icon: LuAppWindow,
      title: 'Apps, Winget & UI Control',
      prompt: 'Installed software list dikhao aur VS Code kholo',
      meta: 'Software Engine',
    },
    {
      icon: LuCpu,
      title: 'CPU, Processes & Power Plan',
      prompt: 'PC ki deep diagnostics aur top RAM processes check karo',
      meta: 'Hardware Pro',
    },
    {
      icon: LuFolderOpen,
      title: 'Auto-Organize Files & Zips',
      prompt: 'Mere Downloads folder ko file types ke hisab se organize kar do',
      meta: 'File Automation',
    },
    {
      icon: LuCamera,
      title: 'Screen Vision, Mouse & Hotkeys',
      prompt: 'Screenshot le lo aur batao screen par kya chal raha hai',
      meta: 'Vision + Input',
    },
    {
      icon: LuClock,
      title: 'Reminders & Coding Mode',
      prompt: 'Coding mode activate karo aur 25 minute baad break reminder lagao',
      meta: 'PC Scheduler',
    },
    {
      icon: LuFileText,
      title: 'Clipboard Ring & PDF Reader',
      prompt: 'Recent clipboard history dikhao ya Desktop PDF padh kar sunao',
      meta: 'Clipboard + Docs',
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-2xl">
        {/* Clean Geometric Wordmark */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-obsidian-surface border border-obsidian-border text-[11px] font-mono text-obsidian-secondary mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            EXTREME WINDOWS PC WORKSTATION AI
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-obsidian-text mb-2">
            Good to see you. What should we execute?
          </h1>
          <p className="text-sm text-obsidian-secondary">
            Speak, type, drop a PDF, or issue a direct PC command in Hindi or English.
          </p>
        </div>

        {!isReady ? (
          <button
            onClick={onSetupClick}
            className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-lg bg-zinc-100 text-zinc-950 text-sm font-medium hover:bg-white transition-colors"
          >
            <LuKey className="w-4 h-4" />
            Configure Gemini API Key
          </button>
        ) : (
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
                  <p className="text-[11px] font-mono text-obsidian-muted">
                    {item.meta}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
