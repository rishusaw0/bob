// Hybrid Brain Router — Mode Management, Complexity Gatekeeper, History Compactor & Savings Telemetry
import { isTextOrDocAttachment } from './docExtractor.js';

const BRAIN_MODE_KEY = 'jeeva_brain_mode'; // 'auto' | 'offline' | 'cloud'
const BRAIN_STATS_KEY = 'jeeva_brain_stats';

function loadStats() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BRAIN_STATS_KEY) || '{}');
    return {
      localFast: Number(parsed.localFast) || 0,
      localIntent: Number(parsed.localIntent) || 0,
      localSlm: Number(parsed.localSlm) || 0,
      cloudCalls: Number(parsed.cloudCalls) || 0,
      estimatedTokensSaved: Number(parsed.estimatedTokensSaved) || 0,
    };
  } catch {
    return { localFast: 0, localIntent: 0, localSlm: 0, cloudCalls: 0, estimatedTokensSaved: 0 };
  }
}

export function getBrainMode() {
  try {
    const m = localStorage.getItem(BRAIN_MODE_KEY) || 'auto';
    return ['auto', 'offline', 'cloud'].includes(m) ? m : 'auto';
  } catch {
    return 'auto';
  }
}

export function setBrainMode(mode) {
  const clean = ['auto', 'offline', 'cloud'].includes(mode) ? mode : 'auto';
  try {
    localStorage.setItem(BRAIN_MODE_KEY, clean);
    window.dispatchEvent(new CustomEvent('jeeva-brain-mode-changed', { detail: clean }));
  } catch {}
  return clean;
}

export function getBrainStats() {
  const s = loadStats();
  const totalLocal = s.localFast + s.localIntent + s.localSlm;
  const totalAll = totalLocal + s.cloudCalls;
  const localPct = totalAll > 0 ? Math.round((totalLocal / totalAll) * 100) : 0;
  return { ...s, totalLocal, totalAll, localPct };
}

export function recordBrainUsage(tier, approxPromptChars = 120) {
  try {
    const stats = loadStats();
    const approxSaved = Math.max(350, Math.round(approxPromptChars / 3) + 650);
    if (tier === 'fast') {
      stats.localFast += 1;
      stats.estimatedTokensSaved += approxSaved;
    } else if (tier === 'intent') {
      stats.localIntent += 1;
      stats.estimatedTokensSaved += approxSaved;
    } else if (tier === 'local-slm') {
      stats.localSlm += 1;
      stats.estimatedTokensSaved += approxSaved + 450;
    } else if (tier === 'cloud') {
      stats.cloudCalls += 1;
    }
    localStorage.setItem(BRAIN_STATS_KEY, JSON.stringify(stats));
    window.dispatchEvent(new CustomEvent('jeeva-brain-stats-changed', { detail: getBrainStats() }));
  } catch {}
}

export function resetBrainStats() {
  try {
    localStorage.removeItem(BRAIN_STATS_KEY);
    window.dispatchEvent(new CustomEvent('jeeva-brain-stats-changed', { detail: getBrainStats() }));
  } catch {}
}

/**
 * Strips explicit routing prefixes (@cloud, /gemini, @local) and determines routing constraints.
 */
export function assessQueryRouting(text, attachment = null, mode = getBrainMode(), env = {}) {
  let cleanText = String(text || '').trim();
  let forceCloud = false;
  let forceLocal = false;

  if (/^(?:@cloud|@gemini|\/cloud|\/gemini)\b/i.test(cleanText)) {
    forceCloud = true;
    cleanText = cleanText.replace(/^(?:@cloud|@gemini|\/cloud|\/gemini)\b[:\s]*/i, '').trim();
  } else if (/^(?:@local|\/local)\b/i.test(cleanText)) {
    forceLocal = true;
    cleanText = cleanText.replace(/^(?:@local|\/local)\b[:\s]*/i, '').trim();
  }

  const online =
    typeof env.online === 'boolean'
      ? env.online
      : typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
        ? navigator.onLine
        : true;
  const batteryLow = Boolean(env.batteryLow);
  const freeRamLow = Boolean(env.freeRamLow);

  if (mode === 'cloud') forceCloud = true;
  if (mode === 'offline' || (!online && mode === 'auto' && !forceCloud)) {
    forceLocal = true;
    forceCloud = false;
  }

  // Heavy / cloud-only triggers (PDF/text documents stay LOCAL; only images/audio/video/scanned need Cloud!)
  let heavyReason = '';
  if (attachment && !isTextOrDocAttachment(attachment)) {
    heavyReason = 'multimodal_attachment';
  } else if (/\b(generate image|create image|draw a|make a picture|photo banao|image banao)\b/i.test(cleanText) || /^\/image\b/i.test(cleanText)) {
    heavyReason = 'image_generation';
  } else if (/\b(screenshot le lo aur|screen par kya|dekh ke batao|screen dekho|click on|ui inspect)\b/i.test(cleanText)) {
    heavyReason = 'vision_screen_task';
  } else if (
    /\b(weather|mausam|latest news|live score|stock price today|current price|google search|search online|deep research)\b/i.test(cleanText) ||
    /https?:\/\//i.test(cleanText)
  ) {
    heavyReason = 'live_web_knowledge';
  } else if (
    cleanText.includes('```') ||
    cleanText.length > 600 ||
    /\b(write full app|full project|architecture design|refactor entire|multi-file|leetcode|algorithm proof)\b/i.test(cleanText)
  ) {
    heavyReason = 'heavy_coding_or_reasoning';
  }

  let routeReason = 'Auto Hybrid: running locally first to save API calls';
  if (!online) routeReason = 'Auto-Switched to Local: internet offline detected';
  else if (forceCloud && mode === 'cloud') routeReason = 'Cloud Mode selected';
  else if (forceCloud) routeReason = 'Forced Cloud via @cloud tag';
  else if (heavyReason) routeReason = `Auto-Switched to Gemini: ${heavyReason.replace(/_/g, ' ')}`;
  else if (freeRamLow || batteryLow) routeReason = 'Low RAM/Battery Guard active — avoiding heavy SLM';

  return {
    cleanText: cleanText || String(text || '').trim(),
    mode: !online && mode === 'auto' ? 'offline' : mode,
    online,
    batteryLow,
    freeRamLow,
    forceCloud,
    forceLocal,
    heavyReason,
    routeReason,
    shouldTryLocalFirst: !forceCloud && ((!heavyReason && !freeRamLow) || forceLocal),
  };
}

/**
 * Local Context Compactor: summarizes older chat messages cleanly in 0ms before escalating to Gemini Cloud,
 * trimming token cost by ~60% on long threads.
 */
export function compactHistoryForCloud(messages = [], maxRecent = 4) {
  if (!Array.isArray(messages) || messages.length <= maxRecent) return '';
  const older = messages.slice(0, messages.length - maxRecent).filter((m) => m && m.text && !m.isError);
  if (older.length === 0) return '';

  const bullets = older.slice(-8).map((m) => {
    const speaker = m.role === 'user' ? 'User' : 'JEEVA';
    const compact = String(m.text).replace(/\s+/g, ' ').trim().slice(0, 120);
    return `- ${speaker}: ${compact}${m.text.length > 120 ? '...' : ''}`;
  });
  return `CONVERSATION CONTEXT DIGEST (${older.length} earlier turns compressed locally):\n${bullets.join('\n')}`;
}
