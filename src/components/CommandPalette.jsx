import { useState, useEffect, useRef } from 'react';
import {
  LuSearch,
  LuCamera,
  LuCpu,
  LuActivity,
  LuFolderOpen,
  LuClipboard,
  LuClock,
  LuPlus,
  LuSettings,
  LuVolume2,
  LuVolumeX,
  LuFileText,
  LuTerminal,
  LuMessageSquare,
  LuDownload,
  LuTrash2,
} from 'react-icons/lu';

export default function CommandPalette({
  isOpen,
  onClose,
  onRunPrompt,
  onNewChat,
  onOpenSettings,
  onOpenPcControl,
  onToggleTTS,
  onExportChat,
  onClearHistory,
  conversations,
  onSelectConv,
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const actions = [
    { id: 'new', label: 'New Thread', hint: 'Ctrl+N', icon: LuPlus, run: () => onNewChat() },
    { id: 'pcc', label: 'Open PC Control Center (Clipboard, Procs, Timers)', hint: 'Ctrl+Shift+M', icon: LuActivity, run: () => onOpenPcControl?.('clipboard') },
    { id: 'diag', label: 'PC Deep Diagnostics (CPU, GPU, Disks)', hint: 'PC Pro', icon: LuCpu, run: () => onRunPrompt('PC ki deep CPU, RAM, GPU aur disk diagnostics check karo') },
    { id: 'procs', label: 'Top Memory & CPU Processes', hint: 'PC Pro', icon: LuActivity, run: () => onRunPrompt('Abhi sabse zyada RAM aur CPU kaun se processes use kar rahe hain?') },
    { id: 'organize', label: 'Auto-Organize Downloads Folder', hint: 'File Pro', icon: LuFolderOpen, run: () => onRunPrompt('Mere Downloads folder ko file type ke hisab se organize kar do') },
    { id: 'clip', label: 'Show Clipboard History (Last 20)', hint: 'Clipboard', icon: LuClipboard, run: () => onRunPrompt('Meri recent clipboard history dikhao') },
    { id: 'coding', label: 'Activate Coding Workstation Mode', hint: 'Macro', icon: LuTerminal, run: () => onRunPrompt('Coding mode activate karo: high performance power plan, VS Code aur system overview') },
    { id: 'remind', label: 'Set 15-Min Break Reminder', hint: 'Scheduler', icon: LuClock, run: () => onRunPrompt('15 minute baad pani peene aur break lene ka reminder set karo') },
    { id: 'ss', label: 'Capture Screen & Analyze UI', hint: 'Vision', icon: LuCamera, run: () => onRunPrompt('Screenshot le lo aur batao screen par kya dikh raha hai') },
    { id: 'apps', label: 'List Running Applications', hint: 'PC Tool', icon: LuTerminal, run: () => onRunPrompt('Abhi kaun-kaun se apps chal rahe hain?') },
    { id: 'files', label: 'Browse Desktop Files', hint: 'PC Tool', icon: LuFolderOpen, run: () => onRunPrompt('Desktop par kaunsi files hain?') },
    { id: 'pdf', label: 'Find & Read Desktop PDF Aloud', hint: 'PDF + Audio', icon: LuFileText, run: () => onRunPrompt('Desktop par koi PDF file hai toh use read karke sunao') },
    { id: 'vol_down', label: 'Decrease Volume', hint: 'Audio', icon: LuVolumeX, run: () => onRunPrompt('System volume kam karo') },
    { id: 'tts', label: 'Toggle Auto Voice Response', hint: 'Audio', icon: LuVolume2, run: () => onToggleTTS() },
    { id: 'export', label: 'Export Current Thread as Markdown', hint: 'Export', icon: LuDownload, run: () => onExportChat() },
    { id: 'settings', label: 'Open Preferences', hint: 'Ctrl+,', icon: LuSettings, run: () => onOpenSettings() },
    { id: 'clear', label: 'Clear All Saved Threads', hint: 'History', icon: LuTrash2, run: () => onClearHistory() },
  ];

  const convItems = conversations.slice(0, 6).map(c => ({
    id: `conv-${c.id}`,
    label: c.title,
    hint: c.date,
    icon: LuMessageSquare,
    run: () => onSelectConv(c),
  }));

  const allItems = [...actions, ...convItems].filter(item =>
    item.label.toLowerCase().includes(query.toLowerCase())
  );

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => (allItems.length ? (i + 1) % allItems.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => (allItems.length ? (i - 1 + allItems.length) % allItems.length : 0));
    } else if (e.key === 'Enter' && allItems[selectedIndex]) {
      e.preventDefault();
      allItems[selectedIndex].run();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] bg-black/65 backdrop-blur-[2px] animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl mx-4 bg-obsidian-surface border border-obsidian-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-obsidian-border">
          <LuSearch className="w-4 h-4 text-obsidian-muted flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search threads..."
            className="w-full bg-transparent text-sm text-obsidian-text placeholder:text-obsidian-muted focus:outline-none"
          />
          <kbd className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-obsidian-elevated border border-obsidian-border text-obsidian-muted">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-1.5">
          {allItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-obsidian-muted">
              No matching commands or threads
            </div>
          ) : (
            allItems.map((item, idx) => {
              const Icon = item.icon;
              const active = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => { item.run(); onClose(); }}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                    active ? 'bg-obsidian-elevated text-obsidian-text' : 'text-obsidian-secondary hover:bg-obsidian-elevated/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className="w-4 h-4 text-obsidian-muted flex-shrink-0" />
                    <span className="text-sm truncate">{item.label}</span>
                  </div>
                  <span className="text-[11px] font-mono text-obsidian-muted ml-3 flex-shrink-0">
                    {item.hint}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
