// Extracted Telemetry & Proactive System Watchdog Hook (keeps App.jsx modular)
import { useState, useEffect, useCallback } from 'react';
import { getSystemAPI } from '../services/bridge';
import { toast } from '../services/toast';

export function useWatchdogAndStats({ isElectron, onOpenControlTab }) {
  const [liveStats, setLiveStats] = useState(null);
  const [watchdogAlert, setWatchdogAlert] = useState(null);

  useEffect(() => {
    if (!isElectron) return;
    let active = true;
    let timerId = null;

    const scheduleNext = () => {
      clearTimeout(timerId);
      if (!active) return;
      // Low-CPU adaptive interval: 20s when visible, 60s when hidden in background tray/notch
      const delayMs = typeof document !== 'undefined' && document.hidden ? 60000 : 20000;
      timerId = setTimeout(poll, delayMs);
    };

    const poll = () => {
      if (!active) return;
      window.electronAPI?.liveStats?.().then((s) => {
        if (active && s) setLiveStats(s);
      }).catch(() => {}).finally(scheduleNext);
    };

    const onVisChange = () => {
      if (active && !document.hidden) poll();
    };
    document.addEventListener('visibilitychange', onVisChange);
    poll();

    const unsubWd = window.electronAPI?.onWatchdogAlert?.((alert) => {
      if (!active || !alert) return;
      setWatchdogAlert(alert);
      toast.warning(`${alert.title} — ${alert.message}`);
    });

    return () => {
      active = false;
      clearTimeout(timerId);
      document.removeEventListener('visibilitychange', onVisChange);
      unsubWd?.();
    };
  }, [isElectron]);

  const applyWatchdogFix = useCallback(async (alert) => {
    const api = getSystemAPI();
    if (!api || !alert?.fixAction) return;
    const fix = alert.fixAction;
    if (fix.tab) {
      onOpenControlTab?.(fix.tab);
      setWatchdogAlert(null);
      return;
    }
    try {
      if (fix.command === 'clean_temp') {
        await api.filePro('clean_temp', '');
        toast.success('Temporary files cleaned up cleanly!');
      } else if (fix.command === 'power_saver') {
        await api.powerProfile('power_saver');
        toast.success('Power Saver mode activated!');
      }
      setWatchdogAlert(null);
    } catch (err) {
      toast.error(err?.message || 'Watchdog fix failed');
    }
  }, [onOpenControlTab]);

  return {
    liveStats,
    watchdogAlert,
    dismissWatchdogAlert: () => setWatchdogAlert(null),
    applyWatchdogFix,
  };
}
