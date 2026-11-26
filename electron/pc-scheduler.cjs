const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_DELAY_MS = 24 * 60 * 60 * 1000; // 24 hours max

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
  const tasks = new Map(); // id -> task
  const timers = new Map(); // id -> Timeout
  let initialized = false;

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
    tasks.delete(id);
    persist();
    emitListUpdate();

    if (task.kind === 'reminder') {
      showNativeNotification('JEEVA AI Reminder', task.message || 'Scheduled reminder');
      if (typeof onFire === 'function') {
        onFire({ ...task, firedAt: Date.now() });
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
        onFire({ ...task, firedAt: Date.now(), execResult });
      }
    }
  }

  function armTimer(task) {
    clearTimer(task.id);
    const delayMs = Math.max(50, Math.min(MAX_DELAY_MS, task.triggerAt - Date.now()));
    const handle = setTimeout(() => {
      fireTask(task.id);
    }, delayMs);
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
        if (item.triggerAt <= now) {
          changed = true;
          // Fire missed reminders lightly, but never auto-run overdue delayed shell commands on reboot
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

  function listTasks() {
    init();
    const now = Date.now();
    return Array.from(tasks.values())
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

  return {
    init,
    scheduleReminder,
    scheduleDelayedCommand,
    listTasks,
    cancelTask,
    dispose,
    macros: PC_MACROS,
  };
}

module.exports = {
  createScheduler,
  PC_MACROS,
};
