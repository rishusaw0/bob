// Persistent user preferences for Jeeva AI (speech, summary behavior, reply length)

const DOC_SUMMARY_PREF_KEY = 'jeeva_doc_summary_pref';
const REPLY_STYLE_KEY = 'jeeva_reply_style';
const STRICT_LOCAL_COMMANDS_KEY = 'jeeva_strict_local_commands';

export const DOC_SUMMARY_OPTIONS = [
  { id: 'ask', label: 'Smart Auto', description: 'Follow your message, or summarize long files automatically' },
  { id: 'summarize', label: 'Always Summarize', description: 'Give short clear key points first for files & PDFs' },
  { id: 'read_full', label: 'Read Full Text', description: 'Show and read complete document text instead of brief summary' },
];

export const REPLY_STYLE_OPTIONS = [
  { id: 'concise', label: 'Short & Clear', description: 'Quick, everyday conversational answers' },
  { id: 'detailed', label: 'Detailed', description: 'Step-by-step thorough explanations' },
];

export function getDocSummaryPref() {
  try {
    const val = localStorage.getItem(DOC_SUMMARY_PREF_KEY);
    if (val === 'ask' || val === 'summarize' || val === 'read_full') return val;
  } catch { /* ignore */ }
  return 'ask';
}

export function setDocSummaryPref(mode) {
  const safe = (mode === 'summarize' || mode === 'read_full') ? mode : 'ask';
  try {
    localStorage.setItem(DOC_SUMMARY_PREF_KEY, safe);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('jeeva-prefs-updated', { detail: { docSummaryPref: safe } }));
    }
  } catch { /* ignore */ }
  return safe;
}

export function getReplyStyle() {
  try {
    const val = localStorage.getItem(REPLY_STYLE_KEY);
    if (val === 'concise' || val === 'detailed') return val;
  } catch { /* ignore */ }
  return 'concise';
}

export function setReplyStyle(style) {
  const safe = style === 'detailed' ? 'detailed' : 'concise';
  try {
    localStorage.setItem(REPLY_STYLE_KEY, safe);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('jeeva-prefs-updated', { detail: { replyStyle: safe } }));
    }
  } catch { /* ignore */ }
  return safe;
}

export function getStrictLocalCommands() {
  try {
    return localStorage.getItem(STRICT_LOCAL_COMMANDS_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setStrictLocalCommands(enabled) {
  const safe = Boolean(enabled);
  try {
    localStorage.setItem(STRICT_LOCAL_COMMANDS_KEY, String(safe));
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('jeeva-prefs-updated', { detail: { strictLocalCommands: safe } }));
    }
  } catch { /* ignore */ }
  return safe;
}
