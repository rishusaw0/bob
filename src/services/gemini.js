// Gemini API Service — Modular Client, Smoke Tester, Multimodal Chat, STT, Image & TTS
import { GoogleGenAI } from '@google/genai';
import { TOOLS, executeFunctionCall, clearToolSessionPermissions } from './tools.js';

let client = null;
let previousInteractionId = null;
let preferredModel = 'gemini-3.5-flash-lite';
let customInstructions = '';
let assistantName = 'Jeeva';
let usingServerProxy = false;

export const SMOKE_CANDIDATE_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-4-hydrogen',
  'gemini-2.5-flash',
];

export function setAiNamePrompt(name) {
  const cleaned = String(name || 'Jeeva').trim();
  assistantName = cleaned || 'Jeeva';
}

function buildSystemPrompt(fromVoice = false, strictVoice = true) {
  const base = `You are ${assistantName} AI, an extremely capable Windows PC Workstation AI assistant created by Roushan Kumar.
You understand Hindi, English, and Hinglish naturally, and reply in the same language as the user using clean, well-spelled words (avoid abbreviated SMS shorthand like "kr" or "v" so voice narration sounds natural and clear).
You have deep PC control tools:
- Apps, Software & Browser: launch/focus/snap/close any app, list/search/install/uninstall software via winget, inspect/click UI controls (ui_automate), control browser tabs/pages & YouTube playback (browser_control — list_tabs, read_page, switch_tab, new_tab, close_tab, youtube_skip_ad).
- Screen, Mouse & Hotkeys: take screenshots to inspect screen visually (includes image dimensions & DPI info), check display resolution & cursor coords (pc_power_tools display_info), click/double-click/right-click/scroll/drag coordinates with coord_space ('pixels' or 'normalized_1000'), send multi-key hotkeys (win+d, ctrl+shift+t, alt+tab), and paste text cleanly (mouse_and_hotkey).
- Hardware & Diagnostics: deep CPU/RAM/GPU/disk/port diagnostics, top resource processes & kill frozen PIDs (system_diagnostics), adjust volume/brightness/media/theme/power plans/Recycle Bin (pc_power_tools).
- Files, Clipboard & Scheduler: browse/search/read PDFs & Office docs, auto-organize folders like Downloads/Desktop by type, zip/unzip/move/rename (file_manager_pro), recall 20-item clipboard history (clipboard_history), and set Windows desktop/spoken reminders or delayed commands (schedule_pc_task).
- Multi-step Workstation Modes: if user asks for "Coding Mode", switch power_plan to high_performance, open vscode, and check diagnostics; for "Night Focus", switch dark theme, lower brightness to 35%, and set balanced power.
ALWAYS use your tools directly when the user asks you to perform an action — do not just explain how to do it manually.
Keep responses clear, helpful, and concise.`;

  const customBlock = customInstructions ? `\n\nUSER CUSTOM PREFERENCES:\n${customInstructions}` : '';
  const voiceBlock =
    fromVoice && strictVoice
      ? `\n\nVOICE COMMAND RULE: The user spoke a direct voice command. Execute requested tool(s) immediately with ZERO filler, ZERO lecturing, and ZERO markdown formatting. Reply in ONE crisp spoken sentence (under 15 words).`
      : '';
  return `${base}${customBlock}${voiceBlock}`;
}

export function isUsingServerProxy() {
  return usingServerProxy;
}

function createTempClient({ apiKey, useServerProxy, proxyBaseUrl, appToken } = {}) {
  if (useServerProxy) {
    const origin = (
      proxyBaseUrl ||
      (typeof window !== 'undefined' && window.location.protocol.startsWith('http') ? window.location.origin : '')
    ).replace(/\/+$/, '');
    if (!origin) {
      throw new Error('Render Cloud Server URL is required for proxy mode');
    }
    const baseUrl = `${origin}/api/gemini`;
    const headers = appToken ? { 'x-app-token': appToken } : {};
    return new GoogleGenAI({
      apiKey: 'server-proxy',
      apiVersion: 'v1beta',
      httpOptions: { baseUrl, headers },
    });
  }
  if (!apiKey) throw new Error('API key is required');
  return new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
}

export function initGemini(apiKey, options = {}) {
  client = createTempClient({
    apiKey,
    useServerProxy: Boolean(options?.useServerProxy),
    proxyBaseUrl: options?.proxyBaseUrl,
    appToken: options?.appToken,
  });
  usingServerProxy = Boolean(options?.useServerProxy);
  previousInteractionId = null;
  return true;
}

/**
 * Verifies live Gemini API connectivity and finds a responsive model automatically if the selected ID is unsupported.
 */
export async function testGeminiConnection({
  apiKey = '',
  useServerProxy = false,
  proxyBaseUrl = '',
  appToken = '',
  model = preferredModel,
} = {}) {
  const startedAt = Date.now();
  let testClient;
  try {
    testClient = createTempClient({ apiKey, useServerProxy, proxyBaseUrl, appToken });
  } catch (err) {
    return { ok: false, error: err?.message || 'Configuration incomplete' };
  }

  const candidates = Array.from(new Set([model, ...SMOKE_CANDIDATE_MODELS].filter(Boolean)));
  let lastError = 'No responsive Gemini model found';

  for (const candidate of candidates) {
    try {
      const res = await testClient.interactions.create({
        model: candidate,
        input: 'Reply with OK',
        store: false,
      });
      return {
        ok: true,
        activeModel: candidate,
        fallbackUsed: candidate !== model,
        latencyMs: Date.now() - startedAt,
        sample: (res?.output_text || 'OK').trim().slice(0, 40),
      };
    } catch (err) {
      lastError = err?.message || String(err);
      // Auth/401/403 should fail immediately instead of probing fallback models
      if (/401|403|API_KEY_INVALID|API key not valid|Owner Server Key locked/i.test(lastError)) {
        return { ok: false, error: lastError, latencyMs: Date.now() - startedAt };
      }
    }
  }
  return { ok: false, error: lastError, latencyMs: Date.now() - startedAt };
}

export function setModel(model) {
  preferredModel = model || 'gemini-3.5-flash-lite';
}

export function setCustomInstructions(text) {
  customInstructions = (text || '').trim();
}

export function resetConversation() {
  previousInteractionId = null;
}

export function clearSessionPermissions() {
  clearToolSessionPermissions();
}

function buildContentBlock(attachment) {
  const base64Data = attachment.dataUrl.split(',')[1];
  const mime = attachment.mimeType || 'application/pdf';
  let type = 'document';
  if (mime.startsWith('image/')) type = 'image';
  else if (mime.startsWith('video/')) type = 'video';
  else if (mime.startsWith('audio/')) type = 'audio';
  return { type, data: base64Data, mime_type: mime };
}

export async function sendMessage(
  text,
  attachment = null,
  onStream = null,
  requestPermission = null,
  onToolUpdate = null,
  options = {}
) {
  if (!client) throw new Error('Gemini not initialized. Please set your API key.');

  const isPdf = attachment?.mimeType === 'application/pdf' || attachment?.name?.toLowerCase().endsWith('.pdf');
  const wantsReadAloud =
    /sunao|read aloud|padh|narrate|bol ke|speak|read this pdf|read pdf/i.test(text || '') || (isPdf && !text?.trim());

  const defaultAttachmentPrompt = isPdf
    ? 'Is PDF document ka poora content saaf aur natural reading style mein padh kar batao (bina markdown symbols ke) taaki user ko sunaya ja sake.'
    : 'Analyze this file in detail.';

  const input = attachment
    ? [
        { type: 'text', text: text?.trim() ? text : defaultAttachmentPrompt },
        buildContentBlock(attachment),
      ]
    : text;

  const fullSystemPrompt = buildSystemPrompt(Boolean(options?.fromVoice), options?.strictVoice !== false);

  const requestConfig = {
    model: preferredModel,
    input,
    tools: TOOLS,
    system_instruction: fullSystemPrompt,
    store: true,
  };

  if (previousInteractionId) {
    requestConfig.previous_interaction_id = previousInteractionId;
  }

  const modelOrder = Array.from(
    new Set([preferredModel, 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-4-hydrogen'])
  );

  function cfgHasPrevId(cfg) {
    return Boolean(cfg.previous_interaction_id);
  }

  async function callWithRetry(config, isStream = false, allowResetPrevId = false) {
    let lastError;
    for (const model of modelOrder) {
      try {
        const cfg = { ...config, model };
        if (isStream) {
          return await client.interactions.create({ ...cfg, stream: true });
        }
        return await client.interactions.create(cfg);
      } catch (err) {
        lastError = err;
        const msg = String(err?.message || err);
        if (
          allowResetPrevId &&
          cfgHasPrevId(config) &&
          (msg.includes('404') || msg.includes('not found') || msg.includes('previous_interaction_id'))
        ) {
          previousInteractionId = null;
          delete config.previous_interaction_id;
          return isStream
            ? await client.interactions.create({ ...config, model, stream: true })
            : await client.interactions.create({ ...config, model });
        }
        const isTransient =
          msg.includes('503') || msg.includes('429') || msg.includes('UNAVAILABLE') || msg.includes('overloaded');
        if (!isTransient) throw err;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw lastError;
  }

  let fullResponse = '';
  let outputImage = null;
  let maxLoops = 6;
  let lastInteractionId = null;
  const executedTools = [];

  while (maxLoops > 0) {
    maxLoops--;
    let funcCallSteps = [];

    if (onStream) {
      let streamedText = '';
      let completedInteraction = null;
      let streamInteractionId = null;
      const streamedCalls = {};

      const isFirstHop = maxLoops === 5;
      const stream = await callWithRetry(requestConfig, true, isFirstHop);

      for await (const event of stream) {
        const evType = event.event_type;
        if (event.interaction?.id) streamInteractionId = event.interaction.id;

        if (evType === 'step.start' && event.step?.type === 'function_call') {
          const step = event.step;
          let initArgs = '';
          let parsedInit = null;
          if (step.arguments) {
            if (typeof step.arguments === 'object') {
              if (Object.keys(step.arguments).length > 0) {
                initArgs = JSON.stringify(step.arguments);
                parsedInit = step.arguments;
              }
            } else if (String(step.arguments).trim() && String(step.arguments).trim() !== '{}') {
              initArgs = String(step.arguments);
            }
          }
          streamedCalls[event.index] = { id: step.id, name: step.name, rawArgs: initArgs, parsedArgs: parsedInit };
        } else if (evType === 'step.delta') {
          if (event.delta?.type === 'text') {
            streamedText += event.delta.text || '';
            onStream(streamedText);
          } else if (event.delta?.type === 'arguments_delta') {
            const call = streamedCalls[event.index];
            if (call) call.rawArgs += event.delta.arguments ?? '';
          } else if (event.delta?.type === 'arguments') {
            const call = streamedCalls[event.index];
            if (call) call.rawArgs += event.delta.partial_arguments ?? '';
          }
        } else if (evType === 'interaction.completed') {
          completedInteraction = event.interaction;
        }
      }

      if (streamInteractionId) lastInteractionId = streamInteractionId;

      const collected = Object.values(streamedCalls).map((c) => {
        let parsed = c.parsedArgs || {};
        if (c.rawArgs) {
          try {
            parsed = JSON.parse(c.rawArgs);
          } catch {
            parsed = c.parsedArgs || {};
          }
        }
        return { type: 'function_call', id: c.id, name: c.name, arguments: parsed };
      });

      const completedCalls = completedInteraction?.steps?.filter((s) => s.type === 'function_call') || [];
      const seenIds = new Set(collected.map((c) => c.id));
      for (const c of completedCalls) {
        if (!seenIds.has(c.id)) collected.push(c);
      }

      funcCallSteps = collected;
      fullResponse = streamedText || completedInteraction?.output_text || fullResponse;
    } else {
      const isFirstHop = maxLoops === 5;
      const currentInteraction = await callWithRetry(requestConfig, false, isFirstHop);
      if (currentInteraction?.id) lastInteractionId = currentInteraction.id;
      fullResponse = currentInteraction.output_text || '';
      funcCallSteps = currentInteraction?.steps?.filter((s) => s.type === 'function_call') || [];
    }

    if (funcCallSteps.length === 0) break;

    const functionResults = [];
    for (const step of funcCallSteps) {
      const toolEntry = { name: step.name, status: 'running', args: step.arguments || {} };
      executedTools.push(toolEntry);
      if (onToolUpdate) onToolUpdate([...executedTools]);

      const result = await executeFunctionCall(step.name, step.arguments || {}, requestPermission, {
        client,
        preferredModel,
        generateImage,
      });
      toolEntry.status = result.error ? 'error' : 'done';
      if (onToolUpdate) onToolUpdate([...executedTools]);

      if (result.screenshot) outputImage = result.screenshot;
      if (result.generatedImage) outputImage = result.generatedImage;

      const cleanResult = { ...result };
      delete cleanResult.screenshot;
      delete cleanResult.generatedImage;

      functionResults.push({
        type: 'function_result',
        call_id: step.id,
        name: step.name,
        result: [{ type: 'text', text: JSON.stringify(cleanResult) }],
      });
    }

    requestConfig.input = functionResults;
    if (lastInteractionId) requestConfig.previous_interaction_id = lastInteractionId;
  }

  if (lastInteractionId) previousInteractionId = lastInteractionId;

  return {
    text: fullResponse,
    image: outputImage,
    autoSpeak: wantsReadAloud,
    tools: executedTools,
  };
}

export async function transcribeAudio(base64Data, mimeType = 'audio/wav', opts = {}) {
  if (!client) throw new Error('Gemini not initialized');
  const wakeName = (opts?.aiName || assistantName || 'Jeeva').trim();
  const isWake = opts?.mode === 'wake';
  const prompt = isWake
    ? `Listen carefully for the wake word "${wakeName}" (e.g. "Hey ${wakeName}") in Hindi, English, or Hinglish. Output ONLY the exact spoken words, or an empty string if only background noise or breathing.`
    : `Transcribe this Hindi, English, or Hinglish PC voice command accurately into clean text (Romanized Hinglish or English). Keep system words like volume, brightness, chrome, install, winget, screenshot, tab, pause, kholo, badhao, kam karo, band karo clear. Output ONLY the spoken command text with zero commentary, or empty string if silent.`;

  const basePreferred = /tts|image|nano-banana/i.test(preferredModel) ? '' : preferredModel;
  const models = Array.from(
    new Set([
      basePreferred,
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash',
      'gemini-4-hydrogen',
      'gemini-2.5-flash',
      'gemini-3.5-transcribe',
    ].filter(Boolean))
  );

  let lastErr;
  for (const model of models) {
    try {
      const payload =
        model === 'gemini-3.5-transcribe'
          ? {
              model,
              input: [{ type: 'audio', data: base64Data, mime_type: mimeType }],
              generation_config: { transcription_config: { mode: 'smart' } },
              store: false,
            }
          : {
              model,
              input: [
                { type: 'text', text: prompt },
                { type: 'audio', data: base64Data, mime_type: mimeType },
              ],
              store: false,
            };
      const interaction = await client.interactions.create(payload);
      return (interaction.output_text || '').trim();
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      if (/401|403|API_KEY_INVALID|API key not valid|Owner Server Key locked/i.test(msg)) {
        throw err;
      }
    }
  }
  throw lastErr || new Error('Audio transcription failed');
}

export async function generateImage(prompt) {
  if (!client) throw new Error('Gemini not initialized');
  const interaction = await client.interactions.create({
    model: 'gemini-nano-banana-2.1',
    input: prompt,
    store: false,
  });
  if (interaction.output_image) {
    return `data:${interaction.output_image.mime_type};base64,${interaction.output_image.data}`;
  }
  throw new Error('No image generated');
}

export async function generateTitle(userMessage) {
  if (!client) return null;
  try {
    const interaction = await client.interactions.create({
      model: 'gemini-3.5-flash-lite',
      input: `Generate a very short title (3-6 words max, no quotes, no markdown) for a conversation that starts with this user message:\n\n"${userMessage.slice(0, 300)}"`,
      store: false,
    });
    const title = (interaction.output_text || '').trim().replace(/^["']|["']$/g, '');
    return title.length > 0 && title.length < 60 ? title : null;
  } catch {
    return null;
  }
}

let regionalVoiceCache = null;

async function getRegionalVoices() {
  if (regionalVoiceCache) return regionalVoiceCache;
  const fallback = { english: 'Charon', hindi: 'Sulafat', hinglish: 'Achird' };
  if (!client?.voices?.list) return fallback;

  try {
    const [hiRes, inRes, enRes] = await Promise.all([
      client.voices.list({ language_code: ['hi-IN'], type: ['prebuilt'], page_size: 10 }).catch(() => null),
      client.voices.list({ language_code: ['en-IN'], type: ['prebuilt'], page_size: 10 }).catch(() => null),
      client.voices.list({ language_code: ['en-US'], contexts: ['Audiobook', 'Conversational'], type: ['prebuilt'], page_size: 10 }).catch(() => null),
    ]);

    regionalVoiceCache = {
      hindi: hiRes?.voices?.[0]?.id || fallback.hindi,
      hinglish: inRes?.voices?.[0]?.id || hiRes?.voices?.[1]?.id || fallback.hinglish,
      english: enRes?.voices?.[0]?.id || fallback.english,
    };
    return regionalVoiceCache;
  } catch {
    return fallback;
  }
}

const VOICE_STYLE_HINTS = {
  english: 'clear, articulate, warm natural English studio narrator',
  hindi: 'warm, expressive, fluent native Hindi speaker with natural Indian Hindi pronunciation',
  hinglish: 'friendly, natural Indian conversational Hinglish speaker, smooth bilingual Hindi and English pronunciation',
};

export async function textToSpeech(text, profile = 'hinglish') {
  if (!client) throw new Error('Gemini not initialized');

  const voices = await getRegionalVoices();
  const voice = voices[profile] || voices.hinglish;
  const style = VOICE_STYLE_HINTS[profile] || VOICE_STYLE_HINTS.hinglish;
  const ttsModels = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];

  let lastErr;
  for (const model of ttsModels) {
    try {
      const interaction = await client.interactions.create({
        model,
        input: [
          {
            type: 'user_input',
            content: [
              {
                type: 'text',
                text,
                annotations: [{ type: 'speech_metadata', style }],
              },
            ],
          },
        ],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice }] },
        store: false,
      });

      if (interaction.output_audio?.data) {
        const mime = interaction.output_audio.mime_type || 'audio/wav';
        return `data:${mime};base64,${interaction.output_audio.data}`;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('No audio generated');
}
