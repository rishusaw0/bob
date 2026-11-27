// Gemini API Service — Modular Client, Smoke Tester, Multimodal Chat, STT, Image & TTS
import { GoogleGenAI } from '@google/genai';
import { TOOLS, executeFunctionCall, clearToolSessionPermissions } from './tools.js';
import { recallRelevantMemories } from './memoryRag.js';
import { getReplyStyle } from './userPrefs.js';

let client = null;
let previousInteractionId = null;
let preferredModel = 'gemini-3.5-flash-lite';
let customInstructions = '';
let assistantName = 'Jeeva';
let usingServerProxy = false;
let lastInitOptions = { apiKey: '', useServerProxy: false, proxyBaseUrl: '', appToken: '' };

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
SENSITIVE ACTIONS RULE: When the user asks to install, uninstall, or update software, change Windows settings, force-close apps, delete files, or run system power/terminal actions, call the corresponding tool cleanly right away — JEEVA's voice and chat permission guard will ask the user for confirmation before execution.
LANGUAGE & CONFIRMATION RULE: Always reply in the SAME language and script style the user used (if English -> clear English; if Romanized Hinglish -> natural Hinglish; if Devanagari Hindi -> Hindi). After executing any tool, explicitly tell the user BOTH that the task is done AND exactly what action was performed (e.g. "Maine Chrome khol diya hai" or "I have set volume to 60%"), never just a vague "Done".`;

  const styleHint =
    getReplyStyle() === 'detailed'
      ? '\n\nRESPONSE STYLE: Provide clear step-by-step explanations in plain everyday language (avoid raw code syntax unless the user asks for code).'
      : '\n\nRESPONSE STYLE: Keep answers concise, warm, and easy to understand in plain everyday language (avoid developer jargon or raw code names unless explicitly asked).';
  const customBlock = customInstructions ? `\n\nUSER CUSTOM PREFERENCES:\n${customInstructions}` : '';
  const voiceBlock =
    fromVoice && strictVoice
      ? `\n\nVOICE COMMAND RULE: The user spoke a direct voice command. Execute requested tool(s) immediately with ZERO filler, ZERO lecturing, and ZERO markdown formatting. Reply in ONE clear spoken sentence in the user's exact language confirming that the action was completed and exactly what was done.`
      : '';
  return `${base}${styleHint}${customBlock}${voiceBlock}`;
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
  lastInitOptions = {
    apiKey: String(apiKey || '').trim(),
    useServerProxy: Boolean(options?.useServerProxy),
    proxyBaseUrl: (options?.proxyBaseUrl || '').trim().replace(/\/+$/, ''),
    appToken: options?.appToken || '',
  };
  client = createTempClient(lastInitOptions);
  usingServerProxy = lastInitOptions.useServerProxy;
  previousInteractionId = null;
  return true;
}

export function getGeminiConnectionInfo() {
  const origin =
    lastInitOptions.proxyBaseUrl ||
    (typeof window !== 'undefined' && window.location.protocol.startsWith('http') ? window.location.origin : '');
  return {
    ...lastInitOptions,
    proxyBaseUrl: origin.replace(/\/+$/, ''),
  };
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

  let memoryContext = '';
  if (typeof text === 'string' && text.trim()) {
    const recalled = await recallRelevantMemories(text, 4).catch(() => []);
    if (recalled.length > 0) {
      memoryContext =
        '\n\nRECALLED USER MEMORY (Local RAG):\n' +
        recalled.map((m) => `- [${m.category}] ${m.content}`).join('\n');
    }
  }

  const digestBlock = options?.historyDigest ? `\n\n${options.historyDigest}` : '';
  const fullSystemPrompt = buildSystemPrompt(Boolean(options?.fromVoice), options?.strictVoice !== false) + memoryContext + digestBlock;

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
        fromVoice: Boolean(options?.fromVoice),
        userPrompt: typeof text === 'string' ? text : '',
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
    new Set([basePreferred, 'gemini-3.5-flash-lite', 'gemini-2.5-flash'].filter(Boolean))
  ).slice(0, 3);

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

let regionalVoiceCache = new Map();

export function isGeminiReady() {
  return Boolean(client);
}

export function resetRegionalVoiceCache() {
  regionalVoiceCache.clear();
}

const PERSONA_VOICES = {
  natural_warm: {
    indian: { english: 'Achird', hindi: 'Sulafat', hinglish: 'Achird' },
    global: { english: 'Aoede', hindi: 'Sulafat', hinglish: 'Achird' },
  },
  calm_pro: {
    indian: { english: 'Charon', hindi: 'Orus', hinglish: 'Charon' },
    global: { english: 'Charon', hindi: 'Orus', hinglish: 'Charon' },
  },
  crisp_studio: {
    indian: { english: 'Sulafat', hindi: 'Sulafat', hinglish: 'Aoede' },
    global: { english: 'Aoede', hindi: 'Sulafat', hinglish: 'Aoede' },
  },
  conversational: {
    indian: { english: 'Puck', hindi: 'Achird', hinglish: 'Puck' },
    global: { english: 'Puck', hindi: 'Achird', hinglish: 'Puck' },
  },
};

async function getRegionalVoices(accent = 'indian', persona = 'natural_warm') {
  const key = accent === 'global' ? 'global' : 'indian';
  const personaKey = PERSONA_VOICES[persona] ? persona : 'natural_warm';
  const personaFallback = PERSONA_VOICES[personaKey][key];
  if (personaKey !== 'natural_warm') return personaFallback;

  if (regionalVoiceCache.has(key)) return regionalVoiceCache.get(key);
  const fallback = personaFallback;
  if (!client?.voices?.list) return fallback;

  // Background refresh without blocking first spoken word latency (0ms stall)
  if (!regionalVoiceCache.has(`${key}_warming`)) {
    regionalVoiceCache.set(`${key}_warming`, fallback);
    Promise.all([
      client.voices.list({ language_code: ['hi-IN'], type: ['prebuilt'], page_size: 6 }).catch(() => null),
      client.voices.list({ language_code: ['en-IN'], type: ['prebuilt'], page_size: 6 }).catch(() => null),
      client.voices.list({ language_code: ['en-US'], contexts: ['Conversational'], type: ['prebuilt'], page_size: 6 }).catch(() => null),
    ])
      .then(([hiRes, inRes, enRes]) => {
        regionalVoiceCache.set(key, {
          hindi: hiRes?.voices?.[0]?.id || fallback.hindi,
          hinglish: inRes?.voices?.[0]?.id || hiRes?.voices?.[1]?.id || fallback.hinglish,
          english: key === 'indian' ? inRes?.voices?.[0]?.id || fallback.english : enRes?.voices?.[0]?.id || fallback.english,
        });
      })
      .catch(() => {});
  }
  return fallback;
}

const VOICE_STYLE_HINTS = {
  english:
    'realistic human Indian English speaker (en-IN), warm conversational studio presence, natural micro-pauses at punctuation, subtle expressive emphasis, never robotic or monotonous',
  english_global:
    'realistic human studio narrator, warm articulate conversational tone, natural breathing pauses and genuine human inflection without sounding synthetic',
  hindi:
    'realistic native Indian Hindi human speaker, warm expressive voice with natural conversational cadence, soft breathing pauses, and crisp authentic pronunciation',
  hinglish:
    'realistic bilingual Indian human assistant (en-IN / hi-IN), friendly conversational warmth, effortless code-switching between English and Hindi with natural human rhythm',
};

export async function textToSpeech(text, profile = 'hinglish', opts = {}) {
  if (!client) throw new Error('Gemini not initialized');

  const accent =
    opts?.accent ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('jeeva_voice_accent') : null) ||
    'indian';
  const persona =
    opts?.persona ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('jeeva_voice_persona') : null) ||
    'natural_warm';
  const voices = await getRegionalVoices(accent, persona);
  const voice = voices[profile] || voices.hinglish;
  const styleKey = profile === 'english' && accent === 'global' ? 'english_global' : profile;
  const style = VOICE_STYLE_HINTS[styleKey] || VOICE_STYLE_HINTS.hinglish;
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
