// Tier 3 Gemini Multimodal Live API Bidirectional WebSocket Engine (gemini-3.8-live)
import { GoogleGenAI } from '@google/genai';
import { TOOLS, executeFunctionCall } from './tools.js';
import { getGeminiConnectionInfo } from './gemini.js';
import { createPcmStreamMonitor, pcmFloat32ToInt16Base64 } from './voiceCapture.js';
import { assertCloudAllowed } from './offlineMode.js';

const LIVE_MODEL = 'gemini-3.8-live';

function base64ToInt16(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

/**
 * Opens a real-time full-duplex WebSocket voice session with Gemini 3.8 Live:
 * - Streams 16kHz PCM mic continuously with client spectral VAD
 * - Plays 24kHz PCM model audio chunks through an AnalyserNode for real-time Orb frequency visualization
 * - Clears output queue immediately on server barge-in (`interrupted: true`)
 * - Executes JEEVA PC TOOLS asynchronously via `sendToolResponse`
 */
export async function startLiveVoiceCall({
  aiName = 'Jeeva',
  requestPermission = null,
  onStateChange = () => {},
  onTranscript = () => {},
  onAudioMetrics = () => {},
  onError = () => {},
} = {}) {
  assertCloudAllowed('Gemini Live Voice Call');
  const conn = getGeminiConnectionInfo();
  let apiKeyOrToken = conn.apiKey;
  let apiVersion = 'v1beta';

  if (!apiKeyOrToken && conn.useServerProxy && conn.proxyBaseUrl) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (conn.appToken) headers['x-app-token'] = conn.appToken;
      const res = await fetch(`${conn.proxyBaseUrl}/api/gemini-live-token`, {
        method: 'POST',
        headers,
      });
      const data = await res.json();
      if (res.ok && data?.token) {
        apiKeyOrToken = data.token;
        apiVersion = 'v1alpha';
      } else {
        throw new Error(data?.error || 'Live API ephemeral token unavailable');
      }
    } catch (err) {
      throw new Error(err?.message || 'Live Voice requires a Gemini API key or token-enabled Cloud server.');
    }
  }

  if (!apiKeyOrToken) {
    throw new Error('Add your Gemini API key in Settings to start Gemini Live Bidirectional Audio.');
  }

  onStateChange('connecting');

  const liveClient = new GoogleGenAI({ apiKey: apiKeyOrToken, apiVersion });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const outCtx = new Ctx({ sampleRate: 24000 });
  if (outCtx.state === 'suspended') await outCtx.resume().catch(() => {});

  const outAnalyser = outCtx.createAnalyser();
  outAnalyser.fftSize = 256;
  outAnalyser.connect(outCtx.destination);

  let nextPlayTime = 0;
  let activeSources = [];
  let closed = false;
  let session = null;
  let micMonitor = null;
  let meterTimer = null;
  let lastHeardUser = '';

  const clearAudioQueue = () => {
    for (const src of activeSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {}
    }
    activeSources = [];
    nextPlayTime = outCtx.currentTime;
  };

  const schedulePcm24k = (b64) => {
    if (closed) return;
    if (outCtx.state === 'suspended') outCtx.resume().catch(() => {});
    const int16 = base64ToInt16(b64);
    if (!int16.length) return;
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const audioBuf = outCtx.createBuffer(1, float32.length, 24000);
    audioBuf.copyToChannel(float32, 0);

    const src = outCtx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(outAnalyser);

    const startAt = Math.max(outCtx.currentTime + 0.015, nextPlayTime);
    nextPlayTime = startAt + audioBuf.duration;
    activeSources.push(src);
    src.onended = () => {
      activeSources = activeSources.filter((s) => s !== src);
      if (activeSources.length === 0 && !closed) {
        onStateChange('listening');
      }
    };
    onStateChange('speaking');
    src.start(startAt);
  };

  const freqBuf = new Uint8Array(outAnalyser.frequencyBinCount);
  meterTimer = setInterval(() => {
    if (closed) return;
    if (activeSources.length > 0) {
      outAnalyser.getByteFrequencyData(freqBuf);
      const step = Math.max(1, Math.floor(freqBuf.length / 5));
      const bands = [];
      let total = 0;
      for (let b = 0; b < 5; b++) {
        let sum = 0;
        for (let k = 0; k < step; k++) sum += freqBuf[b * step + k] || 0;
        const val = Math.min(1, sum / (step * 170));
        bands.push(val);
        total += val;
      }
      onAudioMetrics(Math.min(1, total / 5), bands, 'speaking');
    }
  }, 55);

  const liveTools = [
    {
      functionDeclarations: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.parameters,
        behavior: 'NON_BLOCKING',
      })),
    },
  ];

  const closeAll = () => {
    if (closed) return;
    closed = true;
    clearInterval(meterTimer);
    clearAudioQueue();
    if (micMonitor) {
      micMonitor.close();
      micMonitor = null;
    }
    try {
      session?.close?.();
    } catch {}
    session = null;
    try {
      if (outCtx.state !== 'closed') outCtx.close().catch(() => {});
    } catch {}
    onAudioMetrics(0, [0, 0, 0, 0, 0], 'idle');
    onStateChange('idle');
  };

  try {
    session = await liveClient.live.connect({
      model: LIVE_MODEL,
      config: {
        responseModalities: ['AUDIO'],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: {
          parts: [
            {
              text: `You are ${aiName}, a fast Windows PC voice assistant. Speak naturally in the exact language the user uses (English, Hinglish, or Hindi). Execute PC tools cleanly right away when asked, and confirm clearly what was performed.`,
            },
          ],
        },
        tools: liveTools,
      },
      callbacks: {
        onopen: () => {
          if (!closed) onStateChange('listening');
        },
        onmessage: async (msg) => {
          if (closed) return;
          const sc = msg?.serverContent;
          if (sc?.interrupted) {
            clearAudioQueue();
            onStateChange('listening');
          }
          if (sc?.inputTranscription?.text) {
            lastHeardUser = sc.inputTranscription.text;
            onTranscript({ role: 'user', text: lastHeardUser });
          }
          if (sc?.outputTranscription?.text) {
            onTranscript({ role: 'assistant', text: sc.outputTranscription.text });
          }
          if (sc?.modelTurn?.parts) {
            for (const part of sc.modelTurn.parts) {
              if (part.inlineData?.data) {
                schedulePcm24k(part.inlineData.data);
              }
            }
          }
          if (msg?.toolCall?.functionCalls?.length) {
            onStateChange('thinking');
            const functionResponses = [];
            for (const fc of msg.toolCall.functionCalls) {
              const out = await executeFunctionCall(fc.name, fc.args || {}, requestPermission, {
                client: liveClient,
                fromVoice: true,
                userPrompt: lastHeardUser,
              });
              const cleanOut = { ...out };
              delete cleanOut.screenshot;
              delete cleanOut.generatedImage;
              functionResponses.push({
                id: fc.id,
                name: fc.name,
                response: cleanOut,
              });
            }
            if (!closed && session) {
              session.sendToolResponse({ functionResponses });
            }
          }
        },
        onerror: (err) => {
          onError(err?.message || 'Gemini Live WebSocket error');
          closeAll();
        },
        onclose: () => {
          closeAll();
        },
      },
    });

    micMonitor = await createPcmStreamMonitor({
      preRollSeconds: 0.25,
      gainBoost: 3.4,
      onFrame: (pcm16k, metrics) => {
        if (closed || !session) return;
        if (activeSources.length === 0) {
          onAudioMetrics(metrics.level, metrics.bands, 'listening');
        }
        const b64 = pcmFloat32ToInt16Base64(pcm16k);
        try {
          session.sendRealtimeInput({
            audio: { data: b64, mimeType: 'audio/pcm;rate=16000' },
          });
        } catch {}
      },
    });
  } catch (err) {
    closeAll();
    throw err;
  }

  return {
    stop: closeAll,
    sendText: (txt) => {
      if (!closed && session && txt) {
        session.sendRealtimeInput({ text: String(txt) });
      }
    },
  };
}
