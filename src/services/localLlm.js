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

  const systemPrompt = `You are JEEVA Local Brain running on the user's Windows PC. Reply in the exact same language (English, Romanized Hinglish, or Hindi).
Keep answers helpful, clear, and concise.
Available PC tools: ${topToolNames.join(', ')}.
If you need to execute a PC tool directly and native tool_calls aren't used, respond ONLY with JSON: {"tool":"<name>","args":{...}}.
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

    if (jsonHint?.escalate) {
      return { handled: false, escalatedBySlm: true, reason: jsonHint.reason || 'Requires Gemini Cloud' };
    }

    if (toolCalls.length > 0 || jsonHint?.tool) {
      const targetCalls =
        toolCalls.length > 0
          ? toolCalls.map((tc) => ({
              name: tc.function?.name,
              args:
                typeof tc.function?.arguments === 'string'
                  ? JSON.parse(tc.function.arguments || '{}')
                  : tc.function?.arguments || {},
            }))
          : [{ name: jsonHint.tool, args: jsonHint.args || {} }];

      const toolOutputs = [];
      for (const tc of targetCalls) {
        if (!tc.name) continue;
        const entry = { name: tc.name, status: 'running', args: tc.args };
        executedTools.push(entry);
        onToolUpdate?.([...executedTools]);

        const toolResult = await executeFunctionCall(tc.name, tc.args, requestPermission, {
          fromVoice,
          userPrompt: text,
        });
        entry.status = toolResult?.error ? 'error' : 'done';
        onToolUpdate?.([...executedTools]);
        if (toolResult?.screenshot) outputImage = toolResult.screenshot;

        const cleanOut = { ...toolResult };
        delete cleanOut.screenshot;
        toolOutputs.push(`${tc.name}: ${JSON.stringify(cleanOut)}`);
      }

      messages.push({ role: 'assistant', content: content || 'Executing tool.' });
      messages.push({
        role: 'user',
        content: `Tool result:\n${toolOutputs.join('\n')}\nNow confirm to the user clearly in one concise reply in their language.`,
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
