// Zero-Gemini Local PDF / Text / Office Document Reader & Extractive Summarizer
import { runLocalSlmTurn } from './localLlm.js';
import { detectCommandLanguage } from './voicePermissionPrompt.js';
import { getDocSummaryPref } from './userPrefs.js';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.ini', '.yaml', '.yml',
  '.js', '.jsx', '.ts', '.tsx', '.py', '.ps1', '.sh', '.html', '.css', '.xml', '.sql',
]);

const DOC_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', ...TEXT_EXTENSIONS]);

export function getFileExtension(name = '') {
  const m = String(name || '').toLowerCase().match(/(\.[a-z0-9]+)$/);
  return m ? m[1] : '';
}

export function isTextOrDocAttachment(attachment) {
  if (!attachment) return false;
  if (attachment.isImage) return false;
  const mime = String(attachment.mimeType || '').toLowerCase();
  if (mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/')) {
    return false;
  }
  if (mime === 'application/pdf' || mime.startsWith('text/')) return true;
  return DOC_EXTENSIONS.has(getFileExtension(attachment.name));
}

function decodeBase64Utf8(dataUrlOrB64) {
  const b64 = String(dataUrlOrB64 || '').includes(',') ? String(dataUrlOrB64).split(',')[1] : String(dataUrlOrB64 || '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Pure-JS Extractive Local Summarizer (runs in <5ms with ZERO Ollama & ZERO Gemini API).
 */
export function summarizeTextLocally(rawText, maxSentences = 6) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= 420) return text;

  const sentences = (text.match(/[^।.!?\n]+[।.!?\n]?/g) || [text])
    .map((s) => s.trim())
    .filter((s) => s.length >= 24);

  if (sentences.length <= maxSentences) return sentences.join(' ');

  const stop = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'were', 'was', 'are', 'will',
    'been', 'your', 'into', 'they', 'their', 'about', 'which', 'when', 'what', 'there', 'than',
    'hai', 'hain', 'aur', 'par', 'mein', 'ka', 'ki', 'ke', 'ko', 'se', 'ek', 'kar', 'tha',
  ]);
  const freq = Object.create(null);
  for (const s of sentences) {
    const words = s.toLowerCase().match(/[a-z\u0900-\u097F]{3,}/g) || [];
    for (const w of words) {
      if (!stop.has(w)) freq[w] = (freq[w] || 0) + 1;
    }
  }

  const scored = sentences.map((s, idx) => {
    const words = s.toLowerCase().match(/[a-z\u0900-\u097F]{3,}/g) || [];
    let score = 0;
    for (const w of words) score += freq[w] || 0;
    const normalized = words.length ? score / Math.sqrt(words.length) : 0;
    const positionBoost = idx < 2 ? 1.25 : 1;
    return { idx, s, score: normalized * positionBoost };
  });

  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, maxSentences).sort((a, b) => a.idx - b.idx);
  return picked.map((p) => `• ${p.s}`).join('\n');
}

export async function extractAttachmentTextLocally(attachment) {
  if (!attachment) return null;
  const ext = getFileExtension(attachment.name);
  const mime = String(attachment.mimeType || '').toLowerCase();

  if (mime.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) {
    const text = decodeBase64Utf8(attachment.dataUrl).trim();
    return { ok: true, name: attachment.name, ext, text, chars: text.length, isScannedPdf: false };
  }

  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (api?.extractDocText) {
    return await api.extractDocText({ base64: attachment.dataUrl, name: attachment.name });
  }

  return null;
}

/**
 * Handles PDF, DOCX, PPTX, XLSX, and TXT/Code reading or summarizing locally (0 Gemini API calls!).
 */
async function processExtractedDocument({
  extracted,
  userPrompt = '',
  historyMessages = [],
  requestPermission = null,
  fromVoice = false,
} = {}) {
  if (!extracted || !extracted.ok) {
    return { handled: false, reason: 'local_extractor_unavailable' };
  }

  if (extracted.isScannedPdf || !extracted.text || extracted.text.length < 25) {
    return {
      handled: false,
      needsVisionOcr: true,
      reason: 'Scanned/image-only PDF detected (no embedded text)',
    };
  }

  const lang = detectCommandLanguage(userPrompt);
  const lower = String(userPrompt || '').toLowerCase();
  const docPref = getDocSummaryPref();
  const explicitFullRead = /\b(poora read|full read|read aloud|poora padh|word by word|read full)\b/i.test(lower);
  const explicitSummaryOrQ = /\b(summary|summarize|summarise|short|brief|key points|explain|samjhao|batao|what is|kya likha|question|extract|find|search|kyun|why)\b/i.test(lower);
  const wantsSummaryOrQuestion = explicitFullRead
    ? false
    : explicitSummaryOrQ
      ? true
      : docPref === 'summarize'
        ? true
        : docPref === 'read_full'
          ? false
          : false;

  const docText = extracted.text;
  const fileLabel = extracted.name || 'document';

  // Mode A: Read Text / Read Aloud directly without touching Gemini!
  if (!wantsSummaryOrQuestion) {
    const clipped = docText.slice(0, 4800);
    const truncatedNote =
      docText.length > 4800
        ? `\n\n_(Showing first 4,800 of ${docText.length.toLocaleString()} characters — ask for summary or a specific section if needed.)_`
        : '';
    const intro =
      lang === 'english'
        ? `Reading **${fileLabel}** locally (${extracted.chars.toLocaleString()} chars):`
        : `**${fileLabel}** ko locally read kiya (${extracted.chars.toLocaleString()} characters):`;
    return {
      handled: true,
      tier: 'fast',
      modelLabel: 'Offline Doc Reader',
      routeReason: 'Extracted document/PDF text locally (0 Gemini API calls)',
      replyText: `${intro}\n\n${clipped}${truncatedNote}`,
      autoSpeak: true,
      tools: [{ name: 'read_document_file', status: 'done', args: { name: fileLabel, mode: 'local_extract' } }],
    };
  }

  // Mode B: Summarize or Answer Question -> First try Local SLM Brain (Qwen/Gemma), else Extractive Local Summary!
  const snippetForSlm = docText.slice(0, 2600);
  const slmPrompt = `${userPrompt || 'Summarize key points concisely in user language.'}\n\nDOCUMENT (${fileLabel}):\n"""\n${snippetForSlm}\n"""`;

  const slm = await runLocalSlmTurn({
    text: slmPrompt,
    historyMessages,
    requestPermission,
    fromVoice,
  });

  if (slm?.handled && slm.replyText) {
    return {
      handled: true,
      tier: 'local-slm',
      modelLabel: `${slm.modelLabel || 'Local SLM'} (Doc)`,
      routeReason: 'PDF/Text summarized by Local AI Brain (0 Gemini API calls)',
      replyText: slm.replyText,
      autoSpeak: /sunao|listen|read|speak|audio/i.test(lower),
      tools: [{ name: 'read_document_file', status: 'done', args: { name: fileLabel, engine: 'local_slm' } }],
    };
  }

  // Zero-SLM Pure-JS Extractive Summary fallback (works even without Ollama & without Gemini!)
  const summaryBullets = summarizeTextLocally(docText, 6);
  const sumHeader =
    lang === 'english'
      ? `Local Summary of **${fileLabel}** (${extracted.pageCount || 1} page(s), ${docText.length.toLocaleString()} chars):`
      : `**${fileLabel}** ka Local Summary (${extracted.pageCount || 1} page, ${docText.length.toLocaleString()} chars):`;
  return {
    handled: true,
    tier: 'fast',
    modelLabel: 'Offline Local Summarizer',
    routeReason: 'Summarized PDF/Text with built-in local extractor (0 Gemini API calls)',
    replyText: `${sumHeader}\n\n${summaryBullets}`,
    autoSpeak: Boolean(fromVoice || /sunao|listen|read|speak|audio/i.test(lower)),
    tools: [{ name: 'read_document_file', status: 'done', args: { name: fileLabel, engine: 'extractive_local' } }],
  };
}

/**
 * Handles uploaded PDF, DOCX, PPTX, XLSX, and TXT/Code attachments locally (0 Gemini API calls!).
 */
export async function runLocalDocumentTurn({
  attachment,
  userPrompt = '',
  historyMessages = [],
  requestPermission = null,
  fromVoice = false,
} = {}) {
  const extracted = await extractAttachmentTextLocally(attachment);
  return processExtractedDocument({ extracted, userPrompt, historyMessages, requestPermission, fromVoice });
}

/**
 * Reads, explains, or summarizes a PDF/document directly from a PC file path or Desktop/Downloads/Documents shortcut.
 */
export async function runLocalDocumentPathTurn({
  filePath,
  userPrompt = '',
  historyMessages = [],
  requestPermission = null,
  fromVoice = true,
} = {}) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  if (!api?.extractDocText) return { handled: false, reason: 'no_desktop_doc_reader' };

  try {
    const extracted = await api.extractDocText({ filePath, name: filePath });
    if (!extracted?.ok) {
      return {
        handled: true,
        tier: 'fast',
        replyText: extracted?.error || `Could not read document at "${filePath}".`,
        tools: [{ name: 'read_document_file', status: 'error', args: { path: filePath } }],
      };
    }
    const res = await processExtractedDocument({ extracted, userPrompt, historyMessages, requestPermission, fromVoice });
    if (res?.needsVisionOcr) {
      return {
        handled: true,
        tier: 'fast',
        replyText: `${filePath} ek scanned image PDF hai (isme selectable text nahi hai). Aap iska screenshot/image le kar offline Windows OCR se padhwa sakte hain, ya Cloud AI enabled hone par Chat me attach kar sakte hain.`,
        tools: [{ name: 'read_document_file', status: 'error', args: { path: filePath } }],
      };
    }
    return res;
  } catch (err) {
    return {
      handled: true,
      tier: 'fast',
      replyText: err?.message || `File "${filePath}" nahi mili ya open nahi ho saki.`,
      tools: [{ name: 'read_document_file', status: 'error', args: { path: filePath } }],
    };
  }
}

/**
 * Splits a local document into overlapping chunks with section/page metadata for offline RAG search.
 */
export function indexDocumentChunks(docName, rawText, chunkSize = 520) {
  const clean = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';
  let sectionIdx = 1;

  for (const para of paragraphs) {
    if ((buf + '\n' + para).length > chunkSize && buf.trim()) {
      chunks.push({
        source: docName || 'document',
        section: `Section ${sectionIdx++}`,
        text: buf.trim(),
      });
      buf = para;
    } else {
      buf = buf ? `${buf}\n${para}` : para;
    }
  }
  if (buf.trim()) {
    chunks.push({
      source: docName || 'document',
      section: `Section ${sectionIdx}`,
      text: buf.trim(),
    });
  }
  return chunks;
}

/**
 * Local Offline Semantic/Keyword Search across indexed documents with source + section references.
 */
export function searchLocalDocuments(query, indexedDocs = [], topK = 4) {
  const qWords = (String(query || '').toLowerCase().match(/[a-z0-9\u0900-\u097F]{2,}/g) || [])
    .filter((w) => !['the', 'and', 'for', 'with', 'hai', 'kya', 'mein', 'ka', 'ki', 'ke'].includes(w));
  if (!qWords.length || !Array.isArray(indexedDocs) || !indexedDocs.length) return [];

  const allChunks = [];
  for (const doc of indexedDocs) {
    const docChunks = Array.isArray(doc.chunks)
      ? doc.chunks
      : indexDocumentChunks(doc.name || doc.source || 'document', doc.text || '');
    allChunks.push(...docChunks);
  }

  const scored = allChunks
    .map((chunk) => {
      const lower = chunk.text.toLowerCase();
      let hits = 0;
      for (const w of qWords) {
        if (lower.includes(w)) hits++;
      }
      const score = hits / qWords.length;
      return { ...chunk, score: Number(score.toFixed(3)) };
    })
    .filter((c) => c.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
