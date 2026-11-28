const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function detectLocalAsrEngines(userDataDir = '') {
  const baseDir = userDataDir
    ? path.join(userDataDir, 'voice-models')
    : path.join(process.env.APPDATA || '', 'jeeva-ai', 'voice-models');
  let whisperExe = '';
  let whisperModel = '';

  try {
    if (baseDir && fs.existsSync(baseDir)) {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      const executables = entries
        .filter((entry) => entry.isFile() && /^(whisper-cli|main)(\.exe)?$/i.test(entry.name))
        .map((entry) => path.join(baseDir, entry.name));
      const models = entries
        .filter((entry) => entry.isFile() && /^ggml-.*\.bin$/i.test(entry.name))
        .map((entry) => path.join(baseDir, entry.name))
        .sort((a, b) => {
          // Prefer multilingual models; *.en.bin models cannot recognize Hindi.
          const aEnglishOnly = /\.en\.bin$/i.test(a) ? 1 : 0;
          const bEnglishOnly = /\.en\.bin$/i.test(b) ? 1 : 0;
          return aEnglishOnly - bEnglishOnly || a.localeCompare(b);
        });
      whisperExe = executables.find((file) => /whisper-cli/i.test(path.basename(file))) || executables[0] || '';
      whisperModel = models[0] || '';
    }
  } catch {}

  const whisperReady = Boolean(whisperExe && whisperModel);
  const modelSupportsHindi = whisperReady && !/\.en\.bin$/i.test(whisperModel);
  return {
    modelsDir: baseDir,
    whisperExe,
    whisperModel,
    whisperReady,
    // Vosk is deliberately not advertised: no Vosk runtime is shipped or wired.
    voskReady: false,
    voskSupported: false,
    modelSupportsHindi,
    supportsFullHindiHinglish: modelSupportsHindi,
    engineType: whisperReady ? 'whisper.cpp' : 'windows-sapi-fallback',
    windowsSapiFallback: true,
    windowsSapiPlatformSupported: process.platform === 'win32',
  };
}

function normalizeAsrLanguage(language) {
  const value = String(language || 'auto').trim().toLowerCase();
  if (value === 'auto' || value === 'hi' || value === 'en') return value;
  if (/^hi[-_]/.test(value)) return 'hi';
  if (/^en[-_]/.test(value)) return 'en';
  return 'auto';
}

function decodePcmWavBase64(input) {
  const raw = String(input || '').trim();
  const encoded = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  if (!encoded || encoded.length > 28 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    return { ok: false, reason: 'Invalid or oversized WAV base64 payload' };
  }
  let buffer;
  try { buffer = Buffer.from(encoded, 'base64'); } catch {
    return { ok: false, reason: 'WAV base64 decoding failed' };
  }
  if (buffer.length < 46 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { ok: false, reason: 'Audio must be a valid RIFF/WAVE file' };
  }
  const format = buffer.readUInt16LE(20);
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  if (format !== 1 || channels !== 1 || sampleRate !== 16000 || bitsPerSample !== 16) {
    return { ok: false, reason: 'Whisper input must be 16 kHz, mono, 16-bit PCM WAV' };
  }
  return { ok: true, buffer };
}

function cleanWhisperOutput(stdout, stderr = '') {
  // Different whisper.cpp builds send diagnostics to either stream; inspect both.
  // Some wrappers serialize process output with literal \n sequences instead of real line breaks.
  const normalizeLines = (value) => String(value || '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n');
  return [normalizeLines(stdout), normalizeLines(stderr)]
    .join('\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^whisper_(init|model|full|print|timings)|^ggml_|^main:\s*(processing|loading|system_info)/i.test(line))
    .map((line) => line.replace(/^\[[^\]]*\]\s*/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createOfflineVoice({ resolveUnpackedPath, onEvent, userDataDir = '', spawnProcess = spawn } = {}) {
  let child = null;
  const activeDictations = new Set();
  let activeAiName = 'Jeeva';
  let intentionalStop = false;
  let crashRetries = 0;
  let restartTimer = null;
  let healthyTimer = null;
  const MAX_CRASH_RETRIES = 3;
  const asrInfo = detectLocalAsrEngines(userDataDir);
  let status = {
    available: null, // null = untested, true/false once probed
    running: false,
    retrying: false,
    retryCount: 0,
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

  function start(aiName = activeAiName, isRetry = false) {
    activeAiName = String(aiName || 'Jeeva').trim() || 'Jeeva';
    if (!isRetry) {
      crashRetries = 0;
    }
    stop(true);
    intentionalStop = false;

    const scriptPath = resolveUnpackedPath('win-voice.ps1');
    status = { ...status, running: true, retrying: false, retryCount: crashRetries, aiName: activeAiName, reason: '' };
    emitStatus();

    let proc;
    try {
      proc = spawnProcess(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-AiName', activeAiName],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      );
    } catch (err) {
      status = {
        ...status,
        available: false,
        running: false,
        retrying: false,
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
            clearTimeout(healthyTimer);
            healthyTimer = setTimeout(() => { crashRetries = 0; }, 30000);
            status = {
              ...status,
              available: true,
              running: true,
              retrying: false,
              retryCount: crashRetries,
              culture: msg.culture || 'en',
              reason: '',
              aiName: msg.aiName || activeAiName,
            };
            emitStatus();
          } else if (msg.type === 'unavailable') {
            intentionalStop = true;
            status = {
              ...status,
              available: false,
              running: false,
              retrying: false,
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

    const scheduleRecovery = (reasonMsg) => {
      if (intentionalStop || status.available === false) return;
      if (crashRetries >= MAX_CRASH_RETRIES) {
        status = {
          ...status,
          running: false,
          retrying: false,
          retryCount: crashRetries,
          reason: `Voice process stopped after ${MAX_CRASH_RETRIES} retries (${reasonMsg})`,
        };
        emitStatus();
        return;
      }
      crashRetries++;
      const delayMs = 1500 * Math.pow(2, crashRetries - 1); // 1.5s, 3s, 6s
      status = {
        ...status,
        running: false,
        retrying: true,
        retryCount: crashRetries,
        reason: `Recovering voice engine (${crashRetries}/${MAX_CRASH_RETRIES})...`,
      };
      emitStatus();
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (!intentionalStop) start(activeAiName, true);
      }, delayMs);
    };

    proc.on('error', (err) => {
      if (child === proc) child = null;
      clearTimeout(healthyTimer);
      scheduleRecovery(err?.message || 'Process spawn error');
    });

    proc.on('exit', (code) => {
      if (child === proc) child = null;
      clearTimeout(healthyTimer);
      if (intentionalStop || status.available === false) {
        if (status.running) {
          status = { ...status, running: false, retrying: false };
          emitStatus();
        }
        return;
      }
      // Recover on ANY unexpected exit (even exit code 0) while voice listening is active
      scheduleRecovery(`unexpected exit code ${code}`);
    });

    return { ...status };
  }

  function stop(preserveRetryState = false) {
    intentionalStop = true;
    clearTimeout(restartTimer);
    restartTimer = null;
    clearTimeout(healthyTimer);
    healthyTimer = null;
    if (!preserveRetryState) crashRetries = 0;
    if (child) {
      const p = child;
      child = null;
      safeKill(p);
    }
    for (const dp of activeDictations) {
      safeKill(dp);
    }
    activeDictations.clear();
    if (status.running || status.retrying) {
      status = { ...status, running: false, retrying: false };
      emitStatus();
    }
    return { ...status };
  }

  function dictateOnce(timeoutSec = 7, { language = 'auto' } = {}) {
    const safeSec = Math.max(3, Math.min(15, Number(timeoutSec) || 7));
    const scriptPath = typeof resolveUnpackedPath === 'function' ? resolveUnpackedPath('win-voice.ps1') : '';
    if (!scriptPath) {
      return Promise.resolve({ type: 'dictation', text: '', engine: 'windows-sapi', fallback: true, reason: 'win-voice.ps1 path unavailable' });
    }
    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let proc = null;
      let killTimer = null;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        if (proc) activeDictations.delete(proc);
        resolve({ engine: 'windows-sapi', fallback: true, ...payload });
      };
      try {
        proc = spawnProcess(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Mode', 'dictate',
            '-TimeoutSec', String(safeSec), '-Culture', normalizeAsrLanguage(language)],
          { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
        );
      } catch (err) {
        return finish({ type: 'dictation', text: '', reason: err?.message || 'Windows SAPI launch failed' });
      }
      if (!proc || typeof proc.on !== 'function') {
        return finish({ type: 'dictation', text: '', reason: 'Windows SAPI process could not start' });
      }
      activeDictations.add(proc);
      killTimer = setTimeout(() => {
        safeKill(proc);
        finish({ type: 'dictation', text: '', timedOut: true, reason: 'Windows SAPI dictation timed out' });
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
            if (obj.type === 'unavailable') {
              return finish({ type: 'dictation', text: '', unavailable: true, reason: obj.reason || 'Windows SAPI recognizer unavailable' });
            }
          } catch {}
        }
        finish({ type: 'dictation', text: '', reason: 'Windows SAPI returned no dictation result' });
      });
      proc.on('error', (err) => finish({ type: 'dictation', text: '', reason: err?.message || 'Windows SAPI process error' }));
    });
  }

  function transcribeAudioBase64(wavBase64, { language = 'auto', timeoutMs = 20000 } = {}) {
    const asr = detectLocalAsrEngines(userDataDir);
    if (!asr.whisperReady) {
      return Promise.resolve({
        ok: false,
        engine: 'whisper.cpp',
        fallbackEngine: 'windows-sapi',
        text: '',
        reason: `Whisper.cpp binary/model not installed in ${asr.modelsDir}; Windows SAPI is available as a separate fallback`,
      });
    }
    const decoded = decodePcmWavBase64(wavBase64);
    if (!decoded.ok) return Promise.resolve({ ok: false, engine: 'whisper.cpp', text: '', reason: decoded.reason });

    const os = require('os');
    let tmpWav = '';
    try {
      tmpWav = path.join(os.tmpdir(), `jeeva-asr-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
      fs.writeFileSync(tmpWav, decoded.buffer, { flag: 'wx' });
    } catch (err) {
      return Promise.resolve({ ok: false, engine: 'whisper.cpp', text: '', reason: err?.message || 'Temporary WAV write failed' });
    }

    const lang = normalizeAsrLanguage(language);
    const timeout = Math.max(1000, Math.min(60000, Number(timeoutMs) || 20000));
    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      let proc = null;
      let timer = null;
      const cleanup = (result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (proc) activeDictations.delete(proc);
        try { if (tmpWav && fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav); } catch {}
        resolve({ engine: 'whisper.cpp', language: lang, ...result });
      };
      try {
        // whisper-cli and legacy main.exe both accept -m/-f/-l/-nt.
        // Do not pass --no-prints: some builds suppress the transcript on stdout.
        proc = spawnProcess(
          asr.whisperExe,
          ['-m', asr.whisperModel, '-f', tmpWav, '-l', lang, '-nt'],
          { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
        );
      } catch (err) {
        return cleanup({ ok: false, text: '', reason: err?.message || 'Whisper.cpp spawn failed' });
      }
      if (!proc || typeof proc.on !== 'function') {
        return cleanup({ ok: false, text: '', reason: 'Whisper.cpp process could not start' });
      }
      activeDictations.add(proc);
      timer = setTimeout(() => {
        safeKill(proc);
        cleanup({ ok: false, text: '', timedOut: true, reason: 'Whisper.cpp transcription timed out' });
      }, timeout);
      proc.stdout?.on('data', (d) => { if (stdout.length < 65536) stdout += d.toString('utf8'); });
      proc.stderr?.on('data', (d) => { if (stderr.length < 16384) stderr += d.toString('utf8'); });
      proc.stdout?.on('error', () => {});
      proc.stderr?.on('error', () => {});
      proc.on('error', (err) => cleanup({ ok: false, text: '', reason: err?.message || 'Whisper.cpp process error' }));
      proc.on('close', (code) => {
        const text = cleanWhisperOutput(stdout, stderr);
        cleanup({
          ok: code === 0 && Boolean(text),
          text: code === 0 ? text : '',
          exitCode: code,
          reason: code === 0 ? (text ? '' : 'Whisper.cpp returned an empty transcript') : `Whisper.cpp exited with code ${code}: ${stderr.trim().slice(0, 500)}`,
        });
      });
    });
  }

  return {
    start,
    stop,
    dictateOnce,
    transcribeAudioBase64,
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

module.exports = { createOfflineVoice, detectLocalAsrEngines, normalizeAsrLanguage, decodePcmWavBase64, cleanWhisperOutput };
