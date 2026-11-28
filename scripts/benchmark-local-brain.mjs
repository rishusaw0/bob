#!/usr/bin/env node
/**
 * JEEVA Local Brain Windows performance benchmark.
 *
 * Usage:
 *   node scripts/benchmark-local-brain.mjs [ollama-model] [runs]
 *
 * Example:
 *   node scripts/benchmark-local-brain.mjs qwen2.5:0.5b 3
 *
 * This intentionally benchmarks CPU-only inference (num_gpu: 0) so low-end
 * systems do not unexpectedly consume shared/old GPU VRAM.
 */
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const baseUrl = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const model = process.argv[2] || 'qwen2.5:0.5b';
const runs = Math.min(5, Math.max(1, Number.parseInt(process.argv[3] || '3', 10) || 3));
const totalGb = os.totalmem() / 1024 ** 3;
const cpuCount = os.cpus().length;
const freeBefore = os.freemem() / 1024 ** 3;
const threads = cpuCount <= 4 || totalGb < 6.5 ? 1 : cpuCount <= 8 || totalGb < 11.5 ? 2 : 3;
const context = totalGb < 6.5 ? 1024 : totalGb < 11.5 ? 1536 : 2048;
const outputTokens = totalGb < 6.5 ? 96 : totalGb < 11.5 ? 128 : 192;

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function getWindowsProcessSnapshot() {
  if (process.platform !== 'win32') return null;
  try {
    const raw = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "$p=Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'ollama|llama' }; $p | Select-Object ProcessName,Id,CPU,WorkingSet64 | ConvertTo-Json -Compress"
    ], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({
      name: p.ProcessName,
      pid: p.Id,
      cpuSeconds: Number(p.CPU) || 0,
      workingSetMb: (Number(p.WorkingSet64) || 0) / 1024 ** 2,
    }));
  } catch {
    return null;
  }
}

async function generate(prompt) {
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(180000),
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      keep_alive: '0s',
      options: {
        num_thread: threads,
        num_ctx: context,
        num_predict: outputTokens,
        num_gpu: 0,
        temperature: 0,
      },
    }),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

console.log('JEEVA Local Brain benchmark');
console.log(JSON.stringify({
  platform: process.platform,
  os: os.release(),
  cpu: os.cpus()[0]?.model || 'unknown',
  logicalCores: cpuCount,
  totalRamGb: round(totalGb),
  freeRamBeforeGb: round(freeBefore),
  model,
  runs,
  cpuThreads: threads,
  contextTokens: context,
  outputTokenLimit: outputTokens,
  gpuOffload: 0,
}, null, 2));

try {
  const tags = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!tags.ok) throw new Error(`Ollama API unavailable: HTTP ${tags.status}`);
  const tagData = await tags.json();
  if (!(tagData.models || []).some((entry) => entry.name === model || entry.name.startsWith(`${model}:`))) {
    throw new Error(`Model "${model}" is not installed. Pull it first with: ollama pull ${model}`);
  }

  // Warm-up is reported separately; it may include model loading.
  const warmStart = performance.now();
  const warm = await generate('Reply with one short word: ready');
  const warmMs = performance.now() - warmStart;
  const samples = [];
  let peakProcessWorkingSetMb = 0;
  let maxProcessCpuSeconds = 0;

  for (let i = 0; i < runs; i++) {
    const before = getWindowsProcessSnapshot() || [];
    const start = performance.now();
    const result = await generate('In one concise sentence, explain how to open a browser on Windows.');
    const elapsedMs = performance.now() - start;
    const after = getWindowsProcessSnapshot() || [];
    const processMemoryMb = after.reduce((sum, p) => sum + p.workingSetMb, 0);
    const processCpuSeconds = after.reduce((sum, p) => sum + p.cpuSeconds, 0);
    const priorCpuSeconds = before.reduce((sum, p) => sum + p.cpuSeconds, 0);
    const cpuDeltaSeconds = Math.max(0, processCpuSeconds - priorCpuSeconds);
    const elapsedSeconds = elapsedMs / 1000;
    const cpuUtilizationPercent = elapsedSeconds > 0
      ? (cpuDeltaSeconds / elapsedSeconds / Math.max(1, cpuCount)) * 100
      : null;
    peakProcessWorkingSetMb = Math.max(peakProcessWorkingSetMb, processMemoryMb);
    maxProcessCpuSeconds = Math.max(maxProcessCpuSeconds, processCpuSeconds);
    const evalSeconds = (Number(result.eval_duration) || 0) / 1e9;
    samples.push({
      elapsedMs: round(elapsedMs, 0),
      ollamaLlamaCpuPercentOfTotalMachine: round(cpuUtilizationPercent),
      loadMs: round((Number(result.load_duration) || 0) / 1e6, 0),
      promptTokens: Number(result.prompt_eval_count) || 0,
      generatedTokens: Number(result.eval_count) || 0,
      tokensPerSecond: evalSeconds > 0 ? round((Number(result.eval_count) || 0) / evalSeconds) : null,
      responseChars: String(result.response || '').length,
      ollamaLlamaProcessRamMb: round(processMemoryMb),
      processCpuSecondsTotal: round(processCpuSeconds),
      processCpuSecondsDelta: round(cpuDeltaSeconds, 3),
    });
  }

  console.log('\nRESULTS');
  console.log(JSON.stringify({
    warmupMs: round(warmMs, 0),
    warmupResponseChars: String(warm.response || '').length,
    samples,
    averageElapsedMs: round(samples.reduce((sum, s) => sum + s.elapsedMs, 0) / samples.length, 0),
    averageTokensPerSecond: round(samples.reduce((sum, s) => sum + (s.tokensPerSecond || 0), 0) / samples.length),
    peakObservedOllamaLlamaWorkingSetMb: round(peakProcessWorkingSetMb),
    freeRamAfterGb: round(os.freemem() / 1024 ** 3),
    gpuOffloadRequested: 0,
    note: 'Process memory is a point-in-time snapshot; Windows Task Manager/GPU Engine counters are recommended for independent validation.',
  }, null, 2));
} catch (error) {
  console.error(`Benchmark failed: ${error.message}`);
  process.exitCode = 1;
}
