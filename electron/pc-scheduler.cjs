const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_DELAY_MS = 120 * 24 * 60 * 60 * 1000; // Up to 120 days scheduling horizon
const TIMER_SLICE_MS = 24 * 60 * 60 * 1000; // Safe 24h Node timer slices to avoid 32-bit overflow
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // Retain reminders & missed items for 90 days (3 months)

function toLocalDateKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const PC_MACROS = [
  {
    id: 'coding_mode',
    name: 'Coding Mode',
    description: 'High performance power profile + launches VS Code + system diagnostics snapshot',
    steps: [
      { type: 'power_plan', plan: 'high_performance' },
      { type: 'open_app', app: 'vscode' },
      { type: 'diagnostics', action: 'overview' },
    ],
  },
  {
    id: 'clean_desktop',
    name: 'Clean Downloads',
    description: 'Sorts Downloads folder cleanly into Documents, Images, Archives, Videos & Installers',
    steps: [
      { type: 'file_pro', action: 'organize_folder', source: 'downloads' },
    ],
  },
  {
    id: 'meeting_prep',
    name: 'Meeting Prep',
    description: 'Normalizes speaker volume to 65%, minimizes distraction windows, checks network & mic readiness',
    steps: [
      { type: 'minimize_all' },
      { type: 'volume', level: 65 },
    ],
  },
  {
    id: 'night_focus',
    name: 'Night Focus',
    description: 'Enables Dark mode, lowers screen brightness to 35% and sets Balanced power plan',
    steps: [
      { type: 'theme', mode: 'dark' },
      { type: 'brightness', level: 35 },
      { type: 'power_plan', plan: 'balanced' },
    ],
  },
];

function createScheduler({
  userDataDir,
  NotificationClass = null,
  onFire = null,
  onExecuteCommand = null,
  onListUpdate = null,
} = {}) {
  const storePath = userDataDir ? path.join(userDataDir, 'pc-routines.json') : null;
  const macroStorePath = userDataDir ? path.join(userDataDir, 'custom-macros.json') : null;
  const tasks = new Map(); // id -> task
  const timers = new Map(); // id -> Timeout
  let customMacros = [];
  let initialized = false;

  function loadMacros() {
    if (!macroStorePath || !fs.existsSync(macroStorePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(macroStorePath, 'utf8'));
      if (Array.isArray(parsed)) customMacros = parsed;
    } catch {}
  }

  function persistMacros() {
    if (!macroStorePath) return;
    try {
      fs.mkdirSync(path.dirname(macroStorePath), { recursive: true });
      fs.writeFileSync(macroStorePath, JSON.stringify(customMacros, null, 2), 'utf8');
    } catch {}
  }

  function persist() {
    if (!storePath) return;
    try {
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      const serializable = Array.from(tasks.values());
      fs.writeFileSync(storePath, JSON.stringify(serializable, null, 2), 'utf8');
    } catch {
      // Non-fatal persistence failure
    }
  }

  function showNativeNotification(title, body) {
    try {
      if (NotificationClass && typeof NotificationClass.isSupported === 'function' && NotificationClass.isSupported()) {
        const note = new NotificationClass({ title, body, silent: false });
        note.show();
      }
    } catch {
      // Ignore notification issues in headless tests
    }
  }

  function clearTimer(id) {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
  }

  function emitListUpdate() {
    if (typeof onListUpdate === 'function') {
      try {
        onListUpdate(listTasks());
      } catch {
        // Ignore callback errors
      }
    }
  }

  async function fireTask(id) {
    const task = tasks.get(id);
    if (!task) return;
    clearTimer(id);

    const now = Date.now();
    // 30-Minute Early Warning phase (keep main reminder armed afterward)
    if (task.kind === 'reminder' && task.earlyWarnAt && !task.earlyWarned && now < task.triggerAt - 60000) {
      task.earlyWarned = true;
      task.status = 'early_warned';
      persist();
      armTimer(task);
      emitListUpdate();
      const warnTitle = 'JEEVA AI · 30 Min Advance Reminder';
      const warnBody = `30 minute baad (${task.timeLabel || ''}): ${task.message}`;
      showNativeNotification(warnTitle, warnBody);
      if (typeof onFire === 'function') {
        onFire({ ...task, earlyWarning: true, firedAt: now });
      }
      return;
    }

    if (task.kind === 'reminder' && task.retainDays) {
      // Keep date reminders for 90 days so catch-up & history stay available
      task.fired = true;
      task.firedAt = now;
      task.status = 'fired';
      persist();
      emitListUpdate();
    } else {
      tasks.delete(id);
      persist();
      emitListUpdate();
    }

    if (task.kind === 'reminder') {
      showNativeNotification('JEEVA AI Reminder', task.message || 'Scheduled reminder');
      if (typeof onFire === 'function') {
        onFire({ ...task, firedAt: now });
      }
      return;
    }

    if (task.kind === 'delayed_command') {
      showNativeNotification(
        'JEEVA AI Scheduled Action',
        task.description || `Running: ${task.command}`
      );
      let execResult = null;
      if (typeof onExecuteCommand === 'function') {
        try {
          execResult = await onExecuteCommand(task.command, task);
        } catch (err) {
          execResult = { success: false, error: err?.message || 'Execution failed' };
        }
      }
      if (typeof onFire === 'function') {
        onFire({ ...task, firedAt: now, execResult });
      }
    }
  }

  function armTimer(task) {
    clearTimer(task.id);
    const now = Date.now();
    const nextTarget =
      task.earlyWarnAt && !task.earlyWarned && task.earlyWarnAt > now ? task.earlyWarnAt : task.triggerAt;
    const remainingMs = Math.max(50, nextTarget - now);
    const sliceMs = Math.min(TIMER_SLICE_MS, remainingMs);
    const handle = setTimeout(() => {
      const current = tasks.get(task.id);
      if (!current) return;
      const targetNow =
        current.earlyWarnAt && !current.earlyWarned ? current.earlyWarnAt : current.triggerAt;
      if (targetNow - Date.now() > 500) {
        armTimer(current);
      } else {
        fireTask(task.id);
      }
    }, sliceMs);
    if (typeof handle.unref === 'function') handle.unref();
    timers.set(task.id, handle);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    if (!storePath || !fs.existsSync(storePath)) return;

    try {
      const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      if (!Array.isArray(raw)) return;
      const now = Date.now();
      let changed = false;

      for (const item of raw) {
        if (!item || !item.id || !item.triggerAt) continue;
        // Prune items older than 90 days
        if (now - item.triggerAt > RETENTION_MS) {
          changed = true;
          continue;
        }
        if (item.triggerAt <= now) {
          if (item.kind === 'reminder' && item.retainDays) {
            if (!item.fired && !item.missed) {
              item.missed = true;
              item.status = 'missed';
              changed = true;
              showNativeNotification('JEEVA AI Missed Reminder', item.message || 'Scheduled reminder');
              if (typeof onFire === 'function') {
                onFire({ ...item, missed: true, firedAt: now });
              }
            }
            tasks.set(item.id, item);
            continue;
          }
          changed = true;
          // Fire legacy short missed reminders within 12h, never auto-run overdue delayed shell commands on reboot
          if (item.kind === 'reminder' && (now - item.triggerAt) < 12 * 3600 * 1000) {
            showNativeNotification('JEEVA AI Missed Reminder', item.message || 'Scheduled reminder');
            if (typeof onFire === 'function') {
              onFire({ ...item, missed: true, firedAt: now });
            }
          }
          continue;
        }
        tasks.set(item.id, item);
        armTimer(item);
      }
      if (changed) persist();
    } catch {
      // Ignore corrupt store
    }
  }

  function normalizeDelayMinutes(delayMinutes) {
    const mins = Number(delayMinutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      throw new Error('delayMinutes must be greater than 0');
    }
    if (mins > 1440) {
      throw new Error('delayMinutes cannot exceed 1440 (24 hours)');
    }
    return mins;
  }

  function scheduleReminder({ delayMinutes, message }) {
    init();
    const mins = normalizeDelayMinutes(delayMinutes);
    const text = String(message || '').trim() || 'Reminder from JEEVA AI';
    const now = Date.now();
    const task = {
      id: `rem_${crypto.randomBytes(4).toString('hex')}`,
      kind: 'reminder',
      message: text.slice(0, 300),
      triggerAt: now + Math.round(mins * 60 * 1000),
      delayMinutes: mins,
      createdAt: now,
    };
    tasks.set(task.id, task);
    armTimer(task);
    persist();
    emitListUpdate();
    return task;
  }

  function scheduleDelayedCommand({ delayMinutes, command, description = '' }) {
    init();
    const mins = normalizeDelayMinutes(delayMinutes);
    const cmd = String(command || '').trim();
    if (!cmd) throw new Error('command is required for delayed_command');
    const now = Date.now();
    const task = {
      id: `cmd_${crypto.randomBytes(4).toString('hex')}`,
      kind: 'delayed_command',
      command: cmd,
      description: String(description || cmd).slice(0, 200),
      triggerAt: now + Math.round(mins * 60 * 1000),
      delayMinutes: mins,
      createdAt: now,
    };
    tasks.set(task.id, task);
    armTimer(task);
    persist();
    emitListUpdate();
    return task;
  }

  function scheduleDateReminder({
    triggerAt,
    dateKey = '',
    hasExplicitTime = false,
    timeLabel = '',
    message = '',
    earlyWarnMinutes = 30,
  } = {}) {
    init();
    const now = Date.now();
    const targetMs = Number(triggerAt);
    if (!Number.isFinite(targetMs) || targetMs <= now) {
      throw new Error('Reminder date/time must be in the future.');
    }
    if (targetMs - now > MAX_DELAY_MS) {
      throw new Error('Reminder cannot be more than 120 days ahead.');
    }

    const text = String(message || '').trim() || 'Scheduled Reminder';
    const cleanDateKey = dateKey || toLocalDateKey(targetMs);
    const earlyMs = Math.max(0, Number(earlyWarnMinutes) || 0) * 60 * 1000;
    const earlyWarnAt =
      hasExplicitTime && earlyMs > 0 && targetMs - now > earlyMs + 60 * 1000 ? targetMs - earlyMs : null;

    const task = {
      id: `drem_${crypto.randomBytes(4).toString('hex')}`,
      kind: 'reminder',
      retainDays: 90,
      message: text.slice(0, 300),
      triggerAt: targetMs,
      dateKey: cleanDateKey,
      hasExplicitTime: Boolean(hasExplicitTime),
      timeLabel: String(timeLabel || ''),
      earlyWarnAt,
      earlyWarned: false,
      fired: false,
      missed: false,
      acknowledged: false,
      status: 'scheduled',
      createdAt: now,
    };
    tasks.set(task.id, task);
    armTimer(task);
    persist();
    emitListUpdate();
    return task;
  }

  function getAgendaSummary() {
    init();
    const now = Date.now();
    const todayKey = toLocalDateKey(now);
    const todayItems = [];
    const missedItems = [];
    const upcomingItems = [];

    for (const t of tasks.values()) {
      if (t.kind !== 'reminder' || t.acknowledged) continue;
      if (t.triggerAt <= now || t.missed) {
        if (now - t.triggerAt <= RETENTION_MS) {
          missedItems.push(t);
        }
      } else if (t.dateKey === todayKey) {
        todayItems.push(t);
      } else {
        upcomingItems.push(t);
      }
    }

    todayItems.sort((a, b) => a.triggerAt - b.triggerAt);
    missedItems.sort((a, b) => b.triggerAt - a.triggerAt);
    upcomingItems.sort((a, b) => a.triggerAt - b.triggerAt);

    return { todayKey, todayItems, missedItems, upcomingItems };
  }

  function acknowledgeAgenda(idOrAll = 'all') {
    init();
    let updated = 0;
    for (const t of tasks.values()) {
      if (t.kind !== 'reminder') continue;
      if (idOrAll === 'all' || t.id === idOrAll) {
        if (t.fired || t.missed || t.triggerAt <= Date.now()) {
          t.acknowledged = true;
          updated++;
        }
      }
    }
    if (updated > 0) {
      persist();
      emitListUpdate();
    }
    return { acknowledged: updated };
  }

  function listTasks() {
    init();
    const now = Date.now();
    return Array.from(tasks.values())
      .filter((t) => !t.acknowledged && (!t.fired || t.triggerAt > now))
      .sort((a, b) => a.triggerAt - b.triggerAt)
      .map((t) => ({
        ...t,
        remainingSeconds: Math.max(0, Math.round((t.triggerAt - now) / 1000)),
        triggerAtIso: new Date(t.triggerAt).toISOString(),
      }));
  }

  function cancelTask(id) {
    init();
    if (id === 'all') {
      const count = tasks.size;
      for (const key of Array.from(timers.keys())) clearTimer(key);
      tasks.clear();
      persist();
      emitListUpdate();
      return { cancelled: count };
    }
    if (!tasks.has(id)) {
      return { cancelled: 0, error: `Task not found: ${id}` };
    }
    clearTimer(id);
    tasks.delete(id);
    persist();
    emitListUpdate();
    return { cancelled: 1, id };
  }

  function dispose() {
    for (const key of Array.from(timers.keys())) clearTimer(key);
  }

  function listAllMacros() {
    init();
    loadMacros();
    return [...PC_MACROS, ...customMacros];
  }

  function saveMacro({ id = '', name, description = '', trigger = 'manual', condition = 'always', steps = [] } = {}) {
    init();
    loadMacros();
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Workflow name is required');
    if (!Array.isArray(steps) || steps.length === 0) throw new Error('Add at least one action step');

    const macroId = id && String(id).startsWith('custom_') ? id : `custom_${crypto.randomBytes(4).toString('hex')}`;
    const entry = {
      id: macroId,
      custom: true,
      name: cleanName.slice(0, 60),
      description: String(description || `${trigger} -> ${steps.length} step(s)`).slice(0, 180),
      trigger: String(trigger || 'manual'),
      condition: ['always', 'battery_low', 'ram_high', 'cpu_high'].includes(condition) ? condition : 'always',
      steps: steps.slice(0, 10),
      updatedAt: Date.now(),
    };
    const idx = customMacros.findIndex((m) => m.id === macroId);
    if (idx !== -1) customMacros[idx] = entry;
    else customMacros.unshift(entry);
    persistMacros();
    return entry;
  }

  function deleteMacro(id) {
    init();
    loadMacros();
    const before = customMacros.length;
    customMacros = customMacros.filter((m) => m.id !== id);
    if (customMacros.length !== before) persistMacros();
    return { deleted: before - customMacros.length };
  }

  function dryRunMacro(macroInput, stats = {}) {
    const macro = typeof macroInput === 'string'
      ? listAllMacros().find((m) => m.id === macroInput)
      : macroInput;
    if (!macro) throw new Error('Workflow not found');

    const cond = macro.condition || 'always';
    let conditionMet = true;
    let conditionNote = 'Always runs';
    if (cond === 'battery_low') {
      conditionMet = Boolean(stats.batteryPct !== undefined && stats.batteryPct <= 25);
      conditionNote = `Battery <= 25% (${stats.batteryPct ?? 'unknown'}%)`;
    } else if (cond === 'ram_high') {
      conditionMet = Boolean((stats.ramUsedPct || 0) >= 80);
      conditionNote = `RAM >= 80% (${stats.ramUsedPct ?? 0}%)`;
    } else if (cond === 'cpu_high') {
      conditionMet = Boolean((stats.cpuUsedPct || 0) >= 80);
      conditionNote = `CPU >= 80% (${stats.cpuUsedPct ?? 0}%)`;
    }

    const previewSteps = (macro.steps || []).map((st, idx) => ({
      stepNumber: idx + 1,
      type: st.type,
      target: st.app || st.plan || st.mode || st.source || st.command || st.level || '',
      risk: st.type === 'run_command' || st.type === 'kill_process' ? 'high' : 'low',
    }));

    return {
      macroId: macro.id,
      name: macro.name,
      condition: cond,
      conditionMet,
      conditionNote,
      previewSteps,
    };
  }

  return {
    init,
    scheduleReminder,
    scheduleDateReminder,
    getAgendaSummary,
    acknowledgeAgenda,
    scheduleDelayedCommand,
    listTasks,
    cancelTask,
    saveMacro,
    deleteMacro,
    dryRunMacro,
    getAllMacros: listAllMacros,
    dispose,
    macros: PC_MACROS,
  };
}

module.exports = {
  createScheduler,
  PC_MACROS,
};
