import { useState } from 'react';
import {
  LuPlus,
  LuSearch,
  LuTrash2,
  LuMessageSquare,
  LuSettings,
  LuTerminal,
  LuMonitor,
  LuCpu,
  LuClipboard,
  LuClock,
  LuFolderOpen,
  LuMic,
} from 'react-icons/lu';

export default function Sidebar({
  conversations,
  onSelect,
  onDelete,
  onNewChat,
  onOpenSettings,
  onOpenPcControl,
  onQuickPrompt,
  isReady,
  liveStats,
}) {
  const [search, setSearch] = useState('');
  const isElectron = !!window.electronAPI;

  const filtered = conversations.filter(c =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <aside className="w-64 bg-obsidian-surface border-r border-obsidian-border flex flex-col h-full flex-shrink-0 select-none">
      {/* Brand + New Thread */}
      <div className="p-3 border-b border-obsidian-border space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-zinc-100 text-zinc-950 flex items-center justify-center font-mono text-xs font-bold tracking-tighter">
              JV
            </div>
            <div className="leading-none">
              <span className="text-sm font-semibold tracking-tight text-obsidian-text block">
                JEEVA
              </span>
              <span className="text-[10px] font-mono text-obsidian-muted">
                {isElectron ? 'DESKTOP AGENT' : 'WEB CLIENT'}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-obsidian-elevated hover:bg-obsidian-hover border border-obsidian-border text-xs font-medium text-obsidian-text transition-colors"
        >
          <span className="flex items-center gap-2">
            <LuPlus className="w-3.5 h-3.5 text-obsidian-secondary" />
            New Thread
          </span>
          <kbd className="font-mono text-[10px] text-obsidian-muted">Ctrl+N</kbd>
        </button>

        {/* Search */}
        <div className="relative">
          <LuSearch className="w-3.5 h-3.5 text-obsidian-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search threads..."
            className="w-full bg-obsidian-bg border border-obsidian-border rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-obsidian-text placeholder:text-obsidian-muted focus:outline-none focus:border-zinc-600"
          />
        </div>
      </div>

      {/* Quick System Actions */}
      <div className="px-3 pt-3 pb-2 border-b border-obsidian-border">
        <div className="text-[10px] font-mono uppercase tracking-wider text-obsidian-muted px-1 mb-1.5">
          Quick Tools
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => onQuickPrompt('Screenshot le lo')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-obsidian-bg hover:bg-obsidian-elevated border border-obsidian-border text-[11px] text-obsidian-secondary hover:text-obsidian-text transition-colors"
          >
            <LuMonitor className="w-3 h-3 text-obsidian-muted" />
            Screenshot
          </button>
          <button
            onClick={() => onQuickPrompt('System ki info batao')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-obsidian-bg hover:bg-obsidian-elevated border border-obsidian-border text-[11px] text-obsidian-secondary hover:text-obsidian-text transition-colors"
          >
            <LuTerminal className="w-3 h-3 text-obsidian-muted" />
            Sys Info
          </button>
        </div>
      </div>

      {/* History List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <div className="text-[10px] font-mono uppercase tracking-wider text-obsidian-muted px-2 py-1">
          Recent Threads
        </div>

        {filtered.length === 0 ? (
          <div className="text-center text-obsidian-muted text-xs py-8 px-3">
            {conversations.length === 0 ? 'No saved threads yet' : 'No matching threads'}
          </div>
        ) : (
          filtered.map((conv) => (
            <div
              key={conv.id}
              className="group flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-obsidian-elevated cursor-pointer transition-colors"
            >
              <LuMessageSquare className="w-3.5 h-3.5 text-obsidian-muted flex-shrink-0" />
              <button
                onClick={() => onSelect(conv)}
                className="flex-1 text-left min-w-0"
              >
                <p className="text-xs font-medium text-obsidian-text truncate">{conv.title}</p>
                <p className="text-[10px] text-obsidian-muted">
                  {conv.date} · {conv.messages.length} msgs
                </p>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                className="p-1 rounded text-obsidian-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete Thread"
              >
                <LuTrash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Workstation Pro Telemetry & Quick Presets */}
      {isElectron && (
        <div className="px-3 py-2.5 border-t border-obsidian-border bg-obsidian-bg/40 space-y-2">
          {liveStats && (
            <div className="space-y-1 text-[10px] font-mono text-obsidian-muted">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-obsidian-secondary">
                  <LuCpu className="w-3 h-3 text-emerald-400" />
                  PC Load
                </span>
                <span>
                  {liveStats.cpuUsedPct !== null && liveStats.cpuUsedPct !== undefined ? `CPU ${liveStats.cpuUsedPct}% · ` : ''}
                  RAM {liveStats.ramUsedPct}%
                </span>
              </div>
              <div className="w-full h-1 bg-obsidian-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500/80 transition-all duration-300"
                  style={{ width: `${Math.min(100, Number(liveStats.ramUsedPct) || 0)}%` }}
                />
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <button
                  type="button"
                  onClick={() => onOpenPcControl?.('clipboard')}
                  className="inline-flex items-center gap-1 hover:text-obsidian-text transition-colors"
                  title="Open 20-Item Clipboard Manager (Zero API Cost)"
                >
                  <LuClipboard className="w-2.5 h-2.5" /> {liveStats.clipboardCount ?? 0} clips
                </button>
                <button
                  type="button"
                  onClick={() => onOpenPcControl?.('scheduler')}
                  className="inline-flex items-center gap-1 hover:text-obsidian-text transition-colors"
                  title="Open Timers & Presets (Zero API Cost)"
                >
                  <LuClock className="w-2.5 h-2.5" /> {liveStats.scheduledCount ?? 0} timers
                </button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-1">
            <button
              onClick={() => onQuickPrompt?.('Coding mode activate karo: high performance power plan, VS Code aur PC overview')}
              className="flex items-center gap-1 px-2 py-1 rounded bg-obsidian-elevated/70 hover:bg-obsidian-elevated border border-obsidian-border text-[10px] text-obsidian-secondary hover:text-obsidian-text transition-colors"
              title="Launch Coding Workstation Preset"
            >
              <LuTerminal className="w-3 h-3 text-emerald-400 flex-shrink-0" />
              <span className="truncate">Coding</span>
            </button>
            <button
              onClick={() => onOpenPcControl?.('processes')}
              className="flex items-center gap-1 px-2 py-1 rounded bg-obsidian-elevated/70 hover:bg-obsidian-elevated border border-obsidian-border text-[10px] text-obsidian-secondary hover:text-obsidian-text transition-colors"
              title="Zero-API Process Manager & Ports"
            >
              <LuMonitor className="w-3 h-3 text-sky-400 flex-shrink-0" />
              <span className="truncate">Processes</span>
            </button>
            <button
              onClick={() => onQuickPrompt?.('Mere Downloads folder ko file types ke hisab se organize kar do')}
              className="flex items-center gap-1 px-2 py-1 rounded bg-obsidian-elevated/70 hover:bg-obsidian-elevated border border-obsidian-border text-[10px] text-obsidian-secondary hover:text-obsidian-text transition-colors"
              title="Organize Downloads by file type"
            >
              <LuFolderOpen className="w-3 h-3 text-amber-400 flex-shrink-0" />
              <span className="truncate">Sort DL</span>
            </button>
            <button
              onClick={() => onOpenPcControl?.('clipboard')}
              className="flex items-center gap-1 px-2 py-1 rounded bg-obsidian-elevated/70 hover:bg-obsidian-elevated border border-obsidian-border text-[10px] text-obsidian-secondary hover:text-obsidian-text transition-colors"
              title="Zero-API Clipboard History (20 items)"
            >
              <LuClipboard className="w-3 h-3 text-violet-400 flex-shrink-0" />
              <span className="truncate">Clipboard</span>
            </button>
            <button
              onClick={() => onOpenPcControl?.('voice_history')}
              className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-1 rounded bg-obsidian-elevated/70 hover:bg-obsidian-elevated border border-obsidian-border text-[10px] text-emerald-300 hover:text-emerald-200 transition-colors"
              title="View all voice commands, replies & executed actions"
            >
              <LuMic className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">Voice Command History</span>
            </button>
          </div>
        </div>
      )}

      {/* Footer Status */}
      <div className="p-3 border-t border-obsidian-border flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isReady ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <div className="min-w-0">
            <p className="text-xs font-medium text-obsidian-text truncate">
              {liveStats?.username || 'Personal Workspace'}
            </p>
            <p className="text-[10px] font-mono text-obsidian-muted">
              {isReady ? 'API Connected' : 'Key Required'}
            </p>
          </div>
        </div>
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-md text-obsidian-muted hover:text-obsidian-text hover:bg-obsidian-elevated transition-colors"
          title="Settings"
        >
          <LuSettings className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
