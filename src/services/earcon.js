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

const EARCONS_KEY = 'jeeva_earcons_enabled';

export function isEarconsEnabled() {
  try {
    return typeof localStorage === 'undefined' ? true : localStorage.getItem(EARCONS_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setEarconsEnabled(enabled) {
  const next = Boolean(enabled);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(EARCONS_KEY, String(next));
  } catch {}
  return next;
}

export function playWakeChime() {
  if (!isEarconsEnabled()) return;
  try {
    playTone(587.33, 0, 0.13, 0.065);   // D5
    playTone(880.0, 0.075, 0.2, 0.075); // A5
    playTone(1174.66, 0.14, 0.18, 0.035); // D6 subtle harmonic sparkle
  } catch {}
}

export function playDoneChime() {
  if (!isEarconsEnabled()) return;
  try {
    playTone(659.25, 0, 0.09, 0.045);   // E5 crisp tick
    playTone(987.77, 0.06, 0.14, 0.04); // B5 soft resolve
  } catch {}
}

export function playReminderChime() {
  if (!isEarconsEnabled()) return;
  try {
    playTone(659.25, 0, 0.18, 0.07);    // E5
    playTone(830.61, 0.13, 0.2, 0.075); // G#5
    playTone(987.77, 0.26, 0.32, 0.08); // B5 crystal bell
  } catch {}
}

export function playPermissionChime() {
  if (!isEarconsEnabled()) return;
  try {
    playTone(783.99, 0, 0.12, 0.055);   // G5
    playTone(659.25, 0.1, 0.18, 0.05);  // E5 gentle attention tone
  } catch {}
}

export function playErrorChime() {
  if (!isEarconsEnabled()) return;
  try {
    playTone(260, 0, 0.11, 0.05);
    playTone(205, 0.09, 0.16, 0.045);
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
