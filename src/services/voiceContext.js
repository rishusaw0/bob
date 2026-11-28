// Context-Aware Deictic Voice Resolver ("Isko / Is error / Yahan / This window")
// Automatically attaches Foreground Window title, Clipboard text, and Screen capture when context is implied.

const DEICTIC_PATTERN =
  /\b(isko|iske|iski|ispe|is\s+(?:error|window|app|page|screen|file|code|tab|ko|me|mein)|yahan|yaha|ye\s+(?:kya|error|screen|app|code)|this\s+(?:error|window|app|page|screen|file|tab|code)|explain\s+this|fix\s+this|close\s+this|read\s+this|summarize\s+this|what\s+is\s+this)\b|इसको|इसे|यहाँ|इस\s+(?:ऐप|एरर|स्क्रीन|कोड|विंडो)/i;

export function isDeicticVoiceCommand(text) {
  return DEICTIC_PATTERN.test(String(text || '').trim());
}

/**
 * Captures active Windows foreground window title, clipboard snippet, and optional screenshot
 * when user refers contextually ("is error ko explain karo", "isko close karo", "yahan kya hai").
 */
export async function captureVoiceContextSnapshot(rawCommand) {
  const cleanCmd = String(rawCommand || '').trim();
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (!api || !isDeicticVoiceCommand(cleanCmd)) {
    return { enrichedPrompt: cleanCmd, attachment: null, contextMeta: null };
  }

  const isCloseOnly = /\b(close|band|band karo|quit)\b/i.test(cleanCmd) && !/\b(explain|error|read|kya|why|fix)\b/i.test(cleanCmd);

  const [dispRes, clipRes, ssRes] = await Promise.allSettled([
    api.diagnostics?.('display_info', '') || Promise.resolve(null),
    api.clipboard?.('read') || Promise.resolve(''),
    isCloseOnly ? Promise.resolve(null) : (api.screenshot?.() || Promise.resolve(null)),
  ]);

  let foregroundWindow = '';
  if (dispRes.status === 'fulfilled' && dispRes.value) {
    try {
      const parsed = typeof dispRes.value === 'string' ? JSON.parse(dispRes.value) : dispRes.value;
      const fw = String(parsed?.foregroundWindow || '').trim();
      if (fw && !/^jeeva/i.test(fw)) foregroundWindow = fw;
    } catch {}
  }

  let clipText = '';
  if (clipRes.status === 'fulfilled' && typeof clipRes.value === 'string') {
    clipText = clipRes.value.trim().slice(0, 700);
  }

  let attachment = null;
  if (ssRes.status === 'fulfilled' && ssRes.value?.base64) {
    const mimeMatch = String(ssRes.value.base64).match(/^data:([^;]+);/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    attachment = {
      dataUrl: ssRes.value.base64,
      mimeType,
      name: `active-screen-context.${ext}`,
      isImage: true,
      isDocument: false,
    };
  }

  const hints = [];
  if (foregroundWindow) hints.push(`Active Foreground Window: "${foregroundWindow}"`);
  if (clipText) hints.push(`Clipboard Snippet: "${clipText.replace(/\s+/g, ' ').slice(0, 260)}"`);

  const enrichedPrompt = hints.length
    ? `[PC Live Context — ${hints.join(' | ')}]\nUser Voice Command: ${cleanCmd}`
    : cleanCmd;

  return {
    enrichedPrompt,
    attachment,
    contextMeta: { foregroundWindow, hasClipboard: Boolean(clipText), hasScreenshot: Boolean(attachment) },
  };
}
