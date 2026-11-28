import { useEffect, useState, useCallback } from 'react';
import {
  LuBell,
  LuClock,
  LuPlus,
  LuTrash2,
  LuRefreshCw,
  LuCpu,
  LuHardDrive,
  LuMonitor,
  LuMoon,
  LuVolume2,
  LuSparkles,
  LuSlidersHorizontal,
  LuCheck,
  LuMic,
  LuMessageSquare,
  LuHistory,
} from 'react-icons/lu';

export function RemindersPanel({ onRunCommand }) {
  const [agenda, setAgenda] = useState({ todayItems: [], missedItems: [], upcomingItems: [] });
  const [loading, setLoading] = useState(false);
  const [quickText, setQuickText] = useState('');

  const loadAgenda = useCallback(async () => {
    if (!window.electronAPI?.scheduler) return;
    setLoading(true);
    try {
      const res = await window.electronAPI.scheduler('agenda');
      setAgenda({
        todayItems: Array.isArray(res?.todayItems) ? res.todayItems : [],
        missedItems: Array.isArray(res?.missedItems) ? res.missedItems : [],
        upcomingItems: Array.isArray(res?.upcomingItems) ? res.upcomingItems : [],
      });
    } catch {
      // Keep previous list on transient error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgenda();
  }, [loadAgenda]);

  const handleQuickAdd = async (e) => {
    e.preventDefault();
    const text = quickText.trim();
    if (!text) return;
    setQuickText('');
    await onRunCommand?.(text);
    setTimeout(loadAgenda, 500);
  };

  const handleDelete = async (id) => {
    if (!id || !window.electronAPI?.scheduler) return;
    try {
      await window.electronAPI.scheduler('delete', id);
      loadAgenda();
    } catch {}
  };

  const totalCount =
    agenda.todayItems.length + agenda.missedItems.length + agenda.upcomingItems.length;

  const renderGroup = (title, items, accentClass) => {
    if (!items.length) return null;
    return (
      <div className="mb-5">
        <div className={`text-[11px] font-mono uppercase tracking-wider mb-2 ${accentClass}`}>
          {title} ({items.length})
        </div>
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id || `${item.message}-${item.fireAt}`}
              className="cyber-card rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-400/20 flex items-center justify-center text-sky-300 flex-shrink-0">
                  <LuBell className="w-3.5 h-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-obsidian-text font-medium truncate">
                    {item.message || item.description || 'Reminder'}
                  </p>
                  <p className="text-[11px] font-mono text-obsidian-muted flex items-center gap-1.5 mt-0.5">
                    <LuClock className="w-3 h-3" />
                    <span>{item.dateLabel || item.timeLabel || (item.fireAt ? new Date(item.fireAt).toLocaleString('en-IN') : 'Scheduled')}</span>
                  </p>
                </div>
              </div>
              {item.id && (
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  className="p-1.5 rounded-lg text-obsidian-muted hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                  title="Mark Done / Remove"
                >
                  <LuCheck className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 bg-jeeva-grid">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-semibold text-gradient-futuristic">Reminders & Timers</h2>
            <p className="text-xs text-obsidian-secondary mt-0.5">
              Bolo ya likho — JEEVA time par Notch glow aur voice announcement ke sath yaad dilayega.
            </p>
          </div>
          <button
            type="button"
            onClick={loadAgenda}
            className="cyber-pill px-2.5 py-1.5 rounded-lg text-xs text-obsidian-secondary hover:text-sky-200 inline-flex items-center gap-1.5"
          >
            <LuRefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <form onSubmit={handleQuickAdd} className="glass-panel rounded-xl p-2 border border-sky-500/20 flex items-center gap-2 mb-6">
          <input
            type="text"
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            placeholder='e.g. "10 minute baad paani peene ka reminder lagao" or "Kal 9 baje meeting"'
            className="flex-1 bg-transparent px-2.5 py-1.5 text-sm text-obsidian-text placeholder:text-obsidian-muted outline-none"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-400 to-sky-400 text-zinc-950 text-xs font-semibold hover:brightness-110 transition-all"
          >
            <LuPlus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </form>

        {totalCount === 0 ? (
          <div className="cyber-card rounded-2xl p-8 text-center">
            <LuBell className="w-7 h-7 text-sky-400/70 mx-auto mb-2.5" />
            <p className="text-sm font-medium text-obsidian-text">Abhi koi active reminder nahi hai</p>
            <p className="text-xs text-obsidian-muted mt-1">
              Upar likho ya mic par bolo: &quot;15 minute baad call karne ka reminder lagao&quot;
            </p>
          </div>
        ) : (
          <>
            {renderGroup('Missed', agenda.missedItems, 'text-amber-300')}
            {renderGroup('Today', agenda.todayItems, 'text-emerald-300')}
            {renderGroup('Upcoming', agenda.upcomingItems, 'text-sky-300')}
          </>
        )}
      </div>
    </div>
  );
}

export function PcMemoryPanel({ liveStats, onRunCommand, onOpenFullPcControl }) {
  const [memories, setMemories] = useState([]);

  useEffect(() => {
    window.electronAPI?.memoryList?.()
      .then((list) => {
        if (Array.isArray(list)) setMemories(list.slice(0, 8));
      })
      .catch(() => {});
  }, []);

  const quickActions = [
    { icon: LuVolume2, label: 'Volume 50%', prompt: 'Volume 50 percent kar do' },
    { icon: LuMoon, label: 'Toggle Dark Mode', prompt: 'Windows dark mode toggle karo' },
    { icon: LuTrash2, label: 'Clean Temp Files', prompt: 'Temp junk files clean karo' },
    { icon: LuMonitor, label: 'Read Screen', prompt: 'Screen padh kar sunao' },
    { icon: LuHardDrive, label: 'Battery & Storage', prompt: 'Battery aur disk storage check karo' },
    { icon: LuSparkles, label: 'Organize Downloads', prompt: 'Downloads folder organize karo' },
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 bg-jeeva-grid">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gradient-futuristic">PC Controls & Memory</h2>
            <p className="text-xs text-obsidian-secondary mt-0.5">
              Instant local Windows automation aur JEEVA ki yaad rakhi hui baatein.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenFullPcControl?.('system')}
            className="cyber-pill px-3 py-1.5 rounded-lg text-xs text-sky-200 inline-flex items-center gap-1.5"
          >
            <LuSlidersHorizontal className="w-3.5 h-3.5" />
            <span>Full Control Center</span>
          </button>
        </div>

        {liveStats && (
          <div className="grid grid-cols-3 gap-3">
            <div className="cyber-card rounded-xl p-3.5">
              <div className="text-[11px] font-mono text-obsidian-muted flex items-center gap-1.5">
                <LuCpu className="w-3.5 h-3.5 text-sky-400" />
                <span>CPU LOAD</span>
              </div>
              <div className="text-xl font-semibold text-obsidian-text mt-1">
                {liveStats.cpuUsedPct ?? '--'}%
              </div>
            </div>
            <div className="cyber-card rounded-xl p-3.5">
              <div className="text-[11px] font-mono text-obsidian-muted">RAM USAGE</div>
              <div className="text-xl font-semibold text-obsidian-text mt-1">
                {liveStats.ramUsedPct ?? '--'}%
              </div>
              <div className="text-[10px] text-obsidian-muted">{liveStats.ramFreeGb ?? '--'} GB free</div>
            </div>
            <div className="cyber-card rounded-xl p-3.5">
              <div className="text-[11px] font-mono text-obsidian-muted">DISK ({liveStats.diskDrive || 'C:'})</div>
              <div className="text-xl font-semibold text-obsidian-text mt-1">
                {liveStats.diskUsedPct !== undefined ? `${100 - liveStats.diskUsedPct}%` : '--'}
              </div>
              <div className="text-[10px] text-obsidian-muted">Free space</div>
            </div>
          </div>
        )}

        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-sky-300/80 mb-2.5">
            One-Tap Agent Actions
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {quickActions.map((act) => {
              const Icon = act.icon;
              return (
                <button
                  key={act.label}
                  type="button"
                  onClick={() => onRunCommand?.(act.prompt)}
                  className="cyber-card rounded-xl p-3 text-left flex items-center gap-2.5"
                >
                  <span className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-400/20 flex items-center justify-center text-sky-300 flex-shrink-0">
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-xs font-medium text-obsidian-text">{act.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-emerald-300/80 mb-2.5">
            Saved Personal Memory ({memories.length})
          </div>
          {memories.length === 0 ? (
            <div className="cyber-card rounded-xl p-4 text-xs text-obsidian-muted">
              Abhi koi saved memory nahi hai — bolo &quot;Yaad rakhna mera exam Monday ko hai&quot;.
            </div>
          ) : (
            <div className="space-y-2">
              {memories.map((m, idx) => (
                <div key={m.id || idx} className="cyber-card rounded-xl px-3.5 py-2.5 text-xs text-obsidian-secondary">
                  {m.text || m.fact || m.content || JSON.stringify(m)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


export function HistoryPanel({
  currentMessages = [],
  conversations = [],
  onSelectConversation,
  onDeleteConversation,
  onNewChat,
  onResumeCurrent,
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 bg-jeeva-grid">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-semibold text-gradient-futuristic">Voice & Chat History</h2>
            <p className="text-xs text-obsidian-secondary mt-0.5">
              Voice commands aur text chats dono yahan automatically save hote hain.
            </p>
          </div>
          {currentMessages.length > 0 && (
            <button
              type="button"
              onClick={onNewChat}
              className="cyber-pill px-3 py-1.5 rounded-lg text-xs text-sky-200 inline-flex items-center gap-1.5"
            >
              <LuPlus className="w-3.5 h-3.5" />
              <span>Save & New</span>
            </button>
          )}
        </div>

        {currentMessages.length > 0 && (
          <div className="mb-5">
            <div className="text-[11px] font-mono uppercase tracking-wider text-emerald-300 mb-2">
              Current Active Session ({currentMessages.length} messages)
            </div>
            <button
              type="button"
              onClick={onResumeCurrent}
              className="w-full text-left cyber-card rounded-xl px-4 py-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-obsidian-text truncate">
                  {currentMessages.find((m) => m.role === 'user')?.text || 'Active Conversation'}
                </p>
                <p className="text-[11px] text-obsidian-muted mt-0.5">
                  Click to return to active voice & chat feed
                </p>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-400/30">
                LIVE
              </span>
            </button>
          </div>
        )}

        <div className="text-[11px] font-mono uppercase tracking-wider text-sky-300/80 mb-2.5">
          Saved Sessions ({conversations.length})
        </div>
        {conversations.length === 0 ? (
          <div className="cyber-card rounded-2xl p-8 text-center">
            <LuHistory className="w-7 h-7 text-sky-400/70 mx-auto mb-2.5" />
            <p className="text-sm font-medium text-obsidian-text">Abhi koi purani saved history nahi hai</p>
            <p className="text-xs text-obsidian-muted mt-1">
              Voice ya text se baat karo — saare sessions yahan save hote rahenge.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {conversations.map((conv) => {
              const msgs = Array.isArray(conv.messages) ? conv.messages : [];
              const voiceCount = msgs.filter((m) => m.fromVoice).length;
              return (
                <div
                  key={conv.id}
                  className="cyber-card rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3"
                >
                  <button
                    type="button"
                    onClick={() => onSelectConversation?.(conv)}
                    className="flex-1 min-w-0 text-left flex items-center gap-3"
                  >
                    <span className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-400/20 flex items-center justify-center text-sky-300 flex-shrink-0">
                      {voiceCount > 0 ? <LuMic className="w-3.5 h-3.5" /> : <LuMessageSquare className="w-3.5 h-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-obsidian-text truncate">
                        {conv.title || 'Untitled Session'}
                      </p>
                      <p className="text-[11px] font-mono text-obsidian-muted mt-0.5">
                        {conv.date || 'Recent'} · {msgs.length} msgs{voiceCount > 0 ? ` · ${voiceCount} voice` : ''}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteConversation?.(conv.id)}
                    className="p-1.5 rounded-lg text-obsidian-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Delete from history"
                  >
                    <LuTrash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
