// Master Voice Engine: Custom AI Wake Name + Fuzzy Matcher + Instant Deterministic PC Router
import { getSystemAPI } from './systemApi.js';
import {
  PERMISSION_CATEGORIES,
  getToolCategory,
  getToolRiskLevel,
  isSensitiveVoiceAction,
  formatToolSummary,
  getCategoryPolicy,
  allowCategoryForSession,
  savePermissionRules,
  getPermissionRules,
  appendAuditLog,
  isRemoteEnvironment,
} from './permissions.js';
import { detectCommandLanguage } from './voicePermissionPrompt.js';
import { resolveContextualFollowUp, isAmbiguousCommand } from './commandUnderstanding.js';

let lastVoiceAppTarget = null;

const AI_NAME_KEY = 'jeeva_ai_name';
const STRICT_VOICE_KEY = 'jeeva_strict_voice';
const WAKE_ENABLED_KEY = 'jeeva_wake_word';
const WAKE_OPEN_MODE_KEY = 'jeeva_wake_open_mode';
const WAKE_TRIGGER_KEY = 'jeeva_wake_trigger';

export function getWakeOpenMode() {
  const mode = localStorage.getItem(WAKE_OPEN_MODE_KEY) || 'notch';
  return ['notch', 'cortana', 'full', 'speaker'].includes(mode) ? mode : 'notch';
}

export function setWakeOpenMode(mode) {
  const clean = ['notch', 'cortana', 'full', 'speaker'].includes(mode) ? mode : 'notch';
  localStorage.setItem(WAKE_OPEN_MODE_KEY, clean);
  return clean;
}

export function getAiName() {
  const raw = (localStorage.getItem(AI_NAME_KEY) || 'Jeeva').trim();
  return raw || 'Jeeva';
}

export function setAiName(name) {
  const cleaned = String(name || 'Jeeva')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .slice(0, 24);
  const finalName = cleaned || 'Jeeva';
  localStorage.setItem(AI_NAME_KEY, finalName);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('jeeva-ai-name-updated', { detail: finalName }));
  }
  return finalName;
}

export function getWakeTriggerPhrase() {
  const saved = (localStorage.getItem(WAKE_TRIGGER_KEY) || '').trim();
  return saved || `Hey ${getAiName()}`;
}

export function setWakeTriggerPhrase(phrase) {
  const cleaned = String(phrase || '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 36);
  const finalPhrase = cleaned || `Hey ${getAiName()}`;
  localStorage.setItem(WAKE_TRIGGER_KEY, finalPhrase);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('jeeva-wake-trigger-updated', { detail: finalPhrase }));
  }
  return finalPhrase;
}

export function getStrictVoiceMode() {
  return localStorage.getItem(STRICT_VOICE_KEY) !== 'false';
}

export function setStrictVoiceMode(enabled) {
  localStorage.setItem(STRICT_VOICE_KEY, String(Boolean(enabled)));
  return Boolean(enabled);
}

export function getWakeWordEnabled() {
  return localStorage.getItem(WAKE_ENABLED_KEY) !== 'false';
}

export function setWakeWordEnabled(enabled) {
  localStorage.setItem(WAKE_ENABLED_KEY, String(Boolean(enabled)));
  window.dispatchEvent(new CustomEvent('jeeva-wake-settings-changed', { detail: Boolean(enabled) }));
  return Boolean(enabled);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

const DEFAULT_ALIASES = new Set([
  'jeeva', 'jiva', 'jeewa', 'jiya', 'zeva', 'jeeba',
  'jeean', 'jean', 'jian', 'jeevan', 'jevan', 'jiyan', 'giya', 'diya',
  'जीवा', 'जिवा', 'जीन', 'जीवन',
]);
const PREFIX_FILLERS = new Set(['hey', 'he', 'hay', 'ok', 'okay', 'hi', 'hello', 'yo', 'oye', 'sun', 'suno', 'हे', 'ओके', 'हेलो', 'सुनो']);

/**
 * Checks whether a spoken transcript starts with or contains the AI wake name.
 * Works cleanly for any user-chosen name ("Jarvis", "Friday", "Jeeva", etc.) + Hindi/Hinglish variants.
 */
export function matchWakePhrase(
  transcript,
  aiName = getAiName(),
  customTrigger = getWakeTriggerPhrase()
) {
  const raw = String(transcript || '').trim();
  if (!raw) return { matched: false, command: '' };

  // Tokenize keeping combining marks (\p{M}) so Devanagari matras stay intact with letters
  const tokens = [];
  const tokenRegex = /[\p{L}\p{M}\p{N}]+/gu;
  let m;
  while ((m = tokenRegex.exec(raw)) !== null) {
    tokens.push({ word: m[0], lower: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  if (tokens.length === 0) return { matched: false, command: '' };

  // 1. Check user's custom wake trigger phrase first (e.g. "Sun Bhai", "Ok Jarvis", "Wake Up")
  const triggerTokens = String(customTrigger || '')
    .trim()
    .toLowerCase()
    .match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  if (triggerTokens.length > 0 && tokens.length >= triggerTokens.length) {
    for (let offset = 0; offset <= Math.min(2, tokens.length - triggerTokens.length); offset++) {
      let allMatch = true;
      for (let j = 0; j < triggerTokens.length; j++) {
        const spoken = tokens[offset + j].lower;
        const expected = triggerTokens[j];
        const maxD = expected.length >= 6 ? 2 : expected.length >= 4 ? 1 : 0;
        if (spoken !== expected && !(maxD > 0 && levenshtein(spoken, expected) <= maxD)) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        const lastTok = tokens[offset + triggerTokens.length - 1];
        const rest = raw.slice(lastTok.end).replace(/^[\s,.:;!?-]+/, '').trim();
        return { matched: true, command: rest };
      }
    }
  }

  // 2. Fallback to AI assistant name (with phonetic/Hindi filler forgiveness)
  const target = String(aiName || 'Jeeva').trim().toLowerCase();
  const isDefaultJeeva = target === 'jeeva';
  const maxDist = target.length >= 6 ? 2 : target.length >= 4 ? 1 : 0;

  for (let i = 0; i < Math.min(tokens.length, 6); i++) {
    const tok = tokens[i];
    if (PREFIX_FILLERS.has(tok.lower)) continue;

    const exactHit = tok.lower === target || (isDefaultJeeva && DEFAULT_ALIASES.has(tok.lower));
    const fuzzyHit = !exactHit && maxDist > 0 && levenshtein(tok.lower, target) <= maxDist;

    if (exactHit || fuzzyHit) {
      const rest = raw.slice(tok.end).replace(/^[\s,.:;!?-]+/, '').trim();
      return { matched: true, command: rest };
    }

    // Multi-word custom AI names (e.g. "Iron Man")
    if (target.includes(' ') && i + 1 < tokens.length) {
      const twoWord = `${tok.lower} ${tokens[i + 1].lower}`;
      if (twoWord === target) {
        const rest = raw.slice(tokens[i + 1].end).replace(/^[\s,.:;!?-]+/, '').trim();
        return { matched: true, command: rest };
      }
    }
  }

  return { matched: false, command: '' };
}

const HINDI_NUMBERS = {
  zero: 0, shunya: 0, ek: 1, five: 5, paanch: 5, panch: 5,
  ten: 10, das: 10, fifteen: 15, pandrah: 15, twenty: 20, bees: 20, bis: 20,
  pachis: 25, thirty: 30, tees: 30, tis: 30, forty: 40, chalis: 40,
  fifty: 50, pachas: 50, half: 50, aadha: 50, sixty: 60, saath: 60, sath: 60,
  seventy: 70, sattar: 70, eighty: 80, assi: 80, ninety: 90, nabbe: 90,
  hundred: 100, sau: 100, full: 100, max: 100,
};

function extractNumber0to100(text) {
  const numMatch = text.match(/\b(\d{1,3})\b/);
  if (numMatch) {
    return Math.max(0, Math.min(100, Number(numMatch[1])));
  }
  const words = text.toLowerCase().split(/\s+/);
  for (const w of words) {
    if (Object.prototype.hasOwnProperty.call(HINDI_NUMBERS, w)) {
      return HINDI_NUMBERS[w];
    }
  }
  return null;
}

export async function runAuthorizedFastTool(name, args, executor, requestPermission, meta = {}) {
  const category = getToolCategory(name, args);
  const catMeta = PERMISSION_CATEGORIES.find((c) => c.id === category);
  const policy = getCategoryPolicy(category);
  const riskLevel = getToolRiskLevel(name, args);
  const summary = formatToolSummary(name, args);
  const userLang = meta.userLang || detectCommandLanguage(meta.userPrompt || '');

  if (policy === 'block') {
    appendAuditLog({ tool: name, category, summary, decision: 'blocked' });
    return {
      ok: false,
      error:
        userLang === 'english'
          ? `Blocked by Permission Center (${catMeta?.label || category}).`
          : `Permission Center ne is action ko block kiya hai (${catMeta?.label || category}).`,
    };
  }

  const needsPrompt =
    riskLevel === 'high' ||
    isSensitiveVoiceAction(name, args) ||
    policy === 'ask';

  if (needsPrompt && !requestPermission) {
    appendAuditLog({ tool: name, category, summary, decision: 'blocked (permission handler unavailable)' });
    return {
      ok: false,
      error: userLang === 'english'
        ? 'Cannot execute ' + summary + ': permission confirmation is unavailable.'
        : userLang === 'hindi'
          ? 'अनुमति की पुष्टि उपलब्ध नहीं है, इसलिए यह कार्य नहीं किया गया: ' + summary + '।'
          : 'Permission confirmation available nahi hai, isliye ' + summary + ' execute nahi kiya.',
    };
  }

  if (needsPrompt && requestPermission) {
    let decision;
    try {
      decision = await requestPermission({
      name,
      args,
      riskLevel,
      category,
      categoryLabel: catMeta?.label || category,
      summary,
      isRemote: isRemoteEnvironment(),
      fromVoice: true,
      userLang,
      userPrompt: meta.userPrompt || '',
      });
    } catch (err) {
      appendAuditLog({ tool: name, category, summary, decision: 'denied (permission request failed)' });
      return {
        ok: false,
        error: userLang === 'english'
          ? 'Permission confirmation failed. The action was not executed.'
          : userLang === 'hindi'
            ? 'अनुमति की पुष्टि विफल रही। कार्य नहीं किया गया।'
            : 'Permission confirmation fail ho gaya. Action execute nahi kiya.',
      };
    }
    if (!decision || decision === 'deny') {
      appendAuditLog({ tool: name, category, summary, decision: 'denied' });
      return {
        ok: false,
        error:
          userLang === 'english'
            ? `Cancelled: ${summary}.`
            : userLang === 'hindi'
              ? `रद्द कर दिया गया: ${summary}।`
              : `Theek hai, yeh action cancel kar diya hai.`,
      };
    }
    if (decision === 'session_category' && riskLevel !== 'high') {
      allowCategoryForSession(category);
    } else if (decision === 'always_category' && riskLevel !== 'high') {
      savePermissionRules({ ...getPermissionRules(), [category]: 'always' });
    }
    appendAuditLog({ tool: name, category, summary, decision: `allowed (${decision})` });
  } else {
    appendAuditLog({ tool: name, category, summary, decision: `allowed (${policy})` });
  }

  try {
    const res = await executor();
    return { ok: true, result: res };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function hasAny(text, enRegex, hiTerms = []) {
  if (enRegex && enRegex.test(text)) return true;
  for (const term of hiTerms) {
    if (text.includes(term)) return true;
  }
  return false;
}

const PHONETIC_SYNONYMS = [
  [/\b(?:volum|valume|vollume|voulme|wollum|avaaz|wall\s+you|ball\s+you)\b/gi, 'volume'],
  [/\b(?:brigtness|brightnes|britness|braitness|roshani)\b/gi, 'brightness'],
  [/\b(?:batery|battry|bettery|batry)\b/gi, 'battery'],
  [/\b(?:screensht|screnshot|screen shot|skreen shot)\b/gi, 'screenshot'],
  [/\b(?:skreen|sreen|scren)\b/gi, 'screen'],
  [/\b(?:reid|reed)\s+screen\b/gi, 'read screen'],
  [/\b(?:crome|kroam|chrom)\b/gi, 'chrome'],
  [/\b(?:nota\s*pad)\b/gi, 'notepad'],
  [/\b(?:u\s*tube|utube|you\s+tube)\b/gi, 'youtube'],
  [/\b(?:wi-fi|wai-fai|waifi|wify|vi\s*fi|why\s*fi)\b/gi, 'wifi'],
  [/\b(?:spotfy|spotifi)\b/gi, 'spotify'],
  [/\b(?:vs\s*code|v\s*s\s*code|we\s*s\s*code)\b/gi, 'vscode'],
  [/\bkhol\s*do\b/gi, 'kholo'],
];

export function normalizePhoneticVoiceText(text) {
  let out = String(text || '');
  for (const [pattern, replacement] of PHONETIC_SYNONYMS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, ' ').trim();
}

export const repairVoiceTranscript = normalizePhoneticVoiceText;

export function splitChainedVoiceClauses(rawText) {
  const wake = matchWakePhrase(rawText);
  const body = (wake.matched && wake.command ? wake.command : String(rawText || '')).trim();
  if (!body) return [];
  // Do NOT split on "aur" when it modifies degree ("aur badhao", "aur kam karo")
  const parts = body
    .split(/\s*(?:,|;|\bthen\b|\bphir\b|\bfir\b|\band\b|\baur\b(?!\s+(?:badhao|badha|kam|ghatao|tez|dheema|dhima|up|down|high|low)\b))\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts;
}

/**
 * Attempts instant (<50ms) deterministic Tier-1 execution including single & multi-action chained commands.
 * Complex/deictic/conversational/app-install queries fall back cleanly to Gemini AI.
 */
export async function tryFastVoiceAction(rawText, requestPermission = null) {
  const api = getSystemAPI();
  if (!api) return { handled: false };

  let normalizedRaw = normalizePhoneticVoiceText(rawText);
  const followUp = resolveContextualFollowUp(normalizedRaw, { lastApp: lastVoiceAppTarget });
  if (followUp.kind === 'clarify') {
    return { handled: true, needsClarification: true, replyText: followUp.question, tools: [] };
  }
  if (followUp.kind === 'close_app') normalizedRaw = `close ${followUp.appName}`;
  else if (followUp.kind === 'open_app') normalizedRaw = `open ${followUp.appName}`;
  if (isAmbiguousCommand(normalizedRaw)) {
    return { handled: true, needsClarification: true, replyText: 'Kaunsa app, file ya folder? Naam ya path bataiye.', tools: [] };
  }
  const clauses = splitChainedVoiceClauses(normalizedRaw);
  if (clauses.length >= 2 && clauses.length <= 5) {
    // Only run multi-action Tier-1 chaining when EVERY clause resolves deterministically!
    const planned = clauses.map((c) => planSingleFastClause(c, normalizedRaw)).filter(Boolean);
    if (planned.length !== clauses.length) {
      return { handled: false };
    }
    const userLang = detectCommandLanguage(normalizedRaw);
    const runFast = (toolName, toolArgs, execFn) =>
      runAuthorizedFastTool(toolName, toolArgs, execFn, requestPermission, {
        userLang,
        userPrompt: normalizedRaw,
      });
    const allTools = [];
    const replyParts = [];
    for (const plan of planned) {
      const execRes = await executePlannedClause(plan, api, runFast, userLang);
      if (execRes.tools?.length) allTools.push(...execRes.tools);
      if (execRes.replyText) replyParts.push(execRes.replyText.replace(/\.+$/, ''));
    }
    return {
      handled: true,
      chained: true,
      replyText: replyParts.join(', ') + '.',
      tools: allTools,
    };
  }

  return await trySingleFastVoiceAction(normalizedRaw, requestPermission);
}

function stripWakeOnly(raw) {
  const wake = matchWakePhrase(raw);
  return (wake.matched && wake.command ? wake.command : String(raw || '')).trim();
}

function cleanClause(raw) {
  return stripWakeOnly(raw)
    .replace(/\b(please|plz|zara|thoda|abhi|jaldi|bhai|yaar|karo|karde|krde|kardo|kar do|ho jaye)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTypeCommand(rawClause) {
  const raw = stripWakeOnly(rawClause);
  const lower = raw.toLowerCase();
  if (!raw) return null;
  if (/\b(?:write|likho)\s+(?:an?\s+)?(?:essay|story|poem|letter|email|code|program|script|paragraph|article|blog|notes)\b/i.test(lower)) {
    return null;
  }

  const appBeforeText =
    raw.match(/^(?:in\s+)?([a-z0-9][a-z0-9\s._-]{1,22}?)\s+(?:mein|me|pe|par)\s+(?:type|likho|likh)(?:\s+(?:karo|kr|kar\s+do|do))?\s*[:,-]?\s*(.+)$/i) ||
    raw.match(/^(?:in\s+)?([a-z0-9][a-z0-9\s._-]{1,22}?)\s+(?:mein|me|pe|par)\s+(.+?)\s+(?:type|likho|likh)(?:\s+(?:karo|kr|kar\s+do|do))?$/i) ||
    raw.match(/^(?:type|likho|likh)(?:\s+(?:karo|kr|kar\s+do|do))?\s+(?:in|into|on)\s+([a-z0-9][a-z0-9\s._-]{1,22}?)\s+(?:mein|me|pe|par)?\s*[:,-]?\s*(.+)$/i);
  const directType =
    raw.match(/^(?:please\s+)?(?:type\s+karo|type\s+kr|type\s+kar\s+do|type|likho|likh\s+do)\s*[:,-]?\s*(.+)$/i) ||
    raw.match(/^(.+?)\s+(?:type\s+karo|type\s+kr|type\s+kar\s+do|type\s+do|likho|likh\s+do)$/i);

  let targetApp = '';
  let textToType = '';
  if (appBeforeText && appBeforeText[1] && appBeforeText[2]) {
    targetApp = appBeforeText[1].trim();
    textToType = appBeforeText[2].trim();
  } else if (directType && directType[1]) {
    textToType = directType[1].trim();
  }
  if (!textToType) return null;
  if (targetApp && /\b(screen|yahan|here|box|field|search)\b/i.test(targetApp)) targetApp = '';
  return { kind: 'type_text', targetApp, textToType };
}

function parseNamedPlayCommand(rawClause) {
  const raw = stripWakeOnly(rawClause);
  const lower = raw.toLowerCase();
  if (!raw || /\b(why|how|explain|install|uninstall|pdf|reminder|timer|alarm|lock|sleep|shutdown|restart|organize|downloads|desktop|settings|volume|brightness|wifi|bluetooth|screenshot)\b/i.test(lower)) {
    return null;
  }

  const namedPlayMatch =
    raw.match(/^(?:on\s+youtube|youtube\s+(?:par|pe|mein|me)|on\s+spotify|spotify\s+(?:par|pe))\s+(.+?)\s+(?:play|chalao|chala\s*do|chala|bajao|lagao|dekho)(?:\s+(?:karo|kar\s+do|do))?$/i) ||
    raw.match(/^(?:please\s+)?(?:play|chalao|bajao|lagao)\s+(?:a\s+|the\s+)?(?:video|song|track|gaana|gaane|gana|music)?\s*(?:of\s+|called\s+|named\s+)?(.+?)(?:\s+(?:on\s+youtube|youtube\s+(?:par|pe)|on\s+spotify|spotify\s+(?:par|pe)|song|video|gaana|gaane|gana))?$/i) ||
    raw.match(/^(.+?)\s+(?:song|video|gaana|gaane|gana)?\s*(?:play\s*karo|chalao|chala\s*do|bajao|lagao)(?:\s+(?:karo|kar\s+do|do))?$/i);

  if (!namedPlayMatch || !namedPlayMatch[1]) return null;
  const rawQuery = namedPlayMatch[1]
    .replace(/^(?:on\s+youtube|on\s+spotify|youtube\s+(?:par|pe)|spotify\s+(?:par|pe)|play|karo|kar\s+do)\s+/i, '')
    .replace(/\s+(?:on\s+youtube|on\s+spotify|youtube\s+(?:par|pe)|spotify\s+(?:par|pe)|karo|kar\s+do|play|song|video|gaana|gaane|gana)$/i, '')
    .trim();
  const genericOnly = /^(?:music|song|songs|gaana|gaane|gana|track|video|media|pause|next|previous|prev|stop|youtube|spotify|it|this)$/i.test(rawQuery);
  if (rawQuery.length < 2 || genericOnly) return null;

  const useSpotify = /\bspotify\b/i.test(lower);
  const url = useSpotify
    ? `spotify:search:${encodeURIComponent(rawQuery)}`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(rawQuery)}`;
  return { kind: 'named_play', query: rawQuery, useSpotify, url };
}

function parseScrollOrHotkeyCommand(cleaned) {
  const lower = String(cleaned || '').toLowerCase();
  if (/\b(scroll down|niche scroll|neeche scroll|scroll niche|neeche jao|scroll up|upar scroll|scroll upar|upar jao)\b/i.test(lower)) {
    const dir = /\b(up|upar)\b/i.test(lower) ? 'up' : 'down';
    return { kind: 'scroll', direction: dir };
  }
  if (/^(?:copy(?:\s+this|\s+that)?|paste(?:\s+here)?|save(?:\s+file|\s+this)?|undo|select all|press enter|enter dabao|hit enter)$/i.test(lower)) {
    const combo = lower.includes('copy')
      ? 'ctrl+c'
      : lower.includes('paste')
        ? 'ctrl+v'
        : lower.includes('save')
          ? 'ctrl+s'
          : lower.includes('undo')
            ? 'ctrl+z'
            : lower.includes('select all')
              ? 'ctrl+a'
              : 'enter';
    return { kind: 'hotkey', combo };
  }
  return null;
}

function planSingleFastClause(clauseText) {
  const typePlan = parseTypeCommand(clauseText);
  if (typePlan) return typePlan;

  const playPlan = parseNamedPlayCommand(clauseText);
  if (playPlan) return playPlan;

  const cleaned = cleanClause(clauseText);
  const lower = cleaned.toLowerCase();
  if (!lower) return null;

  const scrollHotkeyPlan = parseScrollOrHotkeyCommand(cleaned);
  if (scrollHotkeyPlan) return scrollHotkeyPlan;

  const isReadStatusCheck = /\b(top process|top processes|cpu status|ram status|pc health|system health|disk space|battery|clipboard history|active tab|wifi status)\b/i.test(lower);
  const isHindiMoreModifier = /\baur\s+(badhao|badha|kam|ghatao|tez|dheema|dhima|up|down|high|low)\b/i.test(lower);
  if (
    (/\b(and|then|phir|kyun|why|what|how|kya|kaise|install|uninstall|explain|likho|write|pdf|search|google|isko|is\s+error|yahan)\b/i.test(lower)) ||
    (/\baur\b/i.test(lower) && !isHindiMoreModifier) ||
    (!isReadStatusCheck && /\bbatao\b/i.test(lower))
  ) {
    return null;
  }

  // Preset modes: Coding Mode / Night Focus Mode
  if (/\b(coding mode|developer mode|work mode)\b/i.test(lower)) {
    return { kind: 'preset', preset: 'coding' };
  }
  if (/\b(night mode|night focus|focus mode)\b/i.test(lower)) {
    return { kind: 'preset', preset: 'night' };
  }

  // Wi-Fi control ("wifi on", "wifi off", "wifi status")
  if (/\b(wifi)\b/i.test(lower)) {
    const mode = /\b(off|band|disable)\b/i.test(lower)
      ? 'off'
      : /\b(on|chalu|enable)\b/i.test(lower)
        ? 'on'
        : 'status';
    return { kind: 'wifi', mode };
  }

  if (hasAny(lower, /\b(volume|vol|awaz|awaaz|sound|mute|unmute|chup)\b/i, ['आवाज़', 'आवाज', 'वॉल्यूम', 'म्यूट'])) {
    let pct = extractNumber0to100(lower);
    const wantsUp = hasAny(lower, /\b(up|high|badhao|badha|badao|bada|tez|zyada|jyada|increase|raise|louder|plus|boost)\b/i, ['बढ़ाओ', 'बढ़ा', 'तेज', 'ज्यादा']);
    const wantsDown = hasAny(lower, /\b(down|low|lower|kam|ghatao|ghata|dheema|dhima|decrease|reduce|quieter|minus)\b/i, ['कम', 'घटाओ', 'धीमा']);
    const wantsFull = /\b(full|max|maximum)\b/i.test(lower);
    const wantsMin = /\b(min|minimum)\b/i.test(lower);
    let action = null;
    if (hasAny(lower, /\b(unmute|awaz chalu|sound on)\b/i, ['अनम्यूट'])) action = 'unmute';
    else if (hasAny(lower, /\b(mute|chup|silent|awaz band|sound off)\b/i, ['म्यूट', 'चुप'])) action = 'mute';
    else if (wantsFull) { action = 'set'; pct = 100; }
    else if (wantsMin) { action = 'set'; pct = 10; }
    else if (wantsUp) action = 'up';
    else if (wantsDown) action = 'down';
    else if (pct !== null) action = 'set';
    if (action) return { kind: 'volume', action, pct };
  }

  if (hasAny(lower, /\b(brightness|roshni|light level|chamka)\b/i, ['ब्राइटनेस', 'स्क्रीन लाइट', 'रोशनी'])) {
    let pct = extractNumber0to100(lower);
    const wantsUp = hasAny(lower, /\b(up|high|badhao|badha|badao|bada|tez|zyada|jyada|increase|raise|brighter|plus|boost)\b/i, ['बढ़ाओ', 'बढ़ा', 'तेज', 'ज्यादा']);
    const wantsDown = hasAny(lower, /\b(down|low|lower|kam|ghatao|ghata|decrease|reduce|dim|dimmer|minus)\b/i, ['कम', 'घटाओ']);
    const wantsFull = /\b(full|max|maximum)\b/i.test(lower);
    const wantsMin = /\b(min|minimum)\b/i.test(lower);
    let action = null;
    if (wantsFull) { action = 'set'; pct = 100; }
    else if (wantsMin) { action = 'set'; pct = 10; }
    else if (wantsUp) action = 'up';
    else if (wantsDown) action = 'down';
    else if (pct !== null) action = 'set';
    if (action) return { kind: 'brightness', action, pct };
  }

  if (
    hasAny(
      lower,
      /^(play|pause|resume|stop|next|previous|roko|band|chalu|chala|bajao|lagao|agla|pichla|gaana|gana|music|song|track|media)(\s+(song|music|gaana|gana|track|video|media|play|pause|next|previous|stop|roko|band|chalu|chala|bajao|lagao)){0,3}$/i,
      ['गाना', 'अगला', 'पिछला', 'पॉज़', 'प्ले', 'रोको']
    )
  ) {
    let mediaAct = 'play_pause';
    if (hasAny(lower, /\b(next|agla)\b/i, ['अगला'])) mediaAct = 'next';
    else if (hasAny(lower, /\b(prev|previous|pichla|peeche)\b/i, ['पिछला'])) mediaAct = 'previous';
    else if (hasAny(lower, /\b(stop)\b/i, ['स्टॉप'])) mediaAct = 'stop';
    return { kind: 'media', mediaAct };
  }

  if (/\b(dark mode|light mode|dark theme|light theme|theme toggle)\b/i.test(lower)) {
    return { kind: 'theme', mode: lower.includes('light') ? 'light' : 'dark' };
  }

  const openMatch =
    lower.match(/^(?:open|launch|start|chalu|kholo|chalao)\s+(?:ek\s+|mera\s+)?([a-z0-9\s._-]{2,24})$/i) ||
    lower.match(/^([a-z0-9\s._-]{2,24})\s+(?:open|kholo|chalao|chala)$/i);
  if (openMatch) {
    const appTarget = openMatch[1].trim();
    if (!/\b(setting|settings|file|folder|tab|url|gaana|gana|music|song|track|volume|brightness|awaz|mode|theme|wifi)\b/i.test(appTarget)) {
      return { kind: 'open_app', appTarget };
    }
  }

  return null;
}

async function executePlannedClause(plan, api, runFast, userLang) {
  const reply = (en, hinglish, hi) =>
    userLang === 'english' ? en : userLang === 'hindi' ? hi || hinglish : hinglish;

  if (plan.kind === 'preset') {
    if (plan.preset === 'coding') {
      const pOut = await runFast('pc_power_tools', { action: 'power_plan', plan: 'high_performance' }, () => api.powerProfile('high_performance'));
      const aOut = await runFast('open_application', { app_name: 'vscode' }, () => api.openApp('vscode', ''));
      return {
        replyText: pOut.ok && aOut.ok
          ? reply('Coding mode activated with High Performance and VS Code', 'Coding mode on kar diya aur VS Code khol diya', 'कोडिंग मोड चालू कर दिया है')
          : pOut.error || aOut.error,
        tools: [
          { name: 'pc_power_tools', status: pOut.ok ? 'done' : 'error', args: { action: 'power_plan', plan: 'high_performance' } },
          { name: 'open_application', status: aOut.ok ? 'done' : 'error', args: { app_name: 'vscode' } },
        ],
      };
    }
    const tOut = await runFast('toggle_windows_theme', { mode: 'dark' }, () => api.theme('dark'));
    const bOut = await runFast('brightness_control', { action: 'set', level: 35 }, () => api.brightness('set', 35));
    return {
      replyText: tOut.ok && bOut.ok
        ? reply('Night focus mode enabled', 'Night focus mode on kar diya', 'नाइट फोकस मोड चालू कर दिया है')
        : tOut.error || bOut.error,
      tools: [
        { name: 'toggle_windows_theme', status: tOut.ok ? 'done' : 'error', args: { mode: 'dark' } },
        { name: 'brightness_control', status: bOut.ok ? 'done' : 'error', args: { action: 'set', level: 35 } },
      ],
    };
  }

  if (plan.kind === 'wifi') {
    const out = await runFast('get_wifi_status', { action: plan.mode }, () => api.wifi(plan.mode));
    return {
      replyText: out.ok
        ? plan.mode === 'status'
          ? String(out.result || 'Wi-Fi checked')
          : reply(`Wi-Fi turned ${plan.mode}`, `Wi-Fi ${plan.mode} kar diya`, `वाई-फाई ${plan.mode} कर दिया`)
        : out.error,
      tools: [{ name: 'get_wifi_status', status: out.ok ? 'done' : 'error', args: { action: plan.mode } }],
    };
  }

  if (plan.kind === 'volume') {
    const args = plan.action === 'set' ? { action: 'set', level: plan.pct } : { action: plan.action };
    const out = await runFast('control_volume', args, () => api.volume(plan.action, plan.pct !== null ? plan.pct : 15));
    return {
      replyText: out.ok
        ? plan.action === 'set'
          ? reply(`volume set to ${plan.pct}%`, `volume ${plan.pct}% kar diya`, `वॉल्यूम ${plan.pct}% कर दिया`)
          : reply(`volume ${plan.action}`, `volume ${plan.action} kar diya`, `वॉल्यूम बदल दिया`)
        : out.error,
      tools: [{ name: 'control_volume', status: out.ok ? 'done' : 'error', args }],
    };
  }

  if (plan.kind === 'brightness') {
    const args = plan.action === 'set' ? { action: 'set', level: plan.pct } : { action: plan.action };
    const out = await runFast('brightness_control', args, () => api.brightness(plan.action, plan.pct !== null ? plan.pct : 15));
    return {
      replyText: out.ok
        ? plan.action === 'set'
          ? reply(`brightness set to ${plan.pct}%`, `brightness ${plan.pct}% kar di`, `ब्राइटनेस ${plan.pct}% कर दी`)
          : reply(`brightness adjusted`, `brightness adjust kar di`, `ब्राइटनेस बदल दी`)
        : out.error,
      tools: [{ name: 'brightness_control', status: out.ok ? 'done' : 'error', args }],
    };
  }

  if (plan.kind === 'media') {
    const out = await runFast('media_control', { action: plan.mediaAct }, () => api.media(plan.mediaAct));
    return {
      replyText: out.ok ? reply('media updated', 'media update kar diya', 'मीडिया अपडेट कर दिया') : out.error,
      tools: [{ name: 'media_control', status: out.ok ? 'done' : 'error', args: { action: plan.mediaAct } }],
    };
  }

  if (plan.kind === 'theme') {
    const out = await runFast('toggle_windows_theme', { mode: plan.mode }, () => api.theme(plan.mode));
    return {
      replyText: out.ok ? reply(`${plan.mode} mode enabled`, `${plan.mode} mode on kar diya`, `${plan.mode} मोड चालू कर दिया`) : out.error,
      tools: [{ name: 'toggle_windows_theme', status: out.ok ? 'done' : 'error', args: { mode: plan.mode } }],
    };
  }

  if (plan.kind === 'type_text') {
    const ranTools = [];
    if (plan.targetApp && typeof api.openApp === 'function') {
      const appOut = await runFast('open_application', { app_name: plan.targetApp }, () => api.openApp(plan.targetApp, ''));
      ranTools.push({ name: 'open_application', status: appOut.ok ? 'done' : 'error', args: { app_name: plan.targetApp } });
      if (!appOut.ok) return { replyText: appOut.error, tools: ranTools };
      await new Promise((r) => setTimeout(r, (typeof process !== 'undefined' && process?.env?.NODE_ENV) ? 25 : 420));
    }
    if (typeof api.typeClipboard !== 'function') return { replyText: 'Typing is not available.', tools: ranTools };
    const typeOut = await runFast('type_text', { text: plan.textToType }, () => api.typeClipboard(plan.textToType));
    ranTools.push({ name: 'type_text', status: typeOut.ok ? 'done' : 'error', args: { text: plan.textToType } });
    return {
      replyText: typeOut.ok
        ? plan.targetApp
          ? reply(
              `I opened ${plan.targetApp} and typed "${plan.textToType}".`,
              `${plan.targetApp} mein "${plan.textToType}" type kar diya hai.`,
              `${plan.targetApp} में "${plan.textToType}" टाइप कर दिया है।`
            )
          : reply(
              `I have typed "${plan.textToType}".`,
              `"${plan.textToType}" type kar diya hai.`,
              `"${plan.textToType}" टाइप कर दिया है।`
            )
        : typeOut.error,
      tools: ranTools,
    };
  }

  if (plan.kind === 'named_play') {
    if (typeof api.openURL !== 'function') return { replyText: 'URL opener unavailable.', tools: [] };
    const out = await runFast('open_url', { url: plan.url }, () => api.openURL(plan.url));
    return {
      replyText: out.ok
        ? plan.useSpotify
          ? reply(
              `Opening "${plan.query}" on Spotify.`,
              `Spotify par "${plan.query}" khol diya hai.`,
              `Spotify पर "${plan.query}" खोल दिया है।`
            )
          : reply(
              `Playing "${plan.query}" on YouTube.`,
              `YouTube par "${plan.query}" play kar diya hai.`,
              `YouTube पर "${plan.query}" चला दिया है।`
            )
        : out.error,
      tools: [{ name: 'open_url', status: out.ok ? 'done' : 'error', args: { url: plan.url } }],
    };
  }

  if (plan.kind === 'scroll') {
    if (typeof api.mouseAction !== 'function') return { replyText: 'Scroll unavailable.', tools: [] };
    const delta = plan.direction === 'up' ? 480 : -480;
    const out = await runFast('scroll_screen', { direction: plan.direction }, () =>
      api.mouseAction('scroll', null, null, null, null, delta, 'pixels')
    );
    return {
      replyText: out.ok
        ? plan.direction === 'up'
          ? reply('Scrolled up.', 'Upar scroll kar diya hai.', 'ऊपर स्क्रॉल कर दिया है।')
          : reply('Scrolled down.', 'Neeche scroll kar diya hai.', 'नीचे स्क्रॉल कर दिया है।')
        : out.error,
      tools: [{ name: 'scroll_screen', status: out.ok ? 'done' : 'error', args: { direction: plan.direction } }],
    };
  }

  if (plan.kind === 'hotkey') {
    if (typeof api.sendHotkey !== 'function') return { replyText: 'Shortcut unavailable.', tools: [] };
    const out = await runFast('press_shortcut', { shortcut: plan.combo }, () => api.sendHotkey(plan.combo));
    return {
      replyText: out.ok
        ? reply(`Pressed ${plan.combo.toUpperCase()}.`, `${plan.combo.toUpperCase()} kar diya hai.`, `${plan.combo.toUpperCase()} कर दिया है।`)
        : out.error,
      tools: [{ name: 'press_shortcut', status: out.ok ? 'done' : 'error', args: { shortcut: plan.combo } }],
    };
  }

  if (plan.kind === 'open_app') {
    const out = await runFast('open_application', { app_name: plan.appTarget }, () => api.openApp(plan.appTarget, ''));
    if (out.ok) lastVoiceAppTarget = plan.appTarget;
    return {
      replyText: out.ok ? reply(`opened ${plan.appTarget}`, `${plan.appTarget} khol diya`, `${plan.appTarget} खोल दिया`) : out.error,
      tools: [{ name: 'open_application', status: out.ok ? 'done' : 'error', args: { app_name: plan.appTarget } }],
    };
  }

  return { replyText: '', tools: [] };
}

async function trySingleFastVoiceAction(rawText, requestPermission = null) {
  const api = getSystemAPI();
  if (!api) return { handled: false };

  const userLang = detectCommandLanguage(rawText);
  const runFast = (toolName, toolArgs, execFn) =>
    runAuthorizedFastTool(toolName, toolArgs, execFn, requestPermission, {
      userLang,
      userPrompt: rawText,
    });
  const reply = (en, hinglish, hi) =>
    userLang === 'english' ? en : userLang === 'hindi' ? hi || hinglish : hinglish;

  const wake = matchWakePhrase(rawText);
  const cleaned = (wake.matched && wake.command ? wake.command : String(rawText || ''))
    .replace(/\b(please|plz|zara|thoda|abhi|jaldi|bhai|yaar|karo|karde|krde|kardo|kar do|ho jaye)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const lower = cleaned.toLowerCase();
  if (!lower) return { handled: false };

  const hasCompoundConjunction = /\b(and|then|phir)\b/i.test(lower);

  // A. Universal Type Anywhere ("type hello world", "notepad mein likho hello world", "notepad me hello type karo")
  if (!hasCompoundConjunction) {
    const typePlan = parseTypeCommand(rawText);
    if (typePlan && typeof api.typeClipboard === 'function') {
      const res = await executePlannedClause(typePlan, api, runFast, userLang);
      return { handled: true, ...res };
    }
  }

  // B. Named Video / Song Playback ("play kesariya", "kesariya chala do", "youtube par arijit singh play karo")
  if (!hasCompoundConjunction) {
    const playPlan = parseNamedPlayCommand(rawText);
    if (playPlan && typeof api.openURL === 'function') {
      const res = await executePlannedClause(playPlan, api, runFast, userLang);
      return { handled: true, ...res };
    }
  }

  // Never intercept multi-clause, deictic context queries, or complex winget/UIA tasks
  const isReadStatusCheck = /\b(top process|top processes|cpu status|ram status|pc health|system health|disk space|battery|clipboard history|active tab|wifi status)\b/i.test(lower);
  const isHindiMoreModifier = /\baur\s+(badhao|badha|kam|ghatao|tez|dheema|dhima|up|down|high|low)\b/i.test(lower);
  if (
    (/\b(and|then|phir|kyun|why|what|how|kya|kaise|install|uninstall|explain|likho|write|pdf|search|google|isko|is\s+error|yahan)\b/i.test(lower)) ||
    (/\baur\b/i.test(lower) && !isHindiMoreModifier) ||
    (!isReadStatusCheck && /\bbatao\b/i.test(lower))
  ) {
    return { handled: false };
  }

  // C. Universal Active-App Scroll & Quick Hotkeys (Copy, Paste, Undo, Save, Select All, Enter)
  const scrollHotkeyPlan = parseScrollOrHotkeyCommand(cleaned);
  if (scrollHotkeyPlan) {
    const res = await executePlannedClause(scrollHotkeyPlan, api, runFast, userLang);
    return { handled: true, ...res };
  }

  // 0. Presets & Wi-Fi single commands
  if (/\b(coding mode|developer mode|work mode)\b/i.test(lower)) {
    const res = await executePlannedClause({ kind: 'preset', preset: 'coding' }, api, runFast, userLang);
    return { handled: true, ...res };
  }
  if (/\b(night mode|night focus|focus mode)\b/i.test(lower)) {
    const res = await executePlannedClause({ kind: 'preset', preset: 'night' }, api, runFast, userLang);
    return { handled: true, ...res };
  }
  if (/\b(wifi)\b/i.test(lower) && !/\b(password)\b/i.test(lower)) {
    const mode = /\b(off|band|disable)\b/i.test(lower)
      ? 'off'
      : /\b(on|chalu|enable)\b/i.test(lower)
        ? 'on'
        : 'status';
    const res = await executePlannedClause({ kind: 'wifi', mode }, api, runFast, userLang);
    return { handled: true, ...res };
  }

  // 1. Volume controls (supports both absolute "volume 50" and relative "sound 10% aur badha do")
  if (
    hasAny(lower, /\b(volume|vol|awaz|awaaz|sound|mute|unmute|chup)\b/i, ['आवाज़', 'आवाज', 'वॉल्यूम', 'म्यूट'])
  ) {
    let pct = extractNumber0to100(lower);
    const wantsUp = hasAny(lower, /\b(up|high|badhao|badha|badao|bada|tez|zyada|jyada|increase|raise|louder|plus|boost)\b/i, ['बढ़ाओ', 'बढ़ा', 'तेज', 'ज्यादा']);
    const wantsDown = hasAny(lower, /\b(down|low|lower|kam|ghatao|ghata|dheema|dhima|decrease|reduce|quieter|minus)\b/i, ['कम', 'घटाओ', 'धीमा']);
    const wantsFull = /\b(full|max|maximum)\b/i.test(lower);
    const wantsMin = /\b(min|minimum)\b/i.test(lower);
    let action = null;
    if (hasAny(lower, /\b(unmute|awaz chalu|sound on)\b/i, ['अनम्यूट'])) action = 'unmute';
    else if (hasAny(lower, /\b(mute|chup|silent|awaz band|sound off)\b/i, ['म्यूट', 'चुप'])) action = 'mute';
    else if (wantsFull) { action = 'set'; pct = 100; }
    else if (wantsMin) { action = 'set'; pct = 10; }
    else if (wantsUp) action = 'up';
    else if (wantsDown) action = 'down';
    else if (pct !== null) action = 'set';

    if (action) {
      const step = pct !== null ? pct : 15;
      const args = action === 'set' ? { action, level: pct } : { action, level: step };
      const out = await runFast('control_volume', args, () => api.volume(action, step));
      return {
        handled: true,
        replyText: out.ok
          ? action === 'set'
            ? reply(`I have set volume to ${pct}%.`, `Volume ${pct}% kar diya hai.`, `वॉल्यूम ${pct}% कर दिया है।`)
            : action === 'mute'
            ? reply('I have muted the volume.', 'Volume mute kar diya hai.', 'आवाज़ म्यूट कर दी है।')
            : action === 'unmute'
            ? reply('I have unmuted the volume.', 'Volume unmute kar diya hai.', 'आवाज़ अनम्यूट कर दी है।')
            : action === 'up'
            ? reply(pct !== null ? `Increased volume by ${pct}%.` : 'I have increased the volume.', pct !== null ? `Volume ${pct}% aur badha diya hai.` : 'Volume badha diya hai.', pct !== null ? `वॉल्यूम ${pct}% और बढ़ा दिया है।` : 'आवाज़ बढ़ा दी है।')
            : reply(pct !== null ? `Lowered volume by ${pct}%.` : 'I have lowered the volume.', pct !== null ? `Volume ${pct}% kam kar diya hai.` : 'Volume kam kar diya hai.', pct !== null ? `वॉल्यूम ${pct}% कम कर दिया है।` : 'आवाज़ कम कर दी है।')
          : out.error,
        tools: [{ name: 'control_volume', status: out.ok ? 'done' : 'error', args }],
      };
    }
  }

  // 2. Brightness controls (supports both absolute "brightness 80" and relative "brightness 10% aur badha do")
  if (hasAny(lower, /\b(brightness|roshni|light level|chamka)\b/i, ['ब्राइटनेस', 'स्क्रीन लाइट', 'रोशनी'])) {
    let pct = extractNumber0to100(lower);
    const wantsUp = hasAny(lower, /\b(up|high|badhao|badha|badao|bada|tez|zyada|jyada|increase|raise|brighter|plus|boost)\b/i, ['बढ़ाओ', 'बढ़ा', 'तेज', 'ज्यादा']);
    const wantsDown = hasAny(lower, /\b(down|low|lower|kam|ghatao|ghata|decrease|reduce|dim|dimmer|minus)\b/i, ['कम', 'घटाओ']);
    const wantsFull = /\b(full|max|maximum)\b/i.test(lower);
    const wantsMin = /\b(min|minimum)\b/i.test(lower);
    let action = null;
    if (wantsFull) { action = 'set'; pct = 100; }
    else if (wantsMin) { action = 'set'; pct = 10; }
    else if (wantsUp) action = 'up';
    else if (wantsDown) action = 'down';
    else if (pct !== null) action = 'set';

    if (action) {
      const step = pct !== null ? pct : 15;
      const args = action === 'set' ? { action, level: pct } : { action, level: step };
      const out = await runFast('brightness_control', args, () => api.brightness(action, step));
      return {
        handled: true,
        replyText: out.ok
          ? action === 'set'
            ? reply(`I have set brightness to ${pct}%.`, `Brightness ${pct}% kar di hai.`, `ब्राइटनेस ${pct}% कर दी है।`)
            : action === 'up'
            ? reply(pct !== null ? `Increased brightness by ${pct}%.` : 'I have increased screen brightness.', pct !== null ? `Brightness ${pct}% aur badha di hai.` : 'Brightness badha di hai.', pct !== null ? `ब्राइटनेस ${pct}% और बढ़ा दी है।` : 'ब्राइटनेस बढ़ा दी है।')
            : reply(pct !== null ? `Lowered brightness by ${pct}%.` : 'I have lowered screen brightness.', pct !== null ? `Brightness ${pct}% kam kar di hai.` : 'Brightness kam kar di hai.', pct !== null ? `ब्राइटनेस ${pct}% कम कर दी है।` : 'ब्राइटनेस कम कर दी है।')
          : out.error,
        tools: [{ name: 'brightness_control', status: out.ok ? 'done' : 'error', args }],
      };
    }
  }

  // 3. Media Playback (Play / Pause / Next / Previous / Stop)
  if (
    hasAny(
      lower,
      /^(play|pause|resume|stop|next|previous|roko|band|chalu|chala|bajao|lagao|agla|pichla|gaana|gana|music|song|track|media)(\s+(song|music|gaana|gana|track|video|media|play|pause|next|previous|stop|roko|band|chalu|chala|bajao|lagao)){0,3}$/i,
      ['गाना', 'अगला', 'पिछला', 'पॉज़', 'प्ले', 'रोको']
    )
  ) {
    let mediaAct = 'play_pause';
    if (hasAny(lower, /\b(next|agla)\b/i, ['अगला'])) mediaAct = 'next';
    else if (hasAny(lower, /\b(prev|previous|pichla|peeche)\b/i, ['पिछला'])) mediaAct = 'previous';
    else if (hasAny(lower, /\b(stop)\b/i, ['स्टॉप'])) mediaAct = 'stop';

    const out = await runFast('media_control', { action: mediaAct }, () => api.media(mediaAct));
    return {
      handled: true,
      replyText: out.ok
        ? mediaAct === 'next'
          ? reply('Switched to the next track.', 'Agla track chala diya hai.', 'अगला गाना चला दिया है।')
          : mediaAct === 'previous'
          ? reply('Switched to the previous track.', 'Pichla track chala diya hai.', 'पिछला गाना चला दिया है।')
          : reply('Updated media playback.', 'Media playback update kar diya hai.', 'मीडिया अपडेट कर दिया है।')
        : out.error,
      tools: [{ name: 'media_control', status: out.ok ? 'done' : 'error', args: { action: mediaAct } }],
    };
  }

  // 4. Theme Dark/Light
  if (/\b(dark mode|light mode|dark theme|light theme|theme toggle)\b/i.test(lower)) {
    const mode = lower.includes('light') ? 'light' : 'dark';
    const out = await runFast('toggle_windows_theme', { mode }, () => api.theme(mode));
    return {
      handled: true,
      replyText: out.ok
        ? reply(
            `I have switched Windows to ${mode} mode.`,
            `Windows mein ${mode} mode on kar diya hai.`,
            `विंडोज़ ${mode} मोड चालू कर दिया है।`
          )
        : out.error,
      tools: [{ name: 'toggle_windows_theme', status: out.ok ? 'done' : 'error', args: { mode } }],
    };
  }

  // 5. Minimize all / Show desktop
  if (/\b(minimize all|sab minimize|show desktop|desktop dikhao|window minimize)\b/i.test(lower)) {
    const out = await runFast('press_shortcut', { shortcut: 'minimize_all' }, () => api.minimizeAll());
    return {
      handled: true,
      replyText: out.ok
        ? reply('I have minimized all windows.', 'Sabhi windows minimize kar di hain.', 'सभी विंडोज़ मिनिमाइज़ कर दी हैं।')
        : out.error,
      tools: [{ name: 'press_shortcut', status: out.ok ? 'done' : 'error', args: { shortcut: 'minimize_all' } }],
    };
  }

  // 6. Screenshot
  if (/\b(screenshot|screen shot|capture screen)\b/i.test(lower) && !/\b(analyze|read|kya hai|check|describe|dikha)\b/i.test(lower)) {
    const out = await runFast('take_screenshot', {}, () => api.screenshot());
    return {
      handled: true,
      replyText: out.ok
        ? reply('I have taken a screenshot of your screen.', 'Screen ka screenshot le liya hai.', 'स्क्रीनशॉट ले लिया है।')
        : out.error,
      image: out.ok ? out.result?.base64 : null,
      tools: [{ name: 'take_screenshot', status: out.ok ? 'done' : 'error', args: {} }],
    };
  }

  // 7. Quick simple app launch / close ("chrome kholo", "open notepad", "notepad band karo")
  const openMatch = lower.match(/^(?:open|launch|start|chalu|kholo|chalao)\s+(?:ek\s+|mera\s+)?([a-z0-9\s._-]{2,24})$/i) ||
    lower.match(/^([a-z0-9\s._-]{2,24})\s+(?:open|kholo|chalao|chala|khol do|chala do)$/i);
  if (openMatch) {
    const appTarget = openMatch[1].trim();
    if (!/\b(setting|settings|file|folder|tab|url|gaana|gana|music|song|track|volume|brightness|awaz|mode|theme|incognito|private|downloads|history|bookmarks|github|pulls|issues|notifications|terminal|command palette|sidebar)\b/i.test(appTarget)) {
      const out = await runFast('open_application', { app_name: appTarget }, () => api.openApp(appTarget, ''));
      if (out.ok) lastVoiceAppTarget = appTarget;
      return {
        handled: true,
        replyText: out.ok
          ? reply(`I have opened ${appTarget}.`, `Maine ${appTarget} khol diya hai.`, `मैंने ${appTarget} खोल दिया है।`)
          : out.error,
        tools: [{ name: 'open_application', status: out.ok ? 'done' : 'error', args: { app_name: appTarget } }],
      };
    }
  }

  const closeMatch = lower.match(/^(?:close|band|band do|quit|exit)\s+([a-z0-9\s._-]{2,24})$/i) ||
    lower.match(/^([a-z0-9\s._-]{2,24})\s+(?:close|band|band do|exit|quit)$/i);
  if (closeMatch) {
    const appTarget = closeMatch[1].trim();
    if (!/\b(tab|window|pc|computer|laptop|system|awaz|sound|volume|screen)\b/i.test(appTarget)) {
      const out = await runFast('close_application', { app_name: appTarget }, () => api.closeApp(appTarget));
      if (out.ok && lastVoiceAppTarget?.toLowerCase() === appTarget.toLowerCase()) lastVoiceAppTarget = null;
      return {
        handled: true,
        replyText: out.ok
          ? reply(`I have closed ${appTarget}.`, `Maine ${appTarget} band kar diya hai.`, `मैंने ${appTarget} बंद कर दिया है।`)
          : out.error,
        tools: [{ name: 'close_application', status: out.ok ? 'done' : 'error', args: { app_name: appTarget } }],
      };
    }
  }

  // 8. Clipboard History
  if (
    hasAny(
      lower,
      /\b(clipboard history|copied history|clipboard me kya|clipboard mein kya|kya copy kiya)\b/i,
      ['क्लिपबोर्ड']
    )
  ) {
    const out = await runAuthorizedFastTool(
      'clipboard_history',
      { action: 'list' },
      () => api.clipboardHistory('list', 0),
      requestPermission
    );
    const items = out.ok ? (out.result?.items || []) : [];
    const preview = items[0]?.preview ? ` Latest: ${items[0].preview.slice(0, 50)}` : '';
    return {
      handled: true,
      replyText: out.ok
        ? items.length
          ? `Clipboard mein ${items.length} items saved hain.${preview}`
          : 'Clipboard history abhi khali hai.'
        : out.error,
      tools: [{ name: 'clipboard_history', status: out.ok ? 'done' : 'error', args: { action: 'list' } }],
    };
  }

  // 9. Top Processes
  if (
    hasAny(
      lower,
      /\b(top process|top processes|ram kaun kha|ram kon kha|cpu kon use|cpu kaun use|heavy apps)\b/i,
      ['प्रोसेस', 'हैवी ऐप']
    )
  ) {
    const out = await runAuthorizedFastTool(
      'system_diagnostics',
      { action: 'top_processes' },
      () => api.diagnostics('top_processes', ''),
      requestPermission
    );
    let summary = 'Top memory processes nikal liye hain.';
    if (out.ok && typeof out.result === 'string') {
      try {
        const list = JSON.parse(out.result);
        if (Array.isArray(list) && list.length > 0) {
          summary = `Top RAM apps: ${list.slice(0, 3).map((p) => `${p.name} (${p.ramMb} MB)`).join(', ')}.`;
        }
      } catch {}
    }
    return {
      handled: true,
      replyText: out.ok ? summary : out.error,
      tools: [{ name: 'system_diagnostics', status: out.ok ? 'done' : 'error', args: { action: 'top_processes' } }],
    };
  }

  // 10. CPU / RAM / Disk Overview
  if (
    hasAny(
      lower,
      /\b(cpu status|ram status|pc health|system health|disk space|storage kitna)\b/i,
      ['सीपीयू', 'रैम', 'स्टोरेज']
    )
  ) {
    const out = await runAuthorizedFastTool(
      'system_diagnostics',
      { action: 'overview' },
      () => api.diagnostics('overview', ''),
      requestPermission
    );
    let summary = 'PC health check complete.';
    if (out.ok && typeof out.result === 'string') {
      try {
        const info = JSON.parse(out.result);
        const firstDisk = Array.isArray(info.disks) ? info.disks[0] : info.disks;
        summary = `RAM ${info.ramUsedPct}% used hai, ${info.ramFreeGb} GB free.${firstDisk ? ` ${firstDisk.drive} drive mein ${firstDisk.freeGb} GB free hai.` : ''}`;
      } catch {}
    }
    return {
      handled: true,
      replyText: out.ok ? summary : out.error,
      tools: [{ name: 'system_diagnostics', status: out.ok ? 'done' : 'error', args: { action: 'overview' } }],
    };
  }

  // 11. Power Plan Switch ("high performance mode", "balanced mode", "power saver mode")
  if (
    hasAny(
      lower,
      /\b(high performance mode|performance mode|gaming mode|balanced mode|power saver mode|battery saver)\b/i,
      ['पावर सेवर', 'परफॉर्मेंस']
    )
  ) {
    const plan = lower.includes('performance') || lower.includes('gaming') || lower.includes('परफॉर्मेंस')
      ? 'high_performance'
      : lower.includes('saver') || lower.includes('पावर सेवर')
        ? 'power_saver'
        : 'balanced';
    const out = await runFast('pc_power_tools', { action: 'power_plan', plan }, () => api.powerProfile(plan));
    return {
      handled: true,
      replyText: out.ok
        ? reply(
            `I have set the power plan to ${plan.replace('_', ' ')}.`,
            `Power plan ${plan.replace('_', ' ')} par set kar diya hai.`,
            `पावर प्लान ${plan.replace('_', ' ')} पर सेट कर दिया है।`
          )
        : out.error,
      tools: [{ name: 'pc_power_tools', status: out.ok ? 'done' : 'error', args: { action: 'power_plan', plan } }],
    };
  }

  // 12. Battery check
  if (hasAny(lower, /\b(battery|battery status|battery kitni|charging status)\b/i, ['बैटरी'])) {
    const out = await runAuthorizedFastTool(
      'get_battery_status',
      {},
      () => api.battery(),
      requestPermission
    );
    return {
      handled: true,
      replyText: out.ok ? String(out.result || 'Battery checked.') : out.error,
      tools: [{ name: 'get_battery_status', status: out.ok ? 'done' : 'error', args: {} }],
    };
  }

  // 13. Browser Tab & YouTube controls
  if (
    hasAny(
      lower,
      /\b(new tab|naya tab|close tab|tab band|next tab|agla tab|previous tab|prev tab|pichla tab|skip ad|ad skip|youtube skip|active tab)\b/i,
      ['नया टैब', 'टैब बंद', 'स्किप']
    )
  ) {
    const action = lower.includes('close') || lower.includes('band') || lower.includes('बंद')
      ? 'close_tab'
      : lower.includes('next') || lower.includes('agla')
        ? 'next_tab'
        : lower.includes('prev') || lower.includes('pichla')
          ? 'prev_tab'
          : lower.includes('skip') || lower.includes('स्किप')
            ? 'youtube_skip_ad'
            : lower.includes('active')
              ? 'active_tab_info'
              : 'new_tab';
    const out = await runFast('browser_control', { action }, () => api.browserControl(action, ''));
    return {
      handled: true,
      replyText: out.ok
        ? typeof out.result === 'string'
          ? out.result
          : reply('Browser action completed.', 'Browser action poora kar diya hai.', 'ब्राउज़र कार्य पूरा कर दिया है।')
        : out.error,
      tools: [{ name: 'browser_control', status: out.ok ? 'done' : 'error', args: { action } }],
    };
  }

  return { handled: false };
}
