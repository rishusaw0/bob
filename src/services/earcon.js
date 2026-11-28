// Synthesized Cortana-style chimes (earcons) and background-safe Far-Field mic volume meter

let audioCtx = null;
let micStream = null;
let ownsMicStream = false;
let analyser = null;
let meterTimerId = null;
let micSourceNode = null;
let micBoostNode = null;
let micMeterToken = 0;

function getAudioContext() {
  if (!audioCtx || audioCtx.state === 'closed') {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx?.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(freq, startOffset, duration, gainPeak = 0.08) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

export function playWakeChime() {
  try {
    playTone(587.33, 0, 0.14, 0.07);    // D5
    playTone(880.0, 0.09, 0.22, 0.08);  // A5
  } catch {}
}

export function playDoneChime() {
  try {
    playTone(659.25, 0, 0.12, 0.05);    // E5
    playTone(523.25, 0.08, 0.18, 0.04); // C5
  } catch {}
}

export async function startMicMeter(onLevel, externalStream = null, opts = {}) {
  stopMicMeter();
  const token = ++micMeterToken;
  try {
    if (externalStream) {
      micStream = externalStream;
      ownsMicStream = false;
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (token !== micMeterToken) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      micStream = stream;
      ownsMicStream = true;
    }

    if (token !== micMeterToken) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const source = ctx.createMediaStreamSource(micStream);
    const boostNode = ctx.createGain();
    boostNode.gain.value = Number(opts?.boost) > 0 ? Number(opts.boost) : 2.4;
    micSourceNode = source;
    micBoostNode = boostNode;

    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(boostNode);
    boostNode.connect(analyser);

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.fftSize);

    // Use setInterval instead of requestAnimationFrame so minimized/tray windows keep listening cleanly
    const tick = () => {
      if (!analyser) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);

      let freqSum = 0;
      for (let i = 0; i < freqData.length; i++) freqSum += freqData[i];
      const freqLevel = freqSum / (freqData.length * 70);

      let sqSum = 0;
      for (let i = 0; i < timeData.length; i++) {
        const norm = (timeData[i] - 128) / 128;
        sqSum += norm * norm;
      }
      const rms = Math.sqrt(sqSum / timeData.length) * 3.2;

      const combined = Math.min(1, Math.max(freqLevel, rms));
      onLevel(combined);
    };

    meterTimerId = setInterval(tick, 55);
  } catch {
    onLevel(0.15);
  }
}

export function stopMicMeter() {
  micMeterToken++;
  if (meterTimerId) {
    clearInterval(meterTimerId);
    meterTimerId = null;
  }
  if (micSourceNode) {
    try { micSourceNode.disconnect(); } catch {}
    micSourceNode = null;
  }
  if (micBoostNode) {
    try { micBoostNode.disconnect(); } catch {}
    micBoostNode = null;
  }
  analyser = null;
  if (micStream && ownsMicStream) {
    micStream.getTracks().forEach((t) => t.stop());
  }
  micStream = null;
  ownsMicStream = false;
}
