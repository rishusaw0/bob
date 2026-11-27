import { useState, useEffect, useCallback } from 'react';
import {
  LuX,
  LuClipboard,
  LuActivity,
  LuClock,
  LuCpu,
  LuRefreshCw,
  LuCopy,
  LuTrash2,
  LuZap,
  LuPlay,
  LuTerminal,
  LuFolderOpen,
  LuVolumeX,
  LuMonitor,
  LuShieldAlert,
  LuDownload,
  LuDatabase,
  LuWorkflow,
} from 'react-icons/lu';
import { getSystemAPI } from '../services/bridge';
import { getAuditLog } from '../services/permissions';
import { rememberUserMemory, listAllMemories, forgetMemoryItem } from '../services/memoryRag';
import { queryEpisodicTimeline, forgetEpisodicDay } from '../services/episodicMemory';
import { toDateKey } from '../services/dateQueryParser';
import { getBrainStats } from '../services/brainRouter';
import { toast } from '../services/toast';

function parseJsonSafe(val, fallback) {
  if (val && typeof val === 'object') return val;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export default function PcControlCenterModal({
  isOpen,
  initialTab = 'clipboard',
  onClose,
  liveStats,
  watchdogAlert = null,
  onApplyWatchdogFix = null,
}) {
  const [tab, setTab] = useState(initialTab === 'voice_history' ? 'audit' : initialTab);
  const [loading, setLoading] = useState(false);

  // Clipboard state
  const [clips, setClips] = useState([]);
  const [clipFilter, setClipFilter] = useState('');

  // Processes & Ports state
  const [processes, setProcesses] = useState([]);
  const [ports, setPorts] = useState([]);
  const [procFilter, setProcFilter] = useState('');
  const [confirmKillPid, setConfirmKillPid] = useState(null);

  // Scheduler state
  const [tasks, setTasks] = useState([]);
  const [remMinutes, setRemMinutes] = useState('15');
  const [remMessage, setRemMessage] = useState('');

  // System & Power state
  const [telemetry, setTelemetry] = useState(null);
  const [activePowerScheme, setActivePowerScheme] = useState('');
  const [confirmEmptyBin, setConfirmEmptyBin] = useState(false);

  // Custom Macro / Workflow Builder state
  const [macros, setMacros] = useState([]);
  const [macroName, setMacroName] = useState('');
  const [macroCondition, setMacroCondition] = useState('always');
  const [macroSteps, setMacroSteps] = useState([{ type: 'power_plan', plan: 'high_performance' }]);
  const [dryRunPreview, setDryRunPreview] = useState(null);

  // Audit Log & Persistent Memory RAG state
  const [auditItems, setAuditItems] = useState([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [memories, setMemories] = useState([]);
  const [memInput, setMemInput] = useState('');
  const [memCategory, setMemCategory] = useState('preference');
  const [episodicRows, setEpisodicRows] = useState([]);
  const [episodicDate, setEpisodicDate] = useState('');
  const [episodicTopic, setEpisodicTopic] = useState('');
  const [episodicSource, setEpisodicSource] = useState(initialTab === 'voice_history' ? 'voice' : '');

  useEffect(() => {
    if (isOpen && initialTab) {
      if (initialTab === 'voice_history') {
        setTab('audit');
        setEpisodicSource('voice');
      } else {
        setTab(initialTab);
      }
    }
  }, [isOpen, initialTab]);

  const loadTab = useCallback(async (targetTab) => {
    const api = getSystemAPI();
    if (!api) return;
    setLoading(true);
    try {
      if (targetTab === 'clipboard') {
        const res = await api.clipboardHistory('list', 0);
        setClips(Array.isArray(res?.items) ? res.items : []);
      } else if (targetTab === 'processes') {
        const [procRaw, portRaw] = await Promise.all([
          api.diagnostics('top_processes', '20').catch(() => '[]'),
          api.diagnostics('ports', '').catch(() => '[]'),
        ]);
        const pList = parseJsonSafe(procRaw, []);
        const ptList = parseJsonSafe(portRaw, []);
        setProcesses(Array.isArray(pList) ? pList : pList ? [pList] : []);
        setPorts(Array.isArray(ptList) ? ptList : ptList ? [ptList] : []);
      } else if (targetTab === 'scheduler') {
        const res = await api.scheduler('list');
        setTasks(Array.isArray(res?.tasks) ? res.tasks : []);
      } else if (targetTab === 'system') {
        const [telRaw, pwr] = await Promise.all([
          api.diagnostics('overview', '').catch(() => null),
          api.powerProfile('get').catch(() => ''),
        ]);
        setTelemetry(parseJsonSafe(telRaw, null));
        setActivePowerScheme(String(pwr || ''));
      } else if (targetTab === 'workflows') {
        const res = await window.electronAPI?.macros?.('list').catch(() => ({ macros: [] }));
        setMacros(Array.isArray(res?.macros) ? res.macros : []);
      } else if (targetTab === 'audit') {
        const [hostLogs, memList, epRows] = await Promise.all([
          window.electronAPI?.getHostAuditLog?.().catch(() => []) || [],
          listAllMemories().catch(() => []),
          queryEpisodicTimeline({ dateKey: episodicDate, topic: episodicTopic, source: episodicSource, limit: 60 }).catch(() => []),
        ]);
        const localLogs = getAuditLog();
        const combined = [
          ...hostLogs.map((e) => ({ ...e, origin: 'PC Host' })),
          ...localLogs.map((e) => ({ ...e, origin: 'Assistant' })),
        ];
        setAuditItems(combined);
        setMemories(Array.isArray(memList) ? memList : []);
        setEpisodicRows(Array.isArray(epRows) ? epRows : []);
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to read PC state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    loadTab(tab);
  }, [isOpen, tab, loadTab, episodicDate, episodicTopic, episodicSource]);

  useEffect(() => {
    if (!isOpen) return;
    const unsubClip = window.electronAPI?.onClipboardUpdated?.((items) => {
      if (Array.isArray(items)) {
        setClips(items.map((item, idx) => ({ ...item, index: idx })));
      }
    });
    const unsubSched = window.electronAPI?.onSchedulerUpdated?.((items) => {
      if (Array.isArray(items)) setTasks(items);
    });
    return () => {
      unsubClip?.();
      unsubSched?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const api = getSystemAPI();
  const filteredClips = clips.filter((c) =>
    (c.text || '').toLowerCase().includes(clipFilter.toLowerCase())
  );
  const filteredProcs = processes.filter((p) =>
    `${p.name} ${p.title} ${p.id}`.toLowerCase().includes(procFilter.toLowerCase())
  );

  const runDirectPreset = async (label, fn) => {
    if (!api) return;
    try {
      await fn();
      toast.success(`${label} applied`);
      if (tab === 'system') loadTab('system');
    } catch (err) {
      toast.error(err?.message || `${label} failed`);
    }
  };

  const handleAddReminder = async (e) => {
    e.preventDefault();
    if (!api || !remMessage.trim()) return;
    try {
      await api.scheduler('remind', Number(remMinutes) || 5, remMessage.trim());
      setRemMessage('');
      toast.success(`Reminder set for ${remMinutes} min`);
      loadTab('scheduler');
    } catch (err) {
      toast.error(err?.message || 'Could not schedule reminder');
    }
  };

  const handleKillPid = async (proc) => {
    if (!api) return;
    if (confirmKillPid !== proc.id) {
      setConfirmKillPid(proc.id);
      setTimeout(() => setConfirmKillPid((cur) => (cur === proc.id ? null : cur)), 4000);
      return;
    }
    setConfirmKillPid(null);
    try {
      await api.manageProcess('kill_process', String(proc.id));
      toast.success(`Stopped ${proc.name} (PID ${proc.id})`);
      loadTab('processes');
    } catch (err) {
      toast.error(err?.message || 'Failed to terminate process');
    }
  };

  const diskList = telemetry?.disks
    ? Array.isArray(telemetry.disks)
      ? telemetry.disks
      : [telemetry.disks]
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-[2px] p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-obsidian-surface border border-obsidian-border rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-obsidian-border flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-obsidian-text">PC Control Center</h2>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                ZERO API TOKENS
              </span>
            </div>
            <p className="text-[11px] text-obsidian-muted">
              Direct Windows clipboard, process killer, timers, power plans &amp; telemetry
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => loadTab(tab)}
              className="p-1.5 rounded-lg text-obsidian-secondary hover:text-obsidian-text hover:bg-obsidian-elevated"
              title="Refresh active tab"
            >
              <LuRefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-obsidian-muted hover:text-obsidian-text hover:bg-obsidian-elevated"
            >
              <LuX className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 px-5 pt-2.5 border-b border-obsidian-border bg-obsidian-bg/40 overflow-x-auto">
          {[
            { id: 'clipboard', label: `Clipboard (${clips.length || liveStats?.clipboardCount || 0})`, icon: LuClipboard },
            { id: 'processes', label: 'Processes & Ports', icon: LuActivity },
            { id: 'scheduler', label: `Timers (${tasks.length || liveStats?.scheduledCount || 0})`, icon: LuClock },
            { id: 'workflows', label: 'Workflows', icon: LuWorkflow },
            { id: 'system', label: 'Hardware', icon: LuCpu },
            { id: 'audit', label: 'Audit & Memory', icon: LuDatabase },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  tab === item.id
                    ? 'border-emerald-400 text-obsidian-text'
                    : 'border-transparent text-obsidian-muted hover:text-obsidian-secondary'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {watchdogAlert && (
            <div className="p-3 rounded-xl bg-amber-950/35 border border-amber-500/40 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <LuShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-amber-300 truncate">{watchdogAlert.title}</p>
                  <p className="text-[11px] text-obsidian-secondary truncate">{watchdogAlert.message}</p>
                </div>
              </div>
              {watchdogAlert.fixAction && onApplyWatchdogFix && (
                <button
                  type="button"
                  onClick={() => onApplyWatchdogFix(watchdogAlert)}
                  className="px-2.5 py-1 rounded bg-amber-400 text-zinc-950 font-semibold flex-shrink-0"
                >
                  {watchdogAlert.fixAction.label}
                </button>
              )}
            </div>
          )}
          {!api ? (
            <div className="text-center py-10 text-xs text-obsidian-muted border border-dashed border-obsidian-border rounded-xl">
              Connect your PC (Desktop App or Pair Key) to manage workstation resources directly.
            </div>
          ) : tab === 'clipboard' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={clipFilter}
                  onChange={(e) => setClipFilter(e.target.value)}
                  placeholder="Filter clipboard history..."
                  className="flex-1 bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-1.5 text-xs text-obsidian-text focus:outline-none focus:border-zinc-500"
                />
                <button
                  type="button"
                  onClick={() => runDirectPreset('Clipboard cleared', () => api.clipboardHistory('clear', 0).then(() => setClips([])))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-obsidian-bg border border-obsidian-border text-xs text-red-400 hover:bg-red-950/30"
                >
                  <LuTrash2 className="w-3.5 h-3.5" />
                  Clear
                </button>
              </div>

              {filteredClips.length === 0 ? (
                <p className="text-center py-8 text-xs text-obsidian-muted border border-dashed border-obsidian-border rounded-xl">
                  Clipboard history empty. Copy any text on Windows and it appears here live.
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredClips.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="bg-obsidian-bg border border-obsidian-border rounded-xl p-3 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[10px] font-mono text-obsidian-muted mb-1">
                          <span>#{item.index ?? idx}</span>
                          <span>{item.length} chars</span>
                        </div>
                        <p className="text-xs text-obsidian-text font-mono break-all line-clamp-3 whitespace-pre-wrap">
                          {item.text || item.preview}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(item.text || item.preview);
                            toast.success('Copied back to clipboard');
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-obsidian-surface border border-obsidian-border text-[11px] text-obsidian-secondary hover:text-obsidian-text"
                        >
                          <LuCopy className="w-3 h-3" />
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            runDirectPreset('Pasted to active window', () =>
                              api.clipboardHistory('paste_index', item.index ?? idx)
                            )
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-[11px] text-emerald-300 hover:bg-emerald-500/25"
                        >
                          <LuPlay className="w-3 h-3" />
                          Paste
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : tab === 'processes' ? (
            <div className="space-y-4">
              <input
                type="text"
                value={procFilter}
                onChange={(e) => setProcFilter(e.target.value)}
                placeholder="Filter running processes by name or PID..."
                className="w-full bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-1.5 text-xs text-obsidian-text focus:outline-none focus:border-zinc-500"
              />
              <div className="space-y-1.5">
                {filteredProcs.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-obsidian-bg border border-obsidian-border text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-obsidian-text">{p.name}</span>
                        <span className="text-[10px] font-mono text-obsidian-muted">PID {p.id}</span>
                      </div>
                      {p.title && <p className="text-[11px] text-obsidian-muted truncate">{p.title}</p>}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="font-mono text-[11px] text-emerald-300">{p.ramMb} MB</span>
                      <button
                        type="button"
                        onClick={() => handleKillPid(p)}
                        className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                          confirmKillPid === p.id
                            ? 'bg-red-600 text-white border-red-500'
                            : 'bg-obsidian-surface border-obsidian-border text-red-400 hover:bg-red-950/40'
                        }`}
                      >
                        {confirmKillPid === p.id ? 'Confirm Kill?' : 'End Task'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {ports.length > 0 && (
                <div className="pt-2 border-t border-obsidian-border">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-obsidian-muted mb-2">
                    Listening TCP Ports ({ports.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ports.slice(0, 24).map((pt, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 rounded bg-obsidian-bg border border-obsidian-border text-[11px] font-mono text-obsidian-secondary"
                      >
                        :{pt.port} ({pt.process})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : tab === 'scheduler' ? (
            <div className="space-y-4">
              <div>
                <p className="text-[11px] font-mono uppercase tracking-wider text-obsidian-muted mb-2">
                  Instant Workstation Presets (Zero API Cost)
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      runDirectPreset('Coding Mode', async () => {
                        await api.powerProfile('high_performance').catch(() => {});
                        await api.openApp('vscode', '');
                      })
                    }
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-obsidian-bg hover:bg-obsidian-elevated border border-obsidian-border text-xs text-obsidian-text"
                  >
                    <LuTerminal className="w-3.5 h-3.5 text-emerald-400" />
                    Coding Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => runDirectPreset('Downloads Organized', () => api.filePro('organize_folder', 'downloads', ''))}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-obsidian-bg hover:bg-obsidian-elevated border border-obsidian-border text-xs text-obsidian-text"
                  >
                    <LuFolderOpen className="w-3.5 h-3.5 text-amber-400" />
                    Sort Downloads
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      runDirectPreset('Night Focus', async () => {
                        await api.theme('dark');
                        await api.powerProfile('balanced').catch(() => {});
                      })
                    }
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-obsidian-bg hover:bg-obsidian-elevated border border-obsidian-border text-xs text-obsidian-text"
                  >
                    <LuMonitor className="w-3.5 h-3.5 text-sky-400" />
                    Night Focus
                  </button>
                  <button
                    type="button"
                    onClick={() => runDirectPreset('Volume Muted', () => api.volume('mute', -1))}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-obsidian-bg hover:bg-obsidian-elevated border border-obsidian-border text-xs text-obsidian-text"
                  >
                    <LuVolumeX className="w-3.5 h-3.5 text-red-400" />
                    Mute PC Audio
                  </button>
                  <button
                    type="button"
                    onClick={() => runDirectPreset('All Windows Minimized', () => api.minimizeAll())}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-obsidian-bg hover:bg-obsidian-elevated border border-obsidian-border text-xs text-obsidian-text"
                  >
                    <LuZap className="w-3.5 h-3.5 text-violet-400" />
                    Show Desktop
                  </button>
                  <button
                    type="button"
                    onClick={() => runDirectPreset('YouTube Ad Skipped', () => api.browserControl('youtube_skip_ad', ''))}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-obsidian-bg hover:bg-obsidian-elevated border border-obsidian-border text-xs text-obsidian-text"
                  >
                    <LuPlay className="w-3.5 h-3.5 text-emerald-400" />
                    Skip YT Ad
                  </button>
                </div>
              </div>

              <form onSubmit={handleAddReminder} className="p-3.5 rounded-xl bg-obsidian-bg border border-obsidian-border space-y-2.5">
                <p className="text-xs font-medium text-obsidian-text">Schedule New Windows + Voice Reminder</p>
                <div className="flex items-center gap-2">
                  <select
                    value={remMinutes}
                    onChange={(e) => setRemMinutes(e.target.value)}
                    className="bg-obsidian-surface border border-obsidian-border rounded-lg px-2.5 py-1.5 text-xs text-obsidian-text"
                  >
                    <option value="1">1 min</option>
                    <option value="5">5 min</option>
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                    <option value="60">1 hour</option>
                  </select>
                  <input
                    type="text"
                    value={remMessage}
                    onChange={(e) => setRemMessage(e.target.value)}
                    placeholder="Drink water, join call, check server..."
                    className="flex-1 bg-obsidian-surface border border-obsidian-border rounded-lg px-3 py-1.5 text-xs text-obsidian-text focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!remMessage.trim()}
                    className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-white disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </form>

              <div className="space-y-1.5">
                {tasks.length === 0 ? (
                  <p className="text-center py-4 text-xs text-obsidian-muted border border-dashed border-obsidian-border rounded-xl">
                    No active scheduled timers or delayed commands.
                  </p>
                ) : (
                  tasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-obsidian-bg border border-obsidian-border text-xs"
                    >
                      <div>
                        <p className="text-obsidian-text font-medium">{t.message || t.description || t.command}</p>
                        <p className="text-[10px] font-mono text-obsidian-muted">
                          {t.kind} · {Math.ceil((t.remainingSeconds || 0) / 60)}m remaining
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => runDirectPreset('Timer cancelled', () => api.scheduler('cancel', t.id).then(() => loadTab('scheduler')))}
                        className="px-2 py-1 rounded bg-obsidian-surface border border-obsidian-border text-[11px] text-red-400 hover:bg-red-950/30"
                      >
                        Cancel
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {telemetry && (
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-xl bg-obsidian-bg border border-obsidian-border">
                    <p className="text-[10px] font-mono text-obsidian-muted uppercase">Processor</p>
                    <p className="text-xs font-medium text-obsidian-text mt-1 truncate">{telemetry.cpuName}</p>
                    <p className="text-[11px] font-mono text-emerald-400 mt-0.5">
                      {telemetry.cpuLogical} threads · {liveStats?.cpuUsedPct ?? telemetry.cpuLoadPct ?? 0}% load
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-obsidian-bg border border-obsidian-border">
                    <p className="text-[10px] font-mono text-obsidian-muted uppercase">Memory</p>
                    <p className="text-xs font-medium text-obsidian-text mt-1">
                      {telemetry.ramFreeGb} GB free / {telemetry.ramTotalGb} GB
                    </p>
                    <p className="text-[11px] font-mono text-sky-400 mt-0.5">{telemetry.ramUsedPct}% utilized</p>
                  </div>
                </div>
              )}

              {diskList.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-obsidian-muted">Fixed Drives</p>
                  {diskList.map((d, i) => (
                    <div key={i} className="p-3 rounded-xl bg-obsidian-bg border border-obsidian-border space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-medium text-obsidian-text">
                          {d.drive} {d.label ? `(${d.label})` : ''}
                        </span>
                        <span className="font-mono text-obsidian-secondary">
                          {d.freeGb} GB free / {d.totalGb} GB ({d.usedPct}% used)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-obsidian-elevated rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, d.usedPct || 0)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="p-3.5 rounded-xl bg-obsidian-bg border border-obsidian-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-obsidian-text">Windows Power Scheme</span>
                  <span className="text-[10px] font-mono text-obsidian-muted truncate max-w-[260px]">
                    {activePowerScheme || 'Checking...'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'balanced', label: 'Balanced' },
                    { id: 'high_performance', label: 'High Performance' },
                    { id: 'power_saver', label: 'Power Saver' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => runDirectPreset(`Power plan ${p.label}`, () => api.powerProfile(p.id))}
                      className="px-2.5 py-1.5 rounded-lg bg-obsidian-surface hover:bg-obsidian-elevated border border-obsidian-border text-xs text-obsidian-text"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirmEmptyBin) {
                      setConfirmEmptyBin(true);
                      setTimeout(() => setConfirmEmptyBin(false), 4000);
                      return;
                    }
                    setConfirmEmptyBin(false);
                    await runDirectPreset('Recycle Bin Emptied', () => api.emptyRecycleBin());
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    confirmEmptyBin
                      ? 'bg-red-600 text-white border-red-500'
                      : 'bg-obsidian-bg border-obsidian-border text-red-400 hover:bg-red-950/30'
                  }`}
                >
                  <LuTrash2 className="w-3.5 h-3.5" />
                  {confirmEmptyBin ? 'Click Again to Permanently Empty Recycle Bin' : 'Empty Recycle Bin'}
                </button>
              </div>
            </div>
          )}

          {api && tab === 'workflows' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-obsidian-bg border border-obsidian-border space-y-2.5">
                <p className="text-[11px] font-mono uppercase tracking-wider text-emerald-400">
                  Custom Workflow Builder (Trigger -&gt; Condition -&gt; Actions)
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={macroName}
                    onChange={(e) => setMacroName(e.target.value)}
                    placeholder="Workflow name (e.g. Deep Focus Sprint)"
                    className="flex-1 bg-obsidian-surface border border-obsidian-border rounded-lg px-3 py-1.5 text-xs text-obsidian-text"
                  />
                  <select
                    value={macroCondition}
                    onChange={(e) => setMacroCondition(e.target.value)}
                    className="bg-obsidian-surface border border-obsidian-border rounded-lg px-2.5 py-1.5 text-xs text-obsidian-text"
                  >
                    <option value="always">Condition: Always</option>
                    <option value="battery_low">Condition: Battery &lt;= 25%</option>
                    <option value="ram_high">Condition: RAM &gt;= 80%</option>
                    <option value="cpu_high">Condition: CPU &gt;= 80%</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  {macroSteps.map((st, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-[10px] text-obsidian-muted w-4">{idx + 1}.</span>
                      <select
                        value={st.type}
                        onChange={(e) => {
                          const t = e.target.value;
                          const next = [...macroSteps];
                          next[idx] =
                            t === 'power_plan'
                              ? { type: 'power_plan', plan: 'high_performance' }
                              : t === 'open_app'
                                ? { type: 'open_app', app: 'vscode' }
                                : t === 'theme'
                                  ? { type: 'theme', mode: 'dark' }
                                  : t === 'volume'
                                    ? { type: 'volume', level: 50 }
                                    : t === 'brightness'
                                      ? { type: 'brightness', level: 60 }
                                      : { type: t };
                          setMacroSteps(next);
                        }}
                        className="bg-obsidian-surface border border-obsidian-border rounded px-2 py-1 text-xs text-obsidian-text"
                      >
                        <option value="power_plan">Power Plan</option>
                        <option value="open_app">Open App</option>
                        <option value="theme">Theme (Dark/Light)</option>
                        <option value="volume">Set Volume %</option>
                        <option value="brightness">Set Brightness %</option>
                        <option value="minimize_all">Minimize All</option>
                        <option value="clean_temp">Clean Temp Files</option>
                      </select>

                      {(st.type === 'open_app' || st.type === 'power_plan' || st.type === 'theme') && (
                        <input
                          type="text"
                          value={st.app || st.plan || st.mode || ''}
                          onChange={(e) => {
                            const next = [...macroSteps];
                            const v = e.target.value;
                            if (st.type === 'open_app') next[idx] = { ...st, app: v };
                            else if (st.type === 'power_plan') next[idx] = { ...st, plan: v };
                            else next[idx] = { ...st, mode: v };
                            setMacroSteps(next);
                          }}
                          className="flex-1 bg-obsidian-surface border border-obsidian-border rounded px-2 py-1 text-xs text-obsidian-text"
                        />
                      )}

                      {(st.type === 'volume' || st.type === 'brightness') && (
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={st.level ?? 50}
                          onChange={(e) => {
                            const next = [...macroSteps];
                            next[idx] = { ...st, level: Number(e.target.value) };
                            setMacroSteps(next);
                          }}
                          className="w-20 bg-obsidian-surface border border-obsidian-border rounded px-2 py-1 text-xs text-obsidian-text"
                        />
                      )}

                      {macroSteps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setMacroSteps(macroSteps.filter((_, j) => j !== idx))}
                          className="text-red-400 text-[11px] px-1.5"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setMacroSteps([...macroSteps, { type: 'open_app', app: 'chrome' }])}
                    className="px-2.5 py-1 rounded bg-obsidian-surface border border-obsidian-border text-[11px] text-obsidian-text"
                  >
                    + Add Step
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const prev = await window.electronAPI?.macros?.('dry_run', {
                        name: macroName || 'Preview Workflow',
                        condition: macroCondition,
                        steps: macroSteps,
                      });
                      setDryRunPreview(prev);
                    }}
                    className="px-2.5 py-1 rounded bg-sky-500/15 border border-sky-500/30 text-[11px] text-sky-300"
                  >
                    Dry-Run Preview
                  </button>
                  <button
                    type="button"
                    disabled={!macroName.trim()}
                    onClick={async () => {
                      await window.electronAPI?.macros?.('save', {
                        name: macroName.trim(),
                        condition: macroCondition,
                        steps: macroSteps,
                      });
                      setMacroName('');
                      setDryRunPreview(null);
                      toast.success('Workflow saved');
                      loadTab('workflows');
                    }}
                    className="px-3 py-1 rounded bg-zinc-100 text-zinc-950 text-[11px] font-semibold disabled:opacity-40"
                  >
                    Save Workflow
                  </button>
                </div>

                {dryRunPreview && (
                  <div className="mt-2 p-2.5 rounded-lg bg-obsidian-surface border border-sky-500/30 text-[11px] space-y-1">
                    <p className="font-semibold text-sky-300">
                      Dry-Run: {dryRunPreview.name} · Condition {dryRunPreview.conditionMet ? 'MET' : 'NOT MET'} ({dryRunPreview.conditionNote})
                    </p>
                    {dryRunPreview.previewSteps?.map((s) => (
                      <p key={s.stepNumber} className="font-mono text-obsidian-secondary">
                        #{s.stepNumber}: {s.type} {s.target ? `-> ${s.target}` : ''} ({s.risk} risk)
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {macros.map((m) => (
                  <div key={m.id} className="p-3 rounded-xl bg-obsidian-bg border border-obsidian-border flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-obsidian-text">
                        {m.name} {m.custom && <span className="text-[10px] font-mono text-emerald-400">· custom</span>}
                      </p>
                      <p className="text-[10px] text-obsidian-muted truncate">{m.description}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => runDirectPreset(m.name, () => window.electronAPI?.macros?.('run', m.id))}
                        className="px-2.5 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-[11px] text-emerald-300"
                      >
                        Run
                      </button>
                      {m.custom && (
                        <button
                          type="button"
                          onClick={async () => {
                            await window.electronAPI?.macros?.('delete', m.id);
                            loadTab('workflows');
                          }}
                          className="px-2 py-1 rounded text-[11px] text-red-400 hover:bg-red-950/30"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {api && tab === 'audit' && (
            <div className="space-y-4">
              {/* Hybrid Local Brain API Savings Banner */}
              {(() => {
                const bs = getBrainStats();
                return (
                  <div className="p-3 rounded-xl bg-obsidian-bg border border-emerald-500/30 flex items-center justify-between gap-2 flex-wrap text-xs">
                    <div>
                      <span className="font-mono text-emerald-300 font-semibold">{bs.localPct}% Offline/Local</span>
                      <span className="text-obsidian-muted ml-2">
                        ({bs.localFast} instant · {bs.localIntent} semantic · {bs.localSlm} SLM vs {bs.cloudCalls} Gemini)
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-obsidian-secondary">
                      ~{bs.estimatedTokensSaved.toLocaleString()} tokens saved
                    </span>
                  </div>
                );
              })()}

              {/* Episodic Timeline Memory (Date & Day Indexed Q&A Log) */}
              <div className="p-3.5 rounded-xl bg-obsidian-bg border border-obsidian-border space-y-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-sky-300">
                    Episodic Date Memory ({episodicRows.length} turns)
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                    <button
                      type="button"
                      onClick={() => setEpisodicDate(toDateKey(new Date()))}
                      className={`px-2 py-0.5 rounded border ${
                        episodicDate === toDateKey(new Date())
                          ? 'bg-sky-500/20 border-sky-500/40 text-sky-200'
                          : 'bg-obsidian-surface border-obsidian-border text-obsidian-muted'
                      }`}
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const y = new Date();
                        y.setDate(y.getDate() - 1);
                        setEpisodicDate(toDateKey(y));
                      }}
                      className="px-2 py-0.5 rounded border bg-obsidian-surface border-obsidian-border text-obsidian-muted hover:text-obsidian-text"
                    >
                      Yesterday
                    </button>
                    <button
                      type="button"
                      onClick={() => setEpisodicSource((s) => (s === 'voice' ? '' : 'voice'))}
                      className={`px-2 py-0.5 rounded border ${
                        episodicSource === 'voice'
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          : 'bg-obsidian-surface border-obsidian-border text-obsidian-muted'
                      }`}
                    >
                      {episodicSource === 'voice' ? 'Voice Only' : 'All Inputs'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEpisodicDate('')}
                      className={`px-2 py-0.5 rounded border ${
                        !episodicDate
                          ? 'bg-sky-500/20 border-sky-500/40 text-sky-200'
                          : 'bg-obsidian-surface border-obsidian-border text-obsidian-muted'
                      }`}
                    >
                      All Days
                    </button>
                    <input
                      type="date"
                      value={episodicDate}
                      onChange={(e) => setEpisodicDate(e.target.value)}
                      className="bg-obsidian-surface border border-obsidian-border rounded px-1.5 py-0.5 text-[11px] text-obsidian-text"
                    />
                    {episodicDate && (
                      <button
                        type="button"
                        onClick={async () => {
                          await forgetEpisodicDay(episodicDate);
                          toast.info(`Deleted timeline for ${episodicDate}`);
                          loadTab('audit');
                        }}
                        className="px-2 py-0.5 rounded bg-red-950/40 border border-red-900/50 text-red-300 text-[10px]"
                      >
                        Delete Day
                      </button>
                    )}
                  </div>
                </div>
                <input
                  type="text"
                  value={episodicTopic}
                  onChange={(e) => setEpisodicTopic(e.target.value)}
                  placeholder="Search past conversations by topic (e.g. Chrome, error, volume)..."
                  className="w-full bg-obsidian-surface border border-obsidian-border rounded-lg px-3 py-1.5 text-xs text-obsidian-text"
                />
                {episodicRows.length > 0 ? (
                  <div className="max-h-40 overflow-y-auto space-y-1.5">
                    {episodicRows.map((row) => (
                      <div key={row.id} className="p-2 rounded bg-obsidian-surface border border-obsidian-border text-[11px]">
                        <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-obsidian-muted">
                          <span>{row.dateKey} ({row.weekday}) · {row.timeLabel} · {row.source}</span>
                          <span className={row.brainTier === 'cloud' ? 'text-sky-300' : 'text-emerald-300'}>
                            {row.brainTier}
                          </span>
                        </div>
                        <p className="text-obsidian-text mt-0.5 truncate">You: {row.userPrompt}</p>
                        {row.assistantReply && (
                          <p className="text-obsidian-secondary truncate">JEEVA: {row.assistantReply}</p>
                        )}
                        {Array.isArray(row.toolsUsed) && row.toolsUsed.length > 0 && (
                          <p className="text-[10px] text-emerald-400/90 mt-0.5 truncate">
                            Actions: {row.toolsUsed.map((t) => String(t).replace(/_/g, ' ')).join(', ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-obsidian-muted">No recorded turns for this date/filter yet.</p>
                )}
              </div>

              {/* Persistent Local Memory RAG Panel */}
              <div className="p-3.5 rounded-xl bg-obsidian-bg border border-obsidian-border space-y-2.5">
                <p className="text-[11px] font-mono uppercase tracking-wider text-emerald-400">
                  Persistent Local Memory RAG ({memories.length} items)
                </p>
                <div className="flex gap-2">
                  <select
                    value={memCategory}
                    onChange={(e) => setMemCategory(e.target.value)}
                    className="bg-obsidian-surface border border-obsidian-border rounded-lg px-2 py-1.5 text-xs text-obsidian-text"
                  >
                    <option value="preference">Preference</option>
                    <option value="project">Project Path</option>
                    <option value="folder">Frequent Folder</option>
                    <option value="fact">Fact</option>
                  </select>
                  <input
                    type="text"
                    value={memInput}
                    onChange={(e) => setMemInput(e.target.value)}
                    placeholder="Remember preference or project path (e.g. D:\\Work\\MyApp)..."
                    className="flex-1 bg-obsidian-surface border border-obsidian-border rounded-lg px-3 py-1.5 text-xs text-obsidian-text"
                  />
                  <button
                    type="button"
                    disabled={!memInput.trim()}
                    onClick={async () => {
                      await rememberUserMemory(memInput.trim(), memCategory);
                      setMemInput('');
                      loadTab('audit');
                      toast.success('Saved to Persistent Memory');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-semibold disabled:opacity-40"
                  >
                    Save
                  </button>
                </div>
                {memories.length > 0 && (
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {memories.slice(0, 12).map((m) => (
                      <div key={m.id} className="flex items-center justify-between px-2.5 py-1.5 rounded bg-obsidian-surface border border-obsidian-border text-[11px]">
                        <span className="truncate text-obsidian-text">
                          <span className="font-mono text-emerald-400 mr-1.5">[{m.category}]</span>
                          {m.content}
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            await forgetMemoryItem(m.id);
                            loadTab('audit');
                          }}
                          className="text-red-400 hover:underline ml-2 flex-shrink-0"
                        >
                          Forget
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Searchable Exportable Audit Log */}
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Search audit log by tool, action, source, decision..."
                    className="flex-1 min-w-[180px] bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-1.5 text-xs text-obsidian-text"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(auditItems, null, 2)], { type: 'application/json' });
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = `jeeva-audit-${Date.now()}.json`;
                      a.click();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-obsidian-bg border border-obsidian-border text-xs text-obsidian-text"
                  >
                    <LuDownload className="w-3.5 h-3.5" />
                    Export JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const csv = [
                        'timestamp,origin,source,category,tool_or_action,decision,summary',
                        ...auditItems.map((e) =>
                          [e.timestamp, e.origin, e.source, e.category, e.tool || e.action, e.decision, e.summary]
                            .map((v) => `"${String(v || '').replace(/"/g, '""')}"`)
                            .join(',')
                        ),
                      ].join('\n');
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = `jeeva-audit-${Date.now()}.csv`;
                      a.click();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-obsidian-bg border border-obsidian-border text-xs text-obsidian-text"
                  >
                    <LuDownload className="w-3.5 h-3.5" />
                    Export CSV
                  </button>
                </div>

                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {auditItems
                    .filter((e) =>
                      `${e.origin} ${e.source} ${e.category} ${e.tool || e.action} ${e.summary} ${e.decision}`
                        .toLowerCase()
                        .includes(auditSearch.toLowerCase())
                    )
                    .slice(0, 80)
                    .map((e, i) => (
                      <div key={e.id || i} className="p-2.5 rounded-lg bg-obsidian-bg border border-obsidian-border text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-obsidian-secondary">
                            [{e.origin}] {e.source || 'local'} · {e.tool || e.action}
                          </span>
                          <span className="font-mono text-[10px] text-emerald-300">{e.decision}</span>
                        </div>
                        <p className="text-obsidian-text truncate mt-0.5">{e.summary}</p>
                        <p className="text-[10px] text-obsidian-muted">{e.timestamp}</p>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
