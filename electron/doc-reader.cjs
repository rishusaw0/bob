// Zero-Dependency Local Document Extractor: Digital PDF (zlib FlateDecode), DOCX/PPTX/XLSX (ZIP XML), and Plain Text
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { checkPathSafety } = require('./security-guardrails.cjs');

const MAX_INFLATE_BYTES = 20 * 1024 * 1024;
const MAX_DOC_BYTES = 15 * 1024 * 1024;

/**
 * Runs offline Windows WinRT OCR on an image file (.png, .jpg, .bmp, .webp).
 */
function extractOcrFromImageFile(filePath, timeoutMs = 12000) {
  const psScript = `
    $ErrorActionPreference = 'Stop'
    $ocrPath = $env:JEEVA_OCR_PATH
    if (-not $ocrPath) { throw 'Missing OCR image path' }
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
    function Await($WinRtTask, $ResultType) {
      $netTask = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($WinRtTask))
      $netTask.Wait(-1) | Out-Null
      $netTask.Result
    }
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ocrPath)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (-not $engine) { throw 'Windows OCR engine unavailable for current language profile' }
    $ocrRes = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    Write-Output $ocrRes.Text
  `;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    env: { ...process.env, JEEVA_OCR_PATH: String(filePath || '') },
  });
  return String(out || '').trim();
}

function resolveUserDocumentPath(rawPath = '') {
  const input = String(rawPath || '').trim().replace(/^["']|["']$/g, '');
  if (!input) return '';

  const home = os.homedir();
  const folderRoots = {
    desktop: path.join(home, 'Desktop'),
    downloads: path.join(home, 'Downloads'),
    documents: path.join(home, 'Documents'),
  };

  let candidate = input;
  const folderMatch = input.match(/^(desktop|downloads|documents)[\\/](.+)$/i);
  if (folderMatch) {
    const baseDir = folderRoots[folderMatch[1].toLowerCase()];
    const rel = folderMatch[2].trim();
    candidate = path.join(baseDir, rel);

    if (!fs.existsSync(candidate) && fs.existsSync(baseDir)) {
      const targetNorm = rel.toLowerCase().replace(/\.(pdf|docx|pptx|xlsx|txt|md)$/i, '').trim();
      const wantedExt = path.extname(rel).toLowerCase();
      try {
        const files = fs.readdirSync(baseDir);
        const docExts = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.txt', '.md', '.csv']);
        const best = files.find((f) => {
          const ext = path.extname(f).toLowerCase();
          if (!docExts.has(ext)) return false;
          if (wantedExt && ext !== wantedExt) return false;
          const base = path.basename(f, ext).toLowerCase();
          return base === targetNorm || base.includes(targetNorm);
        });
        if (best) candidate = path.join(baseDir, best);
      } catch {}
    }
  }
  return candidate;
}

function decodePdfLiteralString(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    i++;
    if (i >= raw.length) break;
    const esc = raw[i];
    if (esc === 'n') out += '\n';
    else if (esc === 'r') out += '\n';
    else if (esc === 't') out += ' ';
    else if (esc === 'b' || esc === 'f') out += '';
    else if (esc === '(' || esc === ')' || esc === '\\') out += esc;
    else if (/[0-7]/.test(esc)) {
      let oct = esc;
      if (i + 1 < raw.length && /[0-7]/.test(raw[i + 1])) oct += raw[++i];
      if (i + 1 < raw.length && /[0-7]/.test(raw[i + 1])) oct += raw[++i];
      const code = parseInt(oct, 8);
      if (code >= 32) out += String.fromCharCode(code);
    } else if (esc === '\r' || esc === '\n') {
      // PDF line continuation
    } else {
      out += esc;
    }
  }
  return out;
}

function decodePdfHexString(hex) {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length < 2) return '';
  if (/^feff/i.test(clean) && clean.length >= 6) {
    let out = '';
    for (let i = 4; i + 3 < clean.length; i += 4) {
      const code = parseInt(clean.slice(i, i + 4), 16);
      if (code >= 32 || code === 10) out += String.fromCharCode(code);
    }
    return out;
  }
  let ascii = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code >= 32 && code <= 126) ascii += String.fromCharCode(code);
  }
  return ascii;
}

function extractTextFromPdfOperatorStream(streamStr) {
  const parts = [];
  const btRegex = /\bBT\b([\s\S]*?)\bET\b/g;
  let btMatch;
  while ((btMatch = btRegex.exec(streamStr)) !== null) {
    const block = btMatch[1];
    let blockText = '';
    let i = 0;
    while (i < block.length) {
      if (block[i] === '(') {
        let depth = 1;
        let rawStr = '';
        i++;
        while (i < block.length && depth > 0) {
          if (block[i] === '\\' && i + 1 < block.length) {
            rawStr += block[i] + block[i + 1];
            i += 2;
            continue;
          }
          if (block[i] === '(') depth++;
          else if (block[i] === ')') {
            depth--;
            if (depth === 0) break;
          }
          rawStr += block[i];
          i++;
        }
        blockText += decodePdfLiteralString(rawStr);
      } else if (block[i] === '<' && block[i + 1] !== '<') {
        const close = block.indexOf('>', i + 1);
        if (close > i) {
          blockText += decodePdfHexString(block.slice(i + 1, close));
          i = close;
        }
      } else if (block[i] === 'T' && (block[i + 1] === 'd' || block[i + 1] === 'D' || block[i + 1] === '*')) {
        if (blockText && !blockText.endsWith(' ') && !blockText.endsWith('\n')) {
          blockText += ' ';
        }
      }
      i++;
    }
    const cleanBlock = blockText.replace(/\s+/g, ' ').trim();
    if (cleanBlock) parts.push(cleanBlock);
  }
  return parts.join('\n');
}

function extractPdfTextFromBuffer(buf) {
  const latin = buf.toString('latin1');
  const pageMatches = latin.match(/\/Type\s*\/Page\b(?!s)/g);
  const pageCount = pageMatches ? pageMatches.length : 1;

  const collected = [];
  let cursor = 0;
  while (cursor < latin.length) {
    const streamIdx = latin.indexOf('stream', cursor);
    if (streamIdx === -1) break;
    let dataStart = streamIdx + 6;
    if (latin[dataStart] === '\r' && latin[dataStart + 1] === '\n') dataStart += 2;
    else if (latin[dataStart] === '\n' || latin[dataStart] === '\r') dataStart += 1;

    const endIdx = latin.indexOf('endstream', dataStart);
    if (endIdx === -1) break;

    const dictWindow = latin.slice(Math.max(0, streamIdx - 320), streamIdx);
    const rawSlice = buf.subarray(dataStart, endIdx);

    let decodedStr = '';
    if (/\/FlateDecode\b/i.test(dictWindow)) {
      try {
        decodedStr = zlib.inflateSync(rawSlice, { maxOutputLength: MAX_INFLATE_BYTES }).toString('latin1');
      } catch {
        try {
          decodedStr = zlib.inflateRawSync(rawSlice, { maxOutputLength: MAX_INFLATE_BYTES }).toString('latin1');
        } catch {}
      }
    } else if (!/\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode/i.test(dictWindow)) {
      decodedStr = rawSlice.toString('latin1');
    }

    if (decodedStr && decodedStr.includes('BT') && decodedStr.includes('ET')) {
      const txt = extractTextFromPdfOperatorStream(decodedStr);
      if (txt) collected.push(txt);
    }
    cursor = endIdx + 9;
  }

  const finalText = collected
    .join('\n')
    .replace(/[^\p{L}\p{N}\p{P}\p{Z}\n]/gu, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const readableAlpha = (finalText.match(/[a-zA-Z\u0900-\u097F]/g) || []).length;
  return {
    text: finalText,
    pageCount,
    isScannedPdf: readableAlpha < 18,
  };
}

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Minimal pure-JS ZIP Central Directory reader (handles store method 0 & deflate method 8 for DOCX/PPTX/XLSX).
 */
function extractZipEntries(buf) {
  const entries = [];
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return entries;

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  let cdOffset = buf.readUInt32LE(eocdOffset + 16);

  for (let n = 0; n < totalEntries && cdOffset + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) break;
    const method = buf.readUInt16LE(cdOffset + 10);
    const compSize = buf.readUInt32LE(cdOffset + 20);
    const nameLen = buf.readUInt16LE(cdOffset + 28);
    const extraLen = buf.readUInt16LE(cdOffset + 30);
    const commentLen = buf.readUInt16LE(cdOffset + 32);
    const localHeaderOff = buf.readUInt32LE(cdOffset + 42);
    const fileName = buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf8');

    if (localHeaderOff + 30 <= buf.length && buf.readUInt32LE(localHeaderOff) === 0x04034b50) {
      const lNameLen = buf.readUInt16LE(localHeaderOff + 26);
      const lExtraLen = buf.readUInt16LE(localHeaderOff + 28);
      const dataStart = localHeaderOff + 30 + lNameLen + lExtraLen;
      const slice = buf.subarray(dataStart, dataStart + compSize);
      try {
        const content =
          method === 0
            ? slice
            : method === 8
              ? zlib.inflateRawSync(slice, { maxOutputLength: MAX_INFLATE_BYTES })
              : null;
        if (content) entries.push({ name: fileName, content });
      } catch {}
    }

    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractOfficeXmlText(buf, ext) {
  const files = extractZipEntries(buf);
  const targets = files
    .filter((f) => {
      if (ext === '.docx') return f.name === 'word/document.xml';
      if (ext === '.pptx') return /^ppt\/slides\/slide\d+\.xml$/i.test(f.name);
      if (ext === '.xlsx') return f.name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/i.test(f.name);
      return false;
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const chunks = targets.map((f) => {
    const xml = f.content.toString('utf8');
    const plain = xml
      .replace(/<\/(?:w:p|a:p|row|si|t|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    return decodeXmlEntities(plain)
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  });
  return chunks.filter(Boolean).join('\n\n').trim();
}

function extractDocumentContent({ filePath = '', base64 = '', name = '' } = {}) {
  let buf;
  let resolvedName = name || (filePath ? path.basename(filePath) : 'document');

  if (filePath) {
    const resolvedTarget = resolveUserDocumentPath(filePath);
    const safety = checkPathSafety(resolvedTarget, 'read');
    if (!safety.allowed) throw new Error(safety.reason);
    const stats = fs.statSync(resolvedTarget);
    if (stats.size > MAX_DOC_BYTES) {
      throw new Error('File 15 MB se badi hai. Chhoti file try karein.');
    }
    resolvedName = path.basename(resolvedTarget);
    buf = fs.readFileSync(resolvedTarget);
  } else if (base64) {
    const cleanB64 = String(base64).includes(',') ? String(base64).split(',')[1] : String(base64);
    if (cleanB64.length > Math.ceil((MAX_DOC_BYTES * 4) / 3) + 1024) {
      throw new Error('File 15 MB se badi hai. Chhoti file try karein.');
    }
    buf = Buffer.from(cleanB64, 'base64');
    if (buf.length > MAX_DOC_BYTES) {
      throw new Error('File 15 MB se badi hai. Chhoti file try karein.');
    }
  } else {
    throw new Error('Document path or content is required.');
  }

  const ext = path.extname(resolvedName).toLowerCase();
  if (filePath && ['.png', '.jpg', '.jpeg', '.bmp', '.webp'].includes(ext)) {
    const resolvedTarget = resolveUserDocumentPath(filePath);
    try {
      const ocrText = extractOcrFromImageFile(resolvedTarget);
      return {
        ok: true,
        name: resolvedName,
        ext,
        pageCount: 1,
        isScannedPdf: false,
        ocrUsed: true,
        text: ocrText,
        chars: ocrText.length,
      };
    } catch (err) {
      return {
        ok: false,
        name: resolvedName,
        ext,
        ocrUsed: false,
        error: err?.message || 'Offline Windows OCR failed on image.',
      };
    }
  }

  if (ext === '.pdf') {
    const pdfRes = extractPdfTextFromBuffer(buf);
    return {
      ok: true,
      name: resolvedName,
      ext,
      pageCount: pdfRes.pageCount,
      isScannedPdf: pdfRes.isScannedPdf,
      text: pdfRes.text,
      chars: pdfRes.text.length,
    };
  }

  if (['.docx', '.pptx', '.xlsx'].includes(ext)) {
    const text = extractOfficeXmlText(buf, ext);
    return {
      ok: true,
      name: resolvedName,
      ext,
      pageCount: 1,
      isScannedPdf: text.length < 15,
      text,
      chars: text.length,
    };
  }

  // Plain text, Markdown, CSV, JSON, Logs, Source Code
  const text = buf.toString('utf8').replace(/\0/g, '').trim();
  return {
    ok: true,
    name: resolvedName,
    ext: ext || '.txt',
    pageCount: 1,
    isScannedPdf: false,
    text,
    chars: text.length,
  };
}

module.exports = {
  extractDocumentContent,
  extractPdfTextFromBuffer,
  extractOfficeXmlText,
  extractOcrFromImageFile,
};
