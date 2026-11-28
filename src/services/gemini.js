// Gemini API Service — Modular Client, Smoke Tester, Multimodal Chat, STT, Image & TTS
import { GoogleGenAI } from '@google/genai';
import { TOOLS, executeFunctionCall, clearToolSessionPermissions } from './tools.js';
import { recallRelevantMemories } from './memoryRag.js';
import { pickTopToolsForQuery } from './semanticIntent.js';
import { getReplyStyle } from './userPrefs.js';
import { assertCloudAllowed, isStrictOfflineMode } from './offlineMode.js';

let client = null;
let previousInteractionId = null;
const GEMINI_MODEL_ID = 'gemini-3.5-flash-lite';
const GEMINI_TTS_MODEL_ID = 'gemini-3.8-flash-lite-tts';
let preferredModel = GEMINI_MODEL_ID;
let customInstructions = '';
let assistantName = 'Jeeva';

export const SMOKE_CANDIDATE_MODELS = [GEMINI_MODEL_ID];

export function setAiNamePrompt(name) {
  const cleaned = String(name || 'Jeeva').trim();
  assistantName = cleaned || 'Jeeva';
}

function buildSystemPrompt(fromVoice = false, strictVoice = true) {
  const base = `You are ${assistantName}, a lightweight everyday personal assistant for Windows, created by Roushan Kumar.
Your main purpose is normal daily use: answer everyday questions, explain things simply, help with reminders and files, and operate Windows PC controls safely.
You understand Hindi, English, and Hinglish naturally. Reply in the same language and script style as the user, with clear, natural words (avoid abbreviated SMS shorthand such as "kr" or "v" so voice narration sounds natural).
Keep answers concise, friendly, and practical. Prefer everyday explanations over long technical lectures. Do not behave like a complex software-engineering or coding agent; for large multi-file projects, politely explain that JEEVA is optimized for everyday personal assistance and offer simple guidance instead.
You have Windows PC control tools:
- Apps and browser: launch/focus/close apps, inspect/click UI controls, control browser tabs and YouTube playback.
- Screen and input: take screenshots, inspect screen contents, click/scroll, send hotkeys, and type or paste text.
- Hardware: check CPU/RAM/disk/ports, adjust volume/brightness/theme/power plans, and manage Recycle Bin.
- Files, clipboard, and schedules: browse/search/read common files, organize folders, recall clipboard history, and create reminders or timers.
ALWAYS use the appropriate tool when the user asks you to perform an action; do not merely explain how to do it manually.
SENSITIVE ACTIONS RULE: For installs/uninstalls/updates, Windows setting changes, force-closing apps, file deletion, and power or terminal actions, call the relevant tool. JEEVA's permission guard will ask the user to confirm before execution.
LANGUAGE & CONFIRMATION RULE: Always reply in the SAME language and script style the user used. After a tool action, clearly say what action was performed and whether it succeeded. Do not claim success when a tool reports an error.`;

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

function createTempClient(apiKey) {
  if (!apiKey) throw new Error('API key is required');
  return new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
}

export function initGemini(apiKey) {
  client = createTempClient(String(apiKey || '').trim());
  previousInteractionId = null;
  return true;
}

// Exposes only whether a direct API key is configured; never returns the key itself.
export function getGeminiConnectionInfo() {
  return { apiKey: Boolean(client), useServerProxy: false };
}

export async function testGeminiConnection({ apiKey = '' } = {}) {
  assertCloudAllowed('Gemini Connection Test');
  const startedAt = Date.now();
  try {
    const testClient = createTempClient(String(apiKey || '').trim());
    const res = await testClient.interactions.create({
      model: GEMINI_MODEL_ID,
      input: 'Reply with OK',
      store: false,
    });
    return {
      ok: true,
      activeModel: GEMINI_MODEL_ID,
      fallbackUsed: false,
      latencyMs: Date.now() - startedAt,
      sample: (res?.output_text || 'OK').trim().slice(0, 40),
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), latencyMs: Date.now() - startedAt };
  }
}

export function setModel() {
  // Ignore legacy saved model choices; JEEVA has one fixed text/reasoning model.
  preferredModel = GEMINI_MODEL_ID;
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
  assertCloudAllowed('Gemini Cloud Chat');
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

  // Fast API optimization: prune 39 tool schemas down to only relevant tools (cuts ~2000 tokens & speeds up TTFT)
  let selectedTools = TOOLS;
  if (typeof text === 'string' && text.trim() && !attachment) {
    const needsPcTools =
      /\b(open|close|launch|start|run|volume|mute|brightness|screenshot|screen|read|file|folder|pdf|docx|xlsx|install|uninstall|battery|wifi|cpu|ram|disk|port|process|kill|mouse|click|type|key|hotkey|remind|schedule|timer|chrome|tab|youtube|vscode|git|clipboard|window|snap|minimize|clean|organize|power|shutdown|restart|lock|app|memory|remember)\b/i.test(
        text
      );
    if (!needsPcTools) {
      selectedTools = [];
    } else {
      const topNames = new Set(pickTopToolsForQuery(text, 10));
      selectedTools = TOOLS.filter((t) => topNames.has(t.name));
    }
  }

  const requestConfig = {
    model: preferredModel,
    input,
    ...(selectedTools.length > 0 ? { tools: selectedTools } : {}),
    system_instruction: fullSystemPrompt,
    store: true,
  };

  if (previousInteractionId) {
    requestConfig.previous_interaction_id = previousInteractionId;
  }

  async function callWithRetry(config, isStream = false, allowResetPrevId = false) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      const cfg = { ...config, model: GEMINI_MODEL_ID };
      try {
        return isStream
          ? await client.interactions.create({ ...cfg, stream: true })
          : await client.interactions.create(cfg);
      } catch (err) {
        lastError = err;
        const msg = String(err?.message || err);
        if (
          allowResetPrevId &&
          cfg.previous_interaction_id &&
          (msg.includes('404') || msg.includes('not found') || msg.includes('previous_interaction_id'))
        ) {
          previousInteractionId = null;
          delete cfg.previous_interaction_id;
          return isStream
            ? await client.interactions.create({ ...cfg, stream: true })
            : await client.interactions.create(cfg);
        }
        const transient = /429|503|UNAVAILABLE|overloaded|timeout|network/i.test(msg);
        if (!transient || attempt === 2) throw err;
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
    throw lastError || new Error('Gemini request failed');
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
  assertCloudAllowed('Gemini Audio Transcription');
  if (!client) throw new Error('Gemini not initialized');
  const wakeName = (opts?.aiName || assistantName || 'Jeeva').trim();
  const prompt = opts?.mode === 'wake'
    ? `Listen for the wake phrase "${wakeName}" in Hindi, English, or Hinglish. Output only the exact spoken words, or an empty string if there is no speech.`
    : 'Transcribe this Hindi, English, or Hinglish PC voice command accurately. Output only the spoken words, with no commentary.';

  const response = await client.models.generateContent({
    model: GEMINI_MODEL_ID,
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: { mimeType, data: base64Data } },
      ],
    }],
    config: { responseModalities: ['TEXT'], temperature: 0 },
  });
  if (typeof response.text === 'string') return response.text.trim();
  return (response.candidates?.[0]?.content?.parts || [])
    .filter((part) => typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
}

export async function generateTitle(userMessage) {
  if (isStrictOfflineMode() || !client) return null;
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

const PERSONA_VOICES = {
  natural_warm: { indian: { english: 'Kore', hindi: 'Kore', hinglish: 'Kore' }, global: { english: 'Aoede', hindi: 'Kore', hinglish: 'Aoede' } },
  calm_pro: { indian: { english: 'Charon', hindi: 'Charon', hinglish: 'Charon' }, global: { english: 'Charon', hindi: 'Charon', hinglish: 'Charon' } },
  crisp_studio: { indian: { english: 'Aoede', hindi: 'Aoede', hinglish: 'Aoede' }, global: { english: 'Aoede', hindi: 'Aoede', hinglish: 'Aoede' } },
  conversational: { indian: { english: 'Puck', hindi: 'Puck', hinglish: 'Puck' }, global: { english: 'Puck', hindi: 'Puck', hinglish: 'Puck' } },
};

export function isGeminiReady() {
  return Boolean(client);
}

const VOICE_STYLE_HINTS = {
  english: 'Speak in clear, natural Indian English with a warm conversational tone and short pauses.',
  english_global: 'Speak in clear, natural English with a warm conversational tone and short pauses.',
  hindi: 'Speak in natural Hindi with clear, warm Indian pronunciation and short conversational pauses.',
  hinglish: 'Speak naturally in Hindi and English as a bilingual Indian assistant; preserve the code-switching in the text.',
};

export async function textToSpeech(text, profile = 'hinglish', opts = {}) {
  assertCloudAllowed('Gemini voice output');
  if (!client) throw new Error('Gemini not initialized');
  const accent = opts?.accent || (typeof localStorage !== 'undefined' ? localStorage.getItem('jeeva_voice_accent') : null) || 'indian';
  const persona = opts?.persona || (typeof localStorage !== 'undefined' ? localStorage.getItem('jeeva_voice_persona') : null) || 'natural_warm';
  const personaKey = PERSONA_VOICES[persona] ? persona : 'natural_warm';
  const accentKey = accent === 'global' ? 'global' : 'indian';
  const voice = PERSONA_VOICES[personaKey][accentKey][profile] || PERSONA_VOICES[personaKey][accentKey].hinglish;
  const styleKey = profile === 'english' && accentKey === 'global' ? 'english_global' : profile;
  const style = VOICE_STYLE_HINTS[styleKey] || VOICE_STYLE_HINTS.hinglish;

  const response = await client.models.generateContent({
    model: GEMINI_TTS_MODEL_ID,
    contents: `Speak the following text aloud. ${style}\n\n${String(text || '')}`,
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  });

  const audioPart = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data);
  if (!audioPart?.inlineData?.data) {
    throw new Error('Gemini TTS did not return audio data');
  }
  const mime = audioPart.inlineData.mimeType || 'audio/wav';
  return `data:${mime};base64,${audioPart.inlineData.data}`;
}

