// Zero-API Tier-0 + Tier-1 Local Quick Brain (Unified for Chat + Voice)
import { tryFastVoiceAction } from './voiceRouter.js';
import { classifyIntent } from './semanticIntent.js';
import { rememberUserMemory, recallRelevantMemories } from './memoryRag.js';
import { detectCommandLanguage } from './voicePermissionPrompt.js';
import { executeFunctionCall } from './tools.js';

function replyByLang(lang, en, hiMix, hi) {
  if (lang === 'english') return en;
  if (lang === 'hindi') return hi;
  return hiMix;
}

/**
 * Safe recursive-descent math parser (no eval / no Function constructor).
 */
function evaluateSafeMathExpr(exprRaw) {
  const expr = String(exprRaw || '').replace(/\s+/g, '');
  if (!expr || !/^[0-9+\-*/().%]+$/.test(expr) || expr.length > 80) return null;

  let pos = 0;
  function peek() {
    return expr[pos];
  }
  function parseNumber() {
    const start = pos;
    if (expr[pos] === '-' || expr[pos] === '+') pos++;
    let sawDigit = false;
    while (pos < expr.length && /[0-9.]/.test(expr[pos])) {
      sawDigit = true;
      pos++;
    }
    if (!sawDigit) throw new Error('bad number');
    const val = Number(expr.slice(start, pos));
    if (!Number.isFinite(val)) throw new Error('nan');
    return val;
  }
  function parseFactor() {
    if (peek() === '(') {
      pos++;
      const v = parseExpr();
      if (peek() !== ')') throw new Error('paren');
      pos++;
      return v;
    }
    return parseNumber();
  }
  function parseTerm() {
    let val = parseFactor();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = expr[pos++];
      const rhs = parseFactor();
      if (op === '*') val *= rhs;
      else if (op === '/') {
        if (rhs === 0) throw new Error('div0');
        val /= rhs;
      } else {
        val %= rhs;
      }
    }
    return val;
  }
  function parseExpr() {
    let val = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = expr[pos++];
      const rhs = parseTerm();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  }

  try {
    const result = parseExpr();
    if (pos !== expr.length || !Number.isFinite(result)) return null;
    return Number.isInteger(result) ? result : Number(result.toFixed(4));
  } catch {
    return null;
  }
}

function tryOfflineMathOrUnit(text, lang) {
  const clean = String(text || '').trim();
  const lower = clean.toLowerCase();

  // Percentage: "18% of 2450" or "2450 ka 18 percent"
  const pctMatch =
    lower.match(/^(\d+(?:\.\d+)?)\s*(?:%|percent)\s+(?:of|ka)\s+(\d+(?:\.\d+)?)\??$/i) ||
    lower.match(/^(\d+(?:\.\d+)?)\s+ka\s+(\d+(?:\.\d+)?)\s*(?:%|percent)\??$/i);
  if (pctMatch) {
    const a = Number(pctMatch[1]);
    const b = Number(pctMatch[2]);
    const isSecondPct = /\d+\s+ka\s+\d+/.test(lower);
    const pct = isSecondPct ? b : a;
    const base = isSecondPct ? a : b;
    const out = Number(((pct / 100) * base).toFixed(4));
    return {
      replyText: replyByLang(
        lang,
        `${pct}% of ${base} = **${out}**`,
        `${base} ka ${pct}% = **${out}**`,
        `${base} का ${pct}% = **${out}**`
      ),
    };
  }

  // Unit conversions: km<->mi, kg<->lb, mb<->gb<->tb, c<->f, hr<->min
  const unitMatch = lower.match(/^(-?\d+(?:\.\d+)?)\s*(km|mi|miles?|kg|lbs?|pounds?|mb|gb|tb|kb|c|f|hr|hrs|hour|hours|min|mins|minutes?)\s+(?:to|in|me|mein)\s+(km|mi|miles?|kg|lbs?|pounds?|mb|gb|tb|kb|c|f|hr|hrs|hour|hours|min|mins|minutes?)\??$/i);
  if (unitMatch) {
    const val = Number(unitMatch[1]);
    const from = unitMatch[2].replace(/s$/, '');
    const to = unitMatch[3].replace(/s$/, '');
    let out = null;

    if (from === 'km' && to.startsWith('mi')) out = val * 0.621371;
    else if (from.startsWith('mi') && to === 'km') out = val / 0.621371;
    else if (from === 'kg' && (to === 'lb' || to === 'pound')) out = val * 2.20462;
    else if ((from === 'lb' || from === 'pound') && to === 'kg') out = val / 2.20462;
    else if (from === 'c' && to === 'f') out = (val * 9) / 5 + 32;
    else if (from === 'f' && to === 'c') out = ((val - 32) * 5) / 9;
    else if ((from === 'hr' || from === 'hour') && to.startsWith('min')) out = val * 60;
    else if (from.startsWith('min') && (to === 'hr' || to === 'hour')) out = val / 60;
    else {
      const storageScale = { kb: 1, mb: 1024, gb: 1024 * 1024, tb: 1024 * 1024 * 1024 };
      if (storageScale[from] && storageScale[to]) {
        out = (val * storageScale[from]) / storageScale[to];
      }
    }

    if (out !== null) {
      const rounded = Number.isInteger(out) ? out : Number(out.toFixed(4));
      return { replyText: `${val} ${unitMatch[2]} = **${rounded} ${unitMatch[3]}**` };
    }
  }

  // Raw arithmetic: e.g. "245 * 18", "what is 1500 / 12", "(500 + 200) * 2"
  const stripped = lower
    .replace(/^(?:calculate|calc|what is|kitna hoga|batao)\s+/i, '')
    .replace(/[=?]+$/g, '')
    .trim();
  if (/[+\-*/%]/.test(stripped) && /^\(?-?\d/.test(stripped)) {
    const res = evaluateSafeMathExpr(stripped);
    if (res !== null) {
      return { replyText: `${stripped} = **${res}**` };
    }
  }
  return null;
}

function tryDateTimeOrSmalltalk(text, lang) {
  const lower = String(text || '').trim().toLowerCase();
  if (!lower) return null;

  if (/\b(time kya|kya time|abhi time|what time|current time|baje hain)\b/i.test(lower) || /^(time|samay)\??$/i.test(lower)) {
    const nowStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    return {
      replyText: replyByLang(lang, `The current time is **${nowStr}**.`, `Abhi **${nowStr}** baj rahe hain.`, `अभी **${nowStr}** बज रहे हैं।`),
    };
  }

  if (/\b(aaj date|today date|what is the date|aaj ka din|today day|kaun sa din)\b/i.test(lower) || /^(date|day)\??$/i.test(lower)) {
    const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return {
      replyText: replyByLang(lang, `Today is **${dateStr}**.`, `Aaj **${dateStr}** hai.`, `आज **${dateStr}** है।`),
    };
  }

  if (/^(hi|hello|hey|namaste|namaskar|hello jeeva|hi jeeva|hey jeeva)[!.]*$/i.test(lower)) {
    return {
      replyText: replyByLang(
        lang,
        'Hello! JEEVA Local Brain is ready. Tell me what PC task, draft, or quick question you have.',
        'Namaste! JEEVA Local Brain ready hai — batayein aaj kaun sa PC task ya kaam karna hai?',
        'नमस्ते! जीवा लोकल ब्रेन तैयार है — बताइए आज क्या काम करना है?'
      ),
    };
  }

  if (/^(thanks|thank you|shukriya|dhanyawad|thx|ok|okay|theek hai|badhiya|nice)[!.]*$/i.test(lower)) {
    return {
      replyText: replyByLang(
        lang,
        'You are welcome! Let me know whenever you need anything else.',
        'Koi baat nahi! Kuch aur kaam ho toh batayein.',
        'कोई बात नहीं! कोई और काम हो तो बताइए।'
      ),
    };
  }

  if (/\b(kaise ho|kya haal|how are you|tum kaun ho|who are you|tum kya kar sakte ho|what can you do)\b/i.test(lower) && lower.length < 70) {
    return {
      replyText: replyByLang(
        lang,
        'I am JEEVA AI — your Hybrid PC Assistant. I handle daily PC controls, timers, diagnostics, math, memory & drafts offline using your Local Brain, and call Gemini Cloud only for heavy tasks.',
        'Main badhiya hoon! Main JEEVA AI hoon — chhote aur moderate PC commands, diagnostics, math, reminders aur memory kaam main bina Gemini API ke Local Brain se kar sakta hoon, aur bade kaam Gemini Cloud se karta hoon.',
        'मैं बढ़िया हूँ! मैं जीवा AI हूँ — रोज़मर्रा के PC कमांड, डायग्नोस्टिक्स, मेमोरी और रिमाइंडर मैं लोकल ब्रेन से बिना API के कर सकता हूँ।'
      ),
    };
  }

  return null;
}

async function tryDirectMemoryRag(text, lang) {
  const clean = String(text || '').trim();
  const lower = clean.toLowerCase();

  // Save fact locally without LLM
  const rememberMatch = clean.match(/^(?:yaad rakho|yaad rakhna|remember that|remember|note kar lo)\s+(?:ki\s+)?(.{5,300})$/i);
  if (rememberMatch) {
    const fact = rememberMatch[1].trim();
    const res = await rememberUserMemory(fact, 'preference');
    if (res?.success || res?.ok) {
      return {
        replyText: replyByLang(
          lang,
          `Got it — saved to your local memory: "${fact}"`,
          `Samajh gaya — maine local memory me save kar liya: "${fact}"`,
          `समझ गया — मैंने लोकल मेमोरी में सेव कर लिया: "${fact}"`
        ),
        tools: [{ name: 'memory_rag', status: 'done', args: { action: 'remember', content: fact } }],
      };
    }
  }

  // Recall fact locally without LLM
  if (
    /\b(memory|yaad kiya|remember|project path|kahan rakha|kahan hai|mera folder|my preference)\b/i.test(lower) &&
    clean.length < 110
  ) {
    const items = await recallRelevantMemories(clean, 3);
    if (Array.isArray(items) && items.length > 0 && (items[0].score === undefined || items[0].score >= 0.22)) {
      const topList = items.map((m, idx) => `${idx + 1}. ${m.content}`).join('\n');
      return {
        replyText: replyByLang(
          lang,
          `Here is what I remember locally:\n${topList}`,
          `Local memory me mujhe ye mila:\n${topList}`,
          `लोकल मेमोरी में यह जानकारी मिली:\n${topList}`
        ),
        tools: [{ name: 'memory_rag', status: 'done', args: { action: 'recall', query: clean } }],
      };
    }
  }

  return null;
}

export function buildLocalTitle(text) {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim();
  const words = cleaned.split(' ').filter(Boolean).slice(0, 5);
  return words.length ? words.join(' ') : 'Quick Task';
}

/**
 * Unified Tier-0 + Tier-1 Local Execution Engine.
 * Works identically for BOTH typed Chat messages and Voice commands.
 */
export async function runLocalQuickBrain(text, { requestPermission = null } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return { handled: false };
  const lang = detectCommandLanguage(clean);

  // 1. Tier-0 Math & Unit Conversions
  const mathHit = tryOfflineMathOrUnit(clean, lang);
  if (mathHit) {
    return {
      handled: true,
      tier: 'fast',
      modelLabel: 'Instant Math',
      replyText: mathHit.replyText,
      tools: [],
    };
  }

  // 2. Tier-0 Date, Time & Casual Smalltalk
  const smallHit = tryDateTimeOrSmalltalk(clean, lang);
  if (smallHit) {
    return {
      handled: true,
      tier: 'fast',
      modelLabel: 'Instant Brain',
      replyText: smallHit.replyText,
      tools: [],
    };
  }

  // 3. Tier-0 Direct Persistent Memory RAG (Save / Recall with 0 LLM tokens)
  const memHit = await tryDirectMemoryRag(clean, lang);
  if (memHit) {
    return {
      handled: true,
      tier: 'fast',
      modelLabel: 'Local Memory RAG',
      replyText: memHit.replyText,
      tools: memHit.tools || [],
    };
  }

  // 4. Tier-0 Deterministic OS & App Chained Router (now enabled for Chat + Voice!)
  const fastOs = await tryFastVoiceAction(clean, requestPermission);
  if (fastOs?.handled) {
    return {
      handled: true,
      tier: 'fast',
      modelLabel: 'Instant OS Router',
      replyText: fastOs.replyText,
      image: fastOs.image || null,
      tools: fastOs.tools || [],
    };
  }

  // 5. Tier-1 Semantic Hinglish/English Intent Classifier (for natural messy phrasing)
  // Avoid hijacking conversational questions ("how", "explain", "write", "kya hota hai")
  const looksConversational =
    /\b(explain|write|draft|code|story|essay|why|samjhao|kya hota|difference between|compare|banao ek)\b/i.test(clean);
  if (!looksConversational) {
    const intent = classifyIntent(clean);
    if (intent && intent.confidence >= 0.72) {
      const result = await executeFunctionCall(intent.tool, intent.args, requestPermission, {
        fromVoice: false,
        userPrompt: clean,
      });
      const ok = !result?.error;
      const msg =
        result?.result ||
        result?.error ||
        (ok ? `Completed ${intent.tool.replace(/_/g, ' ')}.` : 'Action failed.');
      return {
        handled: true,
        tier: 'intent',
        modelLabel: `Intent Router (${Math.round(intent.confidence * 100)}%)`,
        replyText: typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2),
        image: result?.screenshot || null,
        tools: [{ name: intent.tool, status: ok ? 'done' : 'error', args: intent.args }],
      };
    }
  }

  return { handled: false };
}
