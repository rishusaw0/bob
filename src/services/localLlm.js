// Tier-2 Frontend Local SLM Agent Loop — Runs on Qwen2.5-0.5B/1.5B/Gemma3-1B with Top-4 Tool Pruning
import { TOOLS, executeFunctionCall } from './tools.js';
import { pickTopToolsForQuery } from './semanticIntent.js';
import { recallRelevantMemories } from './memoryRag.js';

function convertGeminiToolsToOpenAI(toolNames) {
  const allowed = new Set(toolNames);
  const selected = TOOLS.filter((t) => allowed.has(t.name));
  return selected.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description.slice(0, 180),
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters?.properties || {}).map(([k, v]) => [
            k,
            {
              type: String(v.type || 'string').toLowerCase(),
              description: v.description || '',
              ...(v.enum ? { enum: v.enum } : {}),
            },
          ])
        ),
        required: t.parameters?.required || [],
      },
    },
  }));
}

function parseToolArguments(rawArgs) {
  if (typeof rawArgs === 'string') {
    try { rawArgs = JSON.parse(rawArgs || '{}'); } catch { return null; }
  }
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) return null;
  return rawArgs;
}

export function validateLocalToolCall(name, args, allowedToolNames = []) {
  if (!Array.isArray(allowedToolNames) || !allowedToolNames.includes(name)) {
    return { ok: false, error: 'Tool is not in the approved shortlist for this request.' };
  }
  // Local language models must never synthesize arbitrary shell commands.
  if (name === 'run_system_command') {
    return { ok: false, error: 'Arbitrary shell commands are not available to the local command planner.' };
  }
  const tool = TOOLS.find((item) => item.name === name);
  if (!tool) return { ok: false, error: 'Unknown tool.' };
  const cleanArgs = parseToolArguments(args);
  if (!cleanArgs) return { ok: false, error: 'Tool arguments must be a valid JSON object.' };
  const schema = tool.parameters || {};
  const properties = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(cleanArgs, key) || cleanArgs[key] === '' || cleanArgs[key] == null) {
      return { ok: false, error: `Missing required argument: ${key}.` };
    }
  }
  for (const [key, value] of Object.entries(cleanArgs)) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) {
      return { ok: false, error: `Unsupported argument: ${key}.` };
    }
    const rule = properties[key] || {};
    const type = String(rule.type || 'string').toLowerCase();
    if (type === 'string' && (typeof value !== 'string' || value.length > 5000)) {
      return { ok: false, error: `Invalid string argument: ${key}.` };
    }
    if ((type === 'number' || type === 'integer') && (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value)))) {
      return { ok: false, error: `Invalid numeric argument: ${key}.` };
    }
    if (type === 'boolean' && typeof value !== 'boolean') {
      return { ok: false, error: `Invalid boolean argument: ${key}.` };
    }
    if (Array.isArray(rule.enum) && !rule.enum.includes(value)) {
      return { ok: false, error: `Unsupported value for argument: ${key}.` };
    }
  }
  return { ok: true, args: cleanArgs };
}

function tryExtractJsonAction(text) {
  const raw = String(text || '').trim();
  const blockMatch = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/(\{[\s\S]*\})/);
  if (!blockMatch) return null;
  try {
    const parsed = JSON.parse(blockMatch[1]);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  return null;
}

export async function runLocalSlmTurn({
  text,
  historyMessages = [],
  requestPermission = null,
  fromVoice = false,
  onToolUpdate = null,
} = {}) {
  if (!window.electronAPI?.localBrainChat) {
    return { handled: false, reason: 'no_desktop_bridge' };
  }

  // Only inject Top-4 tools + short memory context so 0.5B-1.5B models respond in 1-2 seconds accurately
  const topToolNames = pickTopToolsForQuery(text, 4);
  const openAiTools = convertGeminiToolsToOpenAI(topToolNames);

  let memSnippet = '';
  try {
    const memItems = await recallRelevantMemories(text, 3);
    if (Array.isArray(memItems) && memItems.length) {
      memSnippet = `\nUSER MEMORY:\n${memItems.map((m) => `- ${m.content}`).join('\n')}`;
    }
  } catch {}

  const nowStr = new Date().toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const systemPrompt = `You are JEEVA Local Brain running on the user's Windows PC. Current local date/time: ${nowStr}.
Reply in the exact same language (English, Romanized Hinglish, or Hindi) in plain everyday words.
Keep answers helpful, accurate, and concise. Use only the listed tools and only when the user clearly requested a PC action.
Never invent tool names or arguments. Ask a short clarification when a required argument is missing or the target is ambiguous.
Never create or execute arbitrary shell/PowerShell commands. High-impact actions must go through the existing permission confirmation; do not claim success before a tool result confirms it.
Available PC tools: ${topToolNames.join(', ')}.
If you need a listed PC tool and native tool_calls aren't used, respond ONLY with JSON: {"tool":"<name>","args":{...}}.
If the task requires live internet info, complex coding, or screen image vision you cannot do locally, respond ONLY with JSON: {"escalate":true,"reason":"<short reason>"}.${memSnippet}`;

  const recent = (historyMessages || [])
    .filter((m) => m && m.text && !m.isError)
    .slice(-4)
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: String(m.text).slice(0, 500),
    }));

  const messages = [{ role: 'system', content: systemPrompt }, ...recent, { role: 'user', content: text }];
  const executedTools = [];
  let outputImage = null;

  for (let step = 0; step < 2; step++) {
    const res = await window.electronAPI.localBrainChat({
      messages,
      tools: openAiTools,
      temperature: 0.25,
      maxTokens: 420,
    });

    if (!res?.ok) {
      return {
        handled: false,
        lowRamGuard: Boolean(res?.lowRamGuard),
        noLocalModel: Boolean(res?.noLocalModel),
        reason: res?.error || 'Local SLM unavailable',
      };
    }

    const msg = res.message || {};
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const content = String(msg.content || '').trim();
    const jsonHint = toolCalls.length === 0 ? tryExtractJsonAction(content) : null;
    const hintedToolName = jsonHint?.tool || jsonHint?.name || '';
    const hintedToolArgs = jsonHint?.args || jsonHint?.arguments || {};

    if (jsonHint?.escalate) {
      return { handled: false, escalatedBySlm: true, reason: jsonHint.reason || 'Requires Gemini Cloud' };
    }

    if (toolCalls.length > 0 || hintedToolName) {
      const rawCalls = toolCalls.length > 0
        ? toolCalls.slice(0, 2).map((tc) => ({
            name: tc.function?.name,
            args: tc.function?.arguments ?? {},
          }))
        : [{ name: hintedToolName, args: hintedToolArgs }];
      const toolOutputs = [];
      if (toolCalls.length > 2) {
        toolOutputs.push('Rejected extra tool calls: at most two actions are allowed per model step.');
      }

      for (const rawCall of rawCalls) {
        const name = String(rawCall?.name || '');
        const parsedArgs = parseToolArguments(rawCall?.args);
        const validation = validateLocalToolCall(name, parsedArgs, topToolNames);
        if (!validation.ok) {
          const entry = { name: name || 'unknown_tool', status: 'error', args: parsedArgs || {}, error: validation.error };
          executedTools.push(entry);
          onToolUpdate?.([...executedTools]);
          toolOutputs.push(`${entry.name}: rejected safely — ${validation.error}`);
          continue;
        }

        const entry = { name, status: 'running', args: validation.args };
        executedTools.push(entry);
        onToolUpdate?.([...executedTools]);

        let toolResult;
        try {
          toolResult = await executeFunctionCall(name, validation.args, requestPermission, {
            fromVoice,
            userPrompt: text,
          });
        } catch (err) {
          toolResult = { error: err?.message || 'Tool execution failed safely.' };
        }
        entry.status = toolResult?.error ? 'error' : 'done';
        if (toolResult?.error) entry.error = String(toolResult.error).slice(0, 240);
        onToolUpdate?.([...executedTools]);
        if (toolResult?.screenshot) outputImage = toolResult.screenshot;

        const cleanOut = { ...(toolResult || {}) };
        delete cleanOut.screenshot;
        toolOutputs.push(`${name}: ${JSON.stringify(cleanOut)}`);
      }

      messages.push({ role: 'assistant', content: content || 'Executing approved tool calls.' });
      messages.push({
        role: 'user',
        content: `Tool result:\n${toolOutputs.join('\n')}\nOnly report actions that succeeded. If an action was rejected or denied, explain that briefly. Now reply in the user's language.`,
      });
      continue;
    }

    if (!content) {
      return { handled: false, reason: 'Empty SLM response' };
    }

    return {
      handled: true,
      tier: 'local-slm',
      modelLabel: `${res.model} (${res.latencyMs}ms)`,
      replyText: content,
      image: outputImage,
      tools: executedTools,
    };
  }

  return { handled: false, reason: 'SLM max steps reached' };
}
