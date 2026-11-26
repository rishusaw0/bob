const { spawn } = require('child_process');

function createOfflineVoice({ resolveUnpackedPath, onEvent } = {}) {
  let child = null;
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

  function start(aiName = activeAiName) {
    activeAiName = String(aiName || 'Jeeva').trim() || 'Jeeva';
    stop();

    const scriptPath = resolveUnpackedPath('win-voice.ps1');
    status = { ...status, running: true, aiName: activeAiName, reason: '' };
    emitStatus();

    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-AiName', activeAiName],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    child = proc;

    let buf = '';
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
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

    proc.stderr.on('data', () => {});
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
      try {
        p.kill();
      } catch {}
    }
    if (status.running) {
      status = { ...status, running: false };
      emitStatus();
    }
    return { ...status };
  }

  return {
    start,
    stop,
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
