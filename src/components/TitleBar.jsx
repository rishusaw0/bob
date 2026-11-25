import {
  LuPanelLeft,
  LuPlus,
  LuSettings,
  LuCommand,
  LuMinus,
  LuSquare,
  LuX,
  LuCpu,
  LuSmartphone,
  LuAudioLines,
  LuDownload,
  LuVolume2,
  LuRadio,
} from 'react-icons/lu';

export default function TitleBar({
  aiName = 'Jeeva',
  onMenuClick,
  onSettingsClick,
  onNewChat,
  onOpenPalette,
  onOpenMobileModal,
  onOpenPcControl,
  onSwitchCortana,
  onSwitchSpeaker,
  wakeEnabled = false,
  orbState = 'idle',
  onToggleWake,
  canInstallPWA,
  onInstallPWA,
  model,
  onModelChange,
  liveStats,
}) {
  const isElectron = !!window.electronAPI;

  return (
    <header className="title-bar h-11 flex items-center justify-between px-3 bg-obsidian-surface border-b border-obsidian-border flex-shrink-0 select-none">
      {/* Left: Sidebar Toggle + Model Selector */}
      <div className="flex items-center gap-2">
        <button
          onClick={onMenuClick}
          className="p-1.5 rounded-md text-obsidian-secondary hover:text-obsidian-text hover:bg-obsidian-elevated transition-colors"
          title="Toggle Sidebar"
        >
          <LuPanelLeft className="w-4 h-4" />
        </button>

        <div className="h-4 w-px bg-obsidian-border" />

        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="bg-transparent hover:bg-obsidian-elevated text-xs font-medium text-obsidian-text px-2 py-1 rounded-md border border-transparent hover:border-obsidian-border focus:outline-none cursor-pointer transition-colors"
          title="Switch Active Model"
        >
          <option value="gemini-3.5-flash-lite" className="bg-obsidian-surface text-obsidian-text">
            Gemini 3.5 Flash-Lite
          </option>
          <option value="gemini-4-hydrogen" className="bg-obsidian-surface text-obsidian-text">
            Gemini 4 Hydrogen
          </option>
          <option value="gemini-4-neon" className="bg-obsidian-surface text-obsidian-text">
            Gemini 4 Neon
          </option>
        </select>
      </div>

      {/* Center: Command Palette Trigger */}
      <button
        onClick={onOpenPalette}
        className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-md bg-obsidian-bg border border-obsidian-border text-xs text-obsidian-muted hover:text-obsidian-secondary hover:border-zinc-700 transition-colors min-w-[210px] justify-between"
        title="Command Palette (Ctrl+K)"
      >
        <span className="flex items-center gap-1.5">
          <LuCommand className="w-3.5 h-3.5" />
          <span>Quick commands...</span>
        </span>
        <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-obsidian-elevated text-obsidian-muted">
          Ctrl+K
        </kbd>
      </button>

      {/* Right: Telemetry + Actions + Window Controls */}
      <div className="flex items-center gap-1">
        {liveStats && (
          <button
            type="button"
            onClick={() => onOpenPcControl?.('system')}
            className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md bg-obsidian-bg hover:bg-obsidian-elevated border border-obsidian-border text-[11px] font-mono text-obsidian-secondary hover:text-obsidian-text mr-1 transition-colors cursor-pointer"
            title={`Open Zero-API PC Control Center (Ctrl+Shift+M) · ${liveStats.hostname} · RAM ${liveStats.ramFreeGb} GB free`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <LuCpu className="w-3 h-3 text-obsidian-muted" />
            {liveStats.cpuUsedPct !== null && liveStats.cpuUsedPct !== undefined && (
              <span>CPU {liveStats.cpuUsedPct}% ·</span>
            )}
            <span>RAM {liveStats.ramUsedPct}%</span>
            {liveStats.diskUsedPct !== undefined && (
              <span className="hidden lg:inline">· {liveStats.diskDrive || 'C:'} {100 - liveStats.diskUsedPct}%</span>
            )}
          </button>
        )}

        <button
          onClick={onToggleWake}
          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-mono transition-colors mr-1 ${
            orbState === 'listening'
              ? 'bg-sky-500/20 border-sky-400 text-sky-300 animate-pulse'
              : wakeEnabled
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                : 'bg-obsidian-bg border-obsidian-border text-obsidian-muted hover:text-obsidian-text'
          }`}
          title={
            wakeEnabled
              ? `Always-On Voice Wake Active — Say "Hey ${aiName}" from across the room (Even minimized/tray)`
              : 'Voice Wake Off — Click to enable "Hey ' + aiName + '"'
          }
        >
          <LuRadio className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">
            {orbState === 'listening' ? 'Listening...' : wakeEnabled ? `Hey ${aiName}` : 'Wake Off'}
          </span>
        </button>

        <button
          onClick={onSwitchSpeaker}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-obsidian-bg hover:bg-obsidian-elevated border border-obsidian-border text-[11px] font-mono text-obsidian-secondary hover:text-emerald-300 transition-colors mr-1"
          title={`Floating Speaker Mode — Say "Hey ${aiName}" (Click pill anytime to reopen interface)`}
        >
          <LuVolume2 className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden lg:inline">Speaker</span>
        </button>

        <button
          onClick={onSwitchCortana}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-obsidian-bg hover:bg-obsidian-elevated border border-obsidian-border text-[11px] font-mono text-obsidian-secondary hover:text-sky-300 transition-colors mr-1"
          title="Switch to Voice Panel (Alt+Space)"
        >
          <LuAudioLines className="w-3.5 h-3.5 text-sky-400" />
          <span className="hidden xl:inline">Voice Panel</span>
        </button>

        <button
          onClick={onNewChat}
          className="p-1.5 rounded-md text-obsidian-secondary hover:text-obsidian-text hover:bg-obsidian-elevated transition-colors"
          title="New Thread (Ctrl+N)"
        >
          <LuPlus className="w-4 h-4" />
        </button>

        {!isElectron && canInstallPWA && (
          <button
            onClick={onInstallPWA}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-[11px] font-medium text-emerald-300 transition-colors mr-1"
            title="Install JEEVA AI App on this device"
          >
            <LuDownload className="w-3 h-3" />
            <span className="hidden sm:inline">Install App</span>
          </button>
        )}

        <button
          onClick={onOpenMobileModal}
          className="p-1.5 rounded-md text-obsidian-secondary hover:text-obsidian-text hover:bg-obsidian-elevated transition-colors"
          title={isElectron ? 'Remote & Render Link' : 'Connect to PC'}
        >
          <LuSmartphone className="w-4 h-4" />
        </button>

        <button
          onClick={onSettingsClick}
          className="p-1.5 rounded-md text-obsidian-secondary hover:text-obsidian-text hover:bg-obsidian-elevated transition-colors"
          title="Preferences"
        >
          <LuSettings className="w-4 h-4" />
        </button>

        {isElectron && (
          <div className="flex items-center gap-0.5 ml-1.5 pl-2 border-l border-obsidian-border">
            <button
              onClick={() => window.electronAPI.minimize()}
              className="w-7 h-7 rounded-md text-obsidian-muted hover:text-obsidian-text hover:bg-obsidian-elevated flex items-center justify-center transition-colors"
              title="Minimize"
            >
              <LuMinus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => window.electronAPI.maximize()}
              className="w-7 h-7 rounded-md text-obsidian-muted hover:text-obsidian-text hover:bg-obsidian-elevated flex items-center justify-center transition-colors"
              title="Maximize"
            >
              <LuSquare className="w-3 h-3" />
            </button>
            <button
              onClick={() => window.electronAPI.close()}
              className="w-7 h-7 rounded-md text-obsidian-muted hover:text-white hover:bg-red-600/90 flex items-center justify-center transition-colors"
              title="Close"
            >
              <LuX className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
