// Low-End Friendly Local AI Brain Manager (Ollama + GGUF llama-server Sidecar with Idle Unload & RAM Guard)
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const { spawn, execFile } = require('node:child_process');

let cachedGpu = { gpuName: 'Unknown', gpuVramGb: 0, checked: false };
if (process.platform === 'win32') {
  try {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Select-Object -First 1 Name, AdapterRAM | ConvertTo-Json -Compress'],
      { timeout: 3000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return;
        try {
          const parsed = JSON.parse(stdout.trim());
          cachedGpu = {
            gpuName: parsed?.Name || 'GPU',
            gpuVramGb: parsed?.AdapterRAM ? Number((Number(parsed.AdapterRAM) / 1073741824).toFixed(1)) : 0,
            checked: true,
          };
        } catch {}
      }
    );
  } catch {}
}

const IDLE_UNLOAD_MS = 2 * 60 * 1000; // Unload local model from RAM after 2 minutes idle
const MIN_FREE_RAM_GB = 1.2; // Prevent system hang if free RAM drops below 1.2 GB

const LOW_END_MODELS = [
  {
    id: 'qwen2.5:0.5b',
    label: 'Qwen 2.5 0.5B Ultra-Light (~420 MB)',
    tier: '4-6GB RAM',
    sizeMb: 420,
    minTotalGb: 3.5,
    description: 'Sabse halka model — old i3 / 4GB RAM PCs par bina lag ke chalta hai.',
  },
  {
    id: 'gemma3:1b',
    label: 'Gemma 3 1B Bilingual (~815 MB)',
    tier: '6-8GB RAM',
    sizeMb: 815,
    minTotalGb: 5.5,
    description: 'Fast Google edge model — smooth English + Hinglish chat & summaries.',
  },
  {
    id: 'qwen2.5:1.5b',
    label: 'Qwen 2.5 1.5B Balanced (~980 MB · Recommended)',
    tier: '8GB+ RAM',
    sizeMb: 980,
    minTotalGb: 7.0,
    description: 'Best low-end choice — Hinglish Q&A, email drafting aur accurate JSON tools.',
  },
  {
    id: 'qwen2.5:3b',
    label: 'Qwen 2.5 3B Smart (~1.9 GB)',
    tier: '12GB+ RAM',
    sizeMb: 1900,
    minTotalGb: 11.0,
    description: 'Mid-spec PCs ke liye — deep summarization & stronger tool reasoning.',
  },
];

function httpJsonRequest(urlStr, method = 'GET', bodyObj = null, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === 'https:' ? https : http;
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        timeout: timeoutMs,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : undefined,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 160)}`));
          }
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            resolve({ raw });
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function detectHardwareProfile() {
  const totalGb = Number((os.totalmem() / 1024 ** 3).toFixed(1));
  const freeGb = Number((os.freemem() / 1024 ** 3).toFixed(1));
  const cpus = os.cpus() || [];
  const cpuCores = cpus.length || 4;
  // Cap at 50% CPU cores (min 2, max 6) so foreground apps stay snappy on low-end PCs
  const safeThreads = Math.max(2, Math.min(6, Math.floor(cpuCores / 2)));

  let recommendedModel = 'qwen2.5:1.5b';
  let hardwareTier = 'mid';
  if (totalGb < 6.5) {
    recommendedModel = 'qwen2.5:0.5b';
    hardwareTier = 'ultra-low';
  } else if (totalGb < 11.5 && cachedGpu.gpuVramGb < 4) {
    recommendedModel = 'qwen2.5:1.5b';
    hardwareTier = 'low-end';
  } else {
    recommendedModel = 'qwen2.5:3b';
    hardwareTier = 'mid-high';
  }

  return {
    totalGb,
    freeGb,
    cpuCores,
    safeThreads,
    cpuModel: cpus[0]?.model || 'CPU',
    gpuName: cachedGpu.gpuName,
    gpuVramGb: cachedGpu.gpuVramGb,
    hardwareTier,
    recommendedModel,
    lowRamRisk: freeGb < MIN_FREE_RAM_GB,
  };
}

function createLocalBrainManager({ userDataDir, onProgress = null } = {}) {
  const brainDir = path.join(userDataDir || os.tmpdir(), 'local-brain');
  const configPath = path.join(brainDir, 'brain-config.json');
  const modelsDir = path.join(brainDir, 'models');
  let sidecarProc = null;
  let idleTimer = null;
  let pullInProgress = false;

  function loadConfig() {
    try {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return {
        ollamaUrl: saved.ollamaUrl || 'http://127.0.0.1:11434',
        sidecarPort: Number(saved.sidecarPort) || 11435,
        preferredModel: saved.preferredModel || detectHardwareProfile().recommendedModel,
        customEndpoint: saved.customEndpoint || '',
        maxThreads: Number(saved.maxThreads) || detectHardwareProfile().safeThreads,
        lowRamGuard: saved.lowRamGuard !== false,
      };
    } catch {
      const hw = detectHardwareProfile();
      return {
        ollamaUrl: 'http://127.0.0.1:11434',
        sidecarPort: 11435,
        preferredModel: hw.recommendedModel,
        customEndpoint: '',
        maxThreads: hw.safeThreads,
        lowRamGuard: true,
      };
    }
  }

  function saveConfig(patch) {
    fs.mkdirSync(brainDir, { recursive: true });
    const next = { ...loadConfig(), ...(patch || {}) };
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  function listSidecarFiles() {
    const serverExe = path.join(brainDir, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
    const ggufs = fs.existsSync(modelsDir)
      ? fs.readdirSync(modelsDir).filter((f) => /\.gguf$/i.test(f))
      : [];
    return { serverExeExists: fs.existsSync(serverExe), serverExe, ggufs };
  }

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    if (sidecarProc) {
      idleTimer = setTimeout(() => {
        stopSidecar();
      }, IDLE_UNLOAD_MS);
    }
  }

  function stopSidecar() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (sidecarProc) {
      try {
        sidecarProc.kill();
      } catch {}
      sidecarProc = null;
    }
    return { ok: true, stopped: true };
  }

  async function detectOllama(ollamaUrl) {
    try {
      const data = await httpJsonRequest(`${ollamaUrl.replace(/\/+$/, '')}/api/tags`, 'GET', null, 1800);
      const installed = Array.isArray(data?.models) ? data.models.map((m) => m.name) : [];
      return { running: true, installed };
    } catch {
      return { running: false, installed: [] };
    }
  }

  async function ensureSidecarRunning(cfg) {
    const { serverExeExists, serverExe, ggufs } = listSidecarFiles();
    if (!serverExeExists || ggufs.length === 0) return false;

    const sidecarHealth = `http://127.0.0.1:${cfg.sidecarPort}/health`;
    try {
      await httpJsonRequest(sidecarHealth, 'GET', null, 1000);
      resetIdleTimer();
      return true;
    } catch {}

    const modelPath = path.join(modelsDir, ggufs[0]);
    sidecarProc = spawn(
      serverExe,
      ['-m', modelPath, '-t', String(cfg.maxThreads), '-c', '2048', '--host', '127.0.0.1', '--port', String(cfg.sidecarPort)],
      { stdio: 'ignore', windowsHide: true }
    );
    sidecarProc.on('exit', () => {
      sidecarProc = null;
    });

    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        await httpJsonRequest(sidecarHealth, 'GET', null, 800);
        resetIdleTimer();
        return true;
      } catch {}
    }
    return false;
  }

  async function getStatus() {
    const hw = detectHardwareProfile();
    const cfg = loadConfig();
    const ollama = await detectOllama(cfg.ollamaUrl);
    const sidecar = listSidecarFiles();

    let activeRuntime = 'rules-only';
    let activeModel = 'Semantic Hinglish Intent Brain (<5 MB)';
    if (ollama.running && ollama.installed.length > 0) {
      activeRuntime = 'ollama';
      activeModel = ollama.installed.includes(cfg.preferredModel) ? cfg.preferredModel : ollama.installed[0];
    } else if (cfg.customEndpoint) {
      activeRuntime = 'custom-openai';
      activeModel = cfg.preferredModel;
    } else if (sidecar.serverExeExists && sidecar.ggufs.length > 0) {
      activeRuntime = sidecarProc ? 'llama-sidecar-hot' : 'llama-sidecar-standby';
      activeModel = sidecar.ggufs[0];
    }

    return {
      ok: true,
      hardware: hw,
      config: cfg,
      ollama,
      sidecar: {
        ready: sidecar.serverExeExists && sidecar.ggufs.length > 0,
        running: Boolean(sidecarProc),
        models: sidecar.ggufs,
      },
      catalog: LOW_END_MODELS,
      activeRuntime,
      activeModel,
      pullInProgress,
    };
  }

  async function pullOllamaModel(modelName) {
    const cfg = loadConfig();
    const target = String(modelName || cfg.preferredModel || 'qwen2.5:1.5b').trim();
    const ollama = await detectOllama(cfg.ollamaUrl);
    if (!ollama.running) {
      return { ok: false, error: 'Ollama background service nahi chal raha. Pehle Ollama install/open karein.' };
    }

    pullInProgress = true;
    onProgress?.({ stage: 'pulling', model: target, pct: 0, status: `Pulling ${target}...` });
    try {
      const parsed = new URL(`${cfg.ollamaUrl.replace(/\/+$/, '')}/api/pull`);
      const resData = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({ name: target, stream: true });
        const req = http.request(
          {
            hostname: parsed.hostname,
            port: parsed.port || 11434,
            path: parsed.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          },
          (res) => {
            let buffer = '';
            res.on('data', (chunk) => {
              buffer += chunk.toString('utf8');
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const obj = JSON.parse(line);
                  const pct =
                    obj.total && obj.completed ? Math.min(100, Math.round((obj.completed / obj.total) * 100)) : null;
                  onProgress?.({ stage: 'pulling', model: target, pct, status: obj.status || 'Downloading...' });
                  if (obj.error) reject(new Error(obj.error));
                } catch {}
              }
            });
            res.on('end', () => resolve({ ok: true, model: target }));
          }
        );
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
      saveConfig({ preferredModel: target });
      onProgress?.({ stage: 'done', model: target, pct: 100, status: `${target} ready!` });
      return resData;
    } catch (err) {
      onProgress?.({ stage: 'error', model: target, status: err?.message || 'Download failed' });
      return { ok: false, error: err?.message || 'Download failed' };
    } finally {
      pullInProgress = false;
    }
  }

  async function installOllamaViaWinget() {
    if (process.platform !== 'win32') return { ok: false, error: 'Winget install Windows par hi available hai.' };
    onProgress?.({ stage: 'installing', status: 'Installing Ollama via Windows winget...' });
    return new Promise((resolve) => {
      const child = spawn('winget', ['install', '-e', '--id', 'Ollama.Ollama', '--accept-source-agreements', '--accept-package-agreements'], {
        windowsHide: true,
      });
      let out = '';
      child.stdout?.on('data', (d) => { out += d.toString(); });
      child.stderr?.on('data', (d) => { out += d.toString(); });
      child.on('close', (code) => {
        if (code === 0) {
          onProgress?.({ stage: 'installed', status: 'Ollama installed! Starting service...' });
          try {
            spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
          } catch {}
          resolve({ ok: true, message: 'Ollama installed cleanly!' });
        } else {
          resolve({ ok: false, error: out.slice(-240) || `winget exited with ${code}` });
        }
      });
      child.on('error', (err) => resolve({ ok: false, error: err.message }));
    });
  }

  async function setup(action, payload = {}) {
    if (action === 'save_config') {
      return { ok: true, config: saveConfig(payload) };
    }
    if (action === 'pull_model') {
      return pullOllamaModel(payload?.model);
    }
    if (action === 'install_ollama') {
      return installOllamaViaWinget();
    }
    if (action === 'stop_model') {
      const cfg = loadConfig();
      stopSidecar();
      // Ask Ollama to unload model cleanly too
      try {
        await httpJsonRequest(`${cfg.ollamaUrl.replace(/\/+$/, '')}/api/generate`, 'POST', {
          model: payload?.model || cfg.preferredModel,
          keep_alive: 0,
        }, 2500);
      } catch {}
      return { ok: true, unloaded: true };
    }
    return { ok: false, error: `Unknown setup action: ${action}` };
  }

  async function chat({ messages = [], tools = [], temperature = 0.3, maxTokens = 450 } = {}) {
    const hw = detectHardwareProfile();
    const cfg = loadConfig();

    if (cfg.lowRamGuard && hw.lowRamRisk) {
      return {
        ok: false,
        lowRamGuard: true,
        error: `Low Free RAM (${hw.freeGb} GB free) — laptop hang hone se bachane ke liye heavy local model pause kiya gaya.`,
      };
    }

    const startedAt = Date.now();
    // 1. Try Ollama
    const ollama = await detectOllama(cfg.ollamaUrl);
    if (ollama.running && ollama.installed.length > 0) {
      const model = ollama.installed.includes(cfg.preferredModel) ? cfg.preferredModel : ollama.installed[0];
      const body = {
        model,
        messages,
        stream: false,
        keep_alive: '2m',
        options: {
          num_thread: cfg.maxThreads,
          num_ctx: 2048,
          num_predict: maxTokens,
          temperature,
        },
      };
      if (Array.isArray(tools) && tools.length > 0) {
        body.tools = tools;
      }
      try {
        const res = await httpJsonRequest(`${cfg.ollamaUrl.replace(/\/+$/, '')}/api/chat`, 'POST', body, 35000);
        return {
          ok: true,
          runtime: 'ollama',
          model,
          latencyMs: Date.now() - startedAt,
          message: res?.message || { role: 'assistant', content: '' },
        };
      } catch (err) {
        // Retry without native tools param in case tiny GGUF template doesn't support native tool_calls
        if (body.tools) {
          delete body.tools;
          try {
            const retryRes = await httpJsonRequest(`${cfg.ollamaUrl.replace(/\/+$/, '')}/api/chat`, 'POST', body, 35000);
            return {
              ok: true,
              runtime: 'ollama-json',
              model,
              latencyMs: Date.now() - startedAt,
              message: retryRes?.message || { role: 'assistant', content: '' },
            };
          } catch (retryErr) {
            return { ok: false, error: retryErr?.message || 'Ollama chat failed' };
          }
        }
        return { ok: false, error: err?.message || 'Ollama chat failed' };
      }
    }

    // 2. Try Custom OpenAI endpoint OR GGUF Sidecar
    const openAiBase = cfg.customEndpoint
      ? cfg.customEndpoint.replace(/\/+$/, '')
      : (await ensureSidecarRunning(cfg))
        ? `http://127.0.0.1:${cfg.sidecarPort}/v1`
        : '';

    if (openAiBase) {
      const res = await httpJsonRequest(
        `${openAiBase}/chat/completions`,
        'POST',
        {
          model: cfg.preferredModel,
          messages,
          temperature,
          max_tokens: maxTokens,
        },
        35000
      );
      resetIdleTimer();
      const choiceMsg = res?.choices?.[0]?.message || { role: 'assistant', content: '' };
      return {
        ok: true,
        runtime: cfg.customEndpoint ? 'custom-openai' : 'llama-sidecar',
        model: cfg.preferredModel,
        latencyMs: Date.now() - startedAt,
        message: choiceMsg,
      };
    }

    return {
      ok: false,
      noLocalModel: true,
      error: 'Local SLM model installed/running nahi hai (Rules & Semantic Intent Brain active hain).',
    };
  }

  return {
    getStatus,
    setup,
    chat,
    stopSidecar,
  };
}

module.exports = {
  LOW_END_MODELS,
  detectHardwareProfile,
  createLocalBrainManager,
};
