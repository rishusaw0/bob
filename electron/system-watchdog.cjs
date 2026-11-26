// Proactive Background PC Watchdog: monitors CPU, RAM, Disk, and Battery with smart cooldown & 1-click fixes
const { execFile } = require('child_process');

function readBatteryQuick() {
  return new Promise((resolve) => {
    const cmd = "$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus; if($b){@{pct=[int]$b.EstimatedChargeRemaining;charging=($b.BatteryStatus -eq 2)}|ConvertTo-Json -Compress}";
    execFile('powershell.exe', ['-NoProfile', '-Command', cmd], { timeout: 6000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve(null);
      }
    });
  });
}

function createSystemWatchdog({ actions, NotificationClass = null, onAlert = null, intervalMs = 45000 } = {}) {
  let timer = null;
  let highCpuStreak = 0;
  const lastAlertAt = new Map();
  const COOLDOWN_MS = 15 * 60 * 1000;

  function canEmit(kind) {
    const prev = lastAlertAt.get(kind) || 0;
    if (Date.now() - prev < COOLDOWN_MS) return false;
    lastAlertAt.set(kind, Date.now());
    return true;
  }

  function notifyDesktop(title, body) {
    try {
      if (NotificationClass && typeof NotificationClass.isSupported === 'function' && NotificationClass.isSupported()) {
        new NotificationClass({ title, body, silent: false }).show();
      }
    } catch {}
  }

  async function evaluateTick() {
    if (!actions?.liveStats) return;
    try {
      const stats = await actions.liveStats();
      const bat = await readBatteryQuick();

      if (stats.ramUsedPct >= 90 && canEmit('high_ram')) {
        const alert = {
          id: `wd-ram-${Date.now()}`,
          kind: 'high_ram',
          severity: 'high',
          title: `High RAM Usage (${stats.ramUsedPct}%)`,
          message: `Only ${stats.ramFreeGb} GB RAM free. Close unused heavy apps?`,
          fixAction: { label: 'Inspect Heavy Processes', tab: 'processes' },
          timestamp: Date.now(),
        };
        notifyDesktop(alert.title, alert.message);
        onAlert?.(alert);
      }

      if (typeof stats.cpuUsedPct === 'number' && stats.cpuUsedPct >= 92) {
        highCpuStreak++;
        if (highCpuStreak >= 2 && canEmit('high_cpu')) {
          highCpuStreak = 0;
          const alert = {
            id: `wd-cpu-${Date.now()}`,
            kind: 'high_cpu',
            severity: 'medium',
            title: `CPU Spike (${stats.cpuUsedPct}%)`,
            message: 'Sustained high CPU load detected on your PC.',
            fixAction: { label: 'Check Heavy PIDs', tab: 'processes' },
            timestamp: Date.now(),
          };
          notifyDesktop(alert.title, alert.message);
          onAlert?.(alert);
        }
      } else {
        highCpuStreak = 0;
      }

      const diskFreeNum = parseFloat(stats.diskFreeGb || '99');
      if ((stats.diskUsedPct >= 93 || diskFreeNum < 5) && canEmit('low_disk')) {
        const alert = {
          id: `wd-disk-${Date.now()}`,
          kind: 'low_disk',
          severity: 'high',
          title: `Low Disk Space (${stats.diskFreeGb} GB free)`,
          message: `${stats.diskDrive || 'C:'} drive is ${stats.diskUsedPct}% full. Clean temp files?`,
          fixAction: { label: 'Clean Temp Files', command: 'clean_temp' },
          timestamp: Date.now(),
        };
        notifyDesktop(alert.title, alert.message);
        onAlert?.(alert);
      }

      if (bat && !bat.charging && bat.pct > 0 && bat.pct <= 18 && canEmit('low_battery')) {
        const alert = {
          id: `wd-bat-${Date.now()}`,
          kind: 'low_battery',
          severity: 'high',
          title: `Battery Low (${bat.pct}%)`,
          message: 'Switch to Power Saver mode to extend battery life?',
          fixAction: { label: 'Enable Power Saver', command: 'power_saver' },
          timestamp: Date.now(),
        };
        notifyDesktop(alert.title, alert.message);
        onAlert?.(alert);
      }
    } catch {}
  }

  function start() {
    if (timer) return;
    timer = setInterval(evaluateTick, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, evaluateTick };
}

module.exports = { createSystemWatchdog };
