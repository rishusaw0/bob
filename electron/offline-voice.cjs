const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function detectLocalAsrEngines(userDataDir = '') {
  const baseDir = userDataDir
    ? path.join(userDataDir, 'voice-models')
    : path.join(process.env.APPDATA || '', 'jeeva-ai', 'voice-models');
  let whisperExe = '';
  let whisperModel = '';
  let voskModelDir = '';

  try {
    if (baseDir && fs.existsSync(baseDir)) {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && /^(whisper-cli|main)\.exe$/i.test(e.name)) {
          whisperExe = path.join(baseDir, e.name);
        }
        if (e.isFile() && /^ggml-.*\.bin$/i.test(e.name)) {
          whisperModel = path.join(baseDir, e.name);
        }
        if (e.isDirectory() && /^vosk-model-/i.test(e.name)) {
          voskModelDir = path.join(baseDir, e.name);
        }
      }
    }
  } catch {}

  const whisperReady = Boolean(whisperExe && whisperModel);
  const voskReady = Boolean(voskModelDir);
  return {
    modelsDir: baseDir,
    whisperReady,
    voskReady,
    supportsFullHindiHinglish: whisperReady || voskReady,
    engineType: whisperReady ? 'whisper.cpp' : voskReady ? 'vosk' : 'windows-sapi-fallback',
  };
}

function createOfflineVoice({ resolveUnpackedPath, onEvent, userDataDir = '' } = {}) {
  let child = null;
  const activeDictations = new Set();
  let activeAiName = 'Jeeva';
  const asrInfo = detectLocalAsrEngines(userDataDir);
  let status = {
    available: null, // null = untested, true/false once probed
    running: false,
    culture: '',
    reason: '',
    aiName: activeAiName,
    engineType: asrInfo.engineType,
    supportsFullHindiHinglish: asrInfo.supportsFullHindiHinglish,
    modelsDir: asrInfo.modelsDir,
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
        ...status,
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
              ...status,
              available: true,
              running: true,
              culture: msg.culture || 'en',
              reason: '',
              aiName: msg.aiName || activeAiName,
            };
            emitStatus();
          } else if (msg.type === 'unavailable') {
            status = {
              ...status,
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
        ...status,
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
    const scriptPath = typeof resolveUnpackedPath === 'function' ? resolveUnpackedPath('win-voice.ps1') : '';
    if (!scriptPath) {
      return Promise.resolve({ type: 'dictation', text: '', reason: 'win-voice.ps1 path unavailable' });
    }
    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let proc = null;
      let killTimer = null;

      const finish = (payload) => {
        if (settled) return;
        settled = true;
        if (killTimer) {
          clearTimeout(killTimer);
          killTimer = null;
        }
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

      if (!proc || typeof proc.on !== 'function') {
        return finish({ type: 'dictation', text: '' });
      }

      activeDictations.add(proc);
      killTimer = setTimeout(() => {
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
    getStatus: () => ({ ...status, ...detectLocalAsrEngines(userDataDir) }),
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

module.exports = { createOfflineVoice, detectLocalAsrEngines };
