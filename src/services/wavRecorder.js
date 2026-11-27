// Pure-JS Microphone WAV Recorder (16kHz Mono PCM -> RIFF/WAVE base64)
// Guarantees valid audio/wav output for Gemini Voice Replication (ai.voices.create).

function writeAscii(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export function encodeWavBase64(floatSamples, sampleRate = 16000) {
  const numSamples = floatSamples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, floatSamples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  const base64 = btoa(binary);
  const blob = new Blob([buffer], { type: 'audio/wav' });
  const previewUrl = URL.createObjectURL(blob);
  return { base64, previewUrl, durationSec: Number((numSamples / sampleRate).toFixed(1)) };
}

function downsampleBuffer(input, inputRate, targetRate = 16000) {
  if (inputRate === targetRate) return input;
  const ratio = inputRate / targetRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

export async function startWavRecording({ onLevel, onTick, maxSeconds = 25 } = {}) {
  if (!navigator?.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not supported in this browser.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  if (ctx.state === 'suspended') await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  let stopped = false;
  const startedAt = Date.now();

  const tickTimer = setInterval(() => {
    if (stopped) return;
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    onTick?.(sec);
    if (sec >= maxSeconds) stop();
  }, 250);

  processor.onaudioprocess = (ev) => {
    if (stopped) return;
    const data = ev.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    let sq = 0;
    for (let i = 0; i < data.length; i++) sq += data[i] * data[i];
    onLevel?.(Math.min(1, Math.sqrt(sq / data.length) * 4));
  };

  source.connect(processor);
  processor.connect(ctx.destination);

  const stop = () => {
    if (stopped) return null;
    stopped = true;
    clearInterval(tickTimer);
    try {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    } catch {}

    const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
    const merged = new Float32Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
      merged.set(c, pos);
      pos += c.length;
    }
    const downsampled = downsampleBuffer(merged, ctx.sampleRate || 48000, 16000);
    return encodeWavBase64(downsampled, 16000);
  };

  return { stop };
}
