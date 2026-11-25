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
} from 'react-icons/lu';
import { getSystemAPI } from '../services/bridge';
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

export default function PcControlCenterModal({ isOpen, initialTab = 'clipboard', onClose, liveStats }) {
  const [tab, setTab] = useState(initialTab);
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

  useEffect(() => {
    if (isOpen && initialTab) setTab(initialTab);
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
  }, [isOpen, tab, loadTab]);

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
        <div className="flex items-center gap-1 px-5 pt-2.5 border-b border-obsidian-border bg-obsidian-bg/40">
          {[
            { id: 'clipboard', label: `Clipboard (${clips.length || liveStats?.clipboardCount || 0})`, icon: LuClipboard },
            { id: 'processes', label: 'Processes & Ports', icon: LuActivity },
            { id: 'scheduler', label: `Timers & Presets (${tasks.length || liveStats?.scheduledCount || 0})`, icon: LuClock },
            { id: 'system', label: 'Hardware & Power', icon: LuCpu },
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
        </div>
      </div>
    </div>
  );
}
