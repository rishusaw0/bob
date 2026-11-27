const { spawn } = require('child_process');

function createOfflineVoice({ resolveUnpackedPath, onEvent } = {}) {
  let child = null;
  const activeDictations = new Set();
  let activeAiName = 'Jeeva';
  let status = {
    available: null, // null = untested, true/false once probed
    running: false,
    culture: '',
    reason: '',
    aiName: activeAiName,
  };

  function emitStatus() {
    onEvent?.({ type: 'status', ...status });
  }

  function safeKill(proc) {
    if (!proc) return;
    try {
      proc.removeAllListeners?.();
      proc.stdout?.removeAllListeners?.();
      proc.stderr?.removeAllListeners?.();
      proc.stdin?.end?.();
      proc.kill();
    } catch {}
  }

  function start(aiName = activeAiName) {
    activeAiName = String(aiName || 'Jeeva').trim() || 'Jeeva';
    stop();

    const scriptPath = resolveUnpackedPath('win-voice.ps1');
    status = { ...status, running: true, aiName: activeAiName, reason: '' };
    emitStatus();

    let proc;
    try {
      proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-AiName', activeAiName],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      );
    } catch (err) {
      status = {
        available: false,
        running: false,
        culture: '',
        reason: err?.message || 'Failed to launch PowerShell voice engine',
        aiName: activeAiName,
      };
      emitStatus();
      return { ...status };
    }

    child = proc;
    let buf = '';

    proc.stdin?.on('error', () => {});
    proc.stdout?.on('error', () => {});
    proc.stderr?.on('error', () => {});

    proc.stdout?.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (buf.length > 65536) buf = buf.slice(-16384);
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === 'ready') {
            status = {
              available: true,
              running: true,
              culture: msg.culture || 'en',
              reason: '',
              aiName: msg.aiName || activeAiName,
            };
            emitStatus();
          } else if (msg.type === 'unavailable') {
            status = {
              available: false,
              running: false,
              culture: '',
              reason: msg.reason || 'Unavailable',
              aiName: activeAiName,
            };
            emitStatus();
          } else if (msg.type === 'wake') {
            onEvent?.(msg);
          }
        } catch {
          // Ignore non-JSON diagnostic noise
        }
      }
    });

    proc.stderr?.on('data', () => {});

    proc.on('error', (err) => {
      if (child === proc) child = null;
      status = {
        available: false,
        running: false,
        culture: '',
        reason: err?.message || 'PowerShell voice process error',
        aiName: activeAiName,
      };
      emitStatus();
    });

    proc.on('exit', () => {
      if (child === proc) child = null;
      if (status.running) {
        status = { ...status, running: false };
        emitStatus();
      }
    });

    return { ...status };
  }

  function stop() {
    if (child) {
      const p = child;
      child = null;
      safeKill(p);
    }
    for (const dp of activeDictations) {
      safeKill(dp);
    }
    activeDictations.clear();
    if (status.running) {
      status = { ...status, running: false };
      emitStatus();
    }
    return { ...status };
  }

  function dictateOnce(timeoutSec = 7) {
    const safeSec = Math.max(3, Math.min(15, Number(timeoutSec) || 7));
    const scriptPath = resolveUnpackedPath('win-voice.ps1');
    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let proc = null;

      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        if (proc) activeDictations.delete(proc);
        resolve(payload);
      };

      try {
        proc = spawn(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Mode', 'dictate', '-TimeoutSec', String(safeSec)],
          { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
        );
      } catch {
        return finish({ type: 'dictation', text: '' });
      }

      activeDictations.add(proc);
      const killTimer = setTimeout(() => {
        safeKill(proc);
        finish({ type: 'dictation', text: '', timedOut: true });
      }, (safeSec + 4) * 1000);

      proc.stdout?.on('error', () => {});
      proc.stdout?.on('data', (d) => {
        if (stdout.length < 32768) stdout += d.toString('utf8');
      });
      proc.on('close', () => {
        for (const line of stdout.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const obj = JSON.parse(trimmed);
            if (obj.type === 'dictation') return finish(obj);
          } catch {}
        }
        finish({ type: 'dictation', text: '' });
      });
      proc.on('error', () => finish({ type: 'dictation', text: '' }));
    });
  }

  return {
    start,
    stop,
    dictateOnce,
    getStatus: () => ({ ...status }),
    setAiName: (name) => {
      const clean = String(name || 'Jeeva').trim() || 'Jeeva';
      const changed = clean.toLowerCase() !== activeAiName.toLowerCase();
      activeAiName = clean;
      if (changed && status.running) {
        return start(clean);
      }
      status = { ...status, aiName: clean };
      return { ...status };
    },
  };
}

module.exports = { createOfflineVoice };
