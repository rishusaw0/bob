import { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import 'highlight.js/styles/github-dark.css';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import typescript from 'highlight.js/lib/languages/typescript';
import csharp from 'highlight.js/lib/languages/csharp';
import java from 'highlight.js/lib/languages/java';
import sql from 'highlight.js/lib/languages/sql';
import markdown from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import yaml from 'highlight.js/lib/languages/yaml';
import {
  LuCopy,
  LuCheck,
  LuVolume2,
  LuDownload,
  LuFileText,
  LuWrench,
  LuCircleAlert,
  LuPencil,
  LuRefreshCw,
  LuTerminal,
  LuThumbsUp,
  LuThumbsDown,
  LuShieldAlert,
  LuX,
  LuMic,
} from 'react-icons/lu';
import { speakText } from '../services/speech';
import { toast } from '../services/toast';

// Register highlight.js languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('java', java);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('ps1', powershell);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);

function CodeBlock({ inline, className, children, ...props }) {
  const [copied, setCopied] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [cmdResult, setCmdResult] = useState(null);
  const code = String(children).replace(/\n$/, '');

  if (inline) {
    return (
      <code
        className="font-mono text-[0.825em] px-1.5 py-0.5 rounded bg-obsidian-elevated border border-obsidian-border text-emerald-300"
        {...props}
      >
        {children}
      </code>
    );
  }

  const langMatch = /language-(\w+)/.exec(className || '');
  const lang = langMatch ? langMatch[1] : '';

  const highlighted = useMemo(() => {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      const auto = hljs.highlightAuto(code);
      return auto.relevance > 4 ? auto.value : null;
    } catch {
      return null;
    }
  }, [code, lang]);

  const displayLang = lang || 'code';

  const handleCopyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success('Code copied!');
    setTimeout(() => setCopied(false), 1500);
  };

  const handleRunCmd = async () => {
    if (!window.electronAPI?.runCommand || isRunning) return;
    if (!confirmRun) {
      setConfirmRun(true);
      setTimeout(() => setConfirmRun(false), 4500);
      return;
    }
    setConfirmRun(false);
    setIsRunning(true);
    try {
      const out = await window.electronAPI.runCommand(code);
      setCmdResult({ ok: true, text: String(out || 'Command completed').trim() });
      toast.success('Command completed');
    } catch (err) {
      const errMsg = err?.message || String(err);
      setCmdResult({ ok: false, text: errMsg });
      toast.error('Command failed');
    } finally {
      setIsRunning(false);
    }
  };

  const isShellLang = ['bash', 'sh', 'shell', 'powershell', 'ps1', 'cmd', 'bat'].includes(displayLang);

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-obsidian-border bg-[#0c0c0f]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-obsidian-surface border-b border-obsidian-border text-[11px] font-mono text-obsidian-muted">
        <span className="text-obsidian-secondary">{displayLang}</span>
        <div className="flex items-center gap-2">
          {isShellLang && window.electronAPI && (
            <button
              onClick={handleRunCmd}
              disabled={isRunning}
              className={`inline-flex items-center gap-1 transition-colors ${
                confirmRun
                  ? 'text-amber-300 font-semibold'
                  : 'text-obsidian-muted hover:text-emerald-400'
              }`}
              title={confirmRun ? 'Click again to confirm shell execution' : 'Run command in Windows terminal'}
            >
              <LuTerminal className="w-3 h-3" />
              {isRunning ? 'Running...' : confirmRun ? 'Confirm Run?' : 'Run'}
            </button>
          )}
          <button
            onClick={handleCopyCode}
            className="inline-flex items-center gap-1 text-obsidian-secondary hover:text-obsidian-text transition-colors"
          >
            {copied ? <LuCheck className="w-3 h-3 text-emerald-400" /> : <LuCopy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="p-3.5 overflow-x-auto text-xs font-mono leading-relaxed">
        {highlighted ? (
          <code
            className={`hljs ${className || ''}`}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <code className={`text-zinc-200 ${className || ''}`} {...props}>
            {children}
          </code>
        )}
      </pre>
      {cmdResult && (
        <div
          className={`border-t px-3 py-2 text-[11px] font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto ${
            cmdResult.ok
              ? 'border-obsidian-border bg-emerald-950/20 text-emerald-200'
              : 'border-red-900/40 bg-red-950/25 text-red-300'
          }`}
        >
          {cmdResult.text}
        </div>
      )}
    </div>
  );
}

// Streaming text animation component
function StreamingText({ text, isStreaming }) {
  const [displayLength, setDisplayLength] = useState(isStreaming ? 0 : text.length);
  const intervalRef = useRef(null);
  const prevTextRef = useRef('');

  useEffect(() => {
    if (!isStreaming) {
      setDisplayLength(text.length);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // When new text chunks arrive, animate from previous length to new length
    const prevLen = prevTextRef.current.length;
    prevTextRef.current = text;

    if (prevLen >= text.length) {
      setDisplayLength(text.length);
      return;
    }

    let current = prevLen;
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      current += Math.max(1, Math.ceil((text.length - current) / 8));
      if (current >= text.length) {
        current = text.length;
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setDisplayLength(current);
    }, 16);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [text, isStreaming]);

  const visibleText = text.slice(0, displayLength);

  return (
    <div className="prose-editorial">
      <ReactMarkdown components={{ code: CodeBlock }}>{visibleText}</ReactMarkdown>
      {isStreaming && displayLength < text.length && (
        <span className="inline-block w-[2px] h-4 bg-obsidian-text animate-pulse ml-0.5 align-text-bottom" />
      )}
    </div>
  );
}

export default function MessageBubble({ message, onEdit, onRegenerate, onPermissionDecision }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [reaction, setReaction] = useState(() => {
    try {
      return localStorage.getItem(`jeeva_react_${message.id}`) || '';
    } catch {
      return '';
    }
  });

  const handleCopy = () => {
    if (!message.text) return;
    navigator.clipboard.writeText(message.text);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSaveNote = async () => {
    if (!message.text || !window.electronAPI?.saveDesktopFile) return;
    const filename = `jeeva-note-${Date.now()}.md`;
    await window.electronAPI.saveDesktopFile(filename, message.text);
    setSavedNotice(true);
    toast.success('Note saved to Desktop');
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleSaveImage = async () => {
    if (!message.image) return;
    if (window.electronAPI?.saveImage) {
      await window.electronAPI.saveImage(message.image, `jeeva-image-${Date.now()}.png`);
      toast.success('Image saved to Desktop');
    } else {
      const a = document.createElement('a');
      a.href = message.image;
      a.download = `jeeva-image-${Date.now()}.png`;
      a.click();
      toast.success('Image download started');
    }
  };

  const handleStartEdit = () => {
    setEditText(message.text || '');
    setIsEditing(true);
  };

  const handleSubmitEdit = () => {
    const trimmed = editText.trim();
    if (!trimmed || !onEdit) return;
    setIsEditing(false);
    onEdit(message.id, trimmed);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditText('');
  };

  const handleReaction = (type) => {
    const next = reaction === type ? '' : type;
    setReaction(next);
    try {
      if (next) {
        localStorage.setItem(`jeeva_react_${message.id}`, next);
      } else {
        localStorage.removeItem(`jeeva_react_${message.id}`);
      }
    } catch {}
  };

  const perm = message.permissionPrompt;
  if (perm) {
    const isPending = perm.status === 'pending';
    const isAllowed = perm.status === 'allowed';
    const isHigh = perm.riskLevel === 'high';
    return (
      <div className="py-2 animate-fade-in">
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-md bg-zinc-100 text-zinc-950 flex items-center justify-center font-mono text-[10px] font-bold flex-shrink-0 mt-0.5">
            JV
          </div>
          <div
            className={`flex-1 min-w-0 rounded-xl border p-3.5 ${
              isPending
                ? isHigh
                  ? 'bg-red-950/20 border-red-500/40'
                  : 'bg-amber-950/20 border-amber-500/40'
                : 'bg-obsidian-surface border-obsidian-border'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold text-amber-300">
                <LuShieldAlert className="w-3.5 h-3.5" />
                {isHigh ? 'Confirmation Required (High Risk)' : 'Permission Required'}
              </span>
              {perm.fromVoice && isPending && (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-300">
                  <LuMic className="w-3 h-3 animate-pulse" />
                  Say Haan / Yes or Nahi / No
                </span>
              )}
              {!isPending && (
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                    isAllowed ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
                  }`}
                >
                  {isAllowed ? 'Approved' : 'Cancelled'}
                </span>
              )}
            </div>
            <p className="text-sm text-obsidian-text leading-relaxed">{perm.questionText}</p>
            {perm.summary && (
              <p className="text-[11px] font-mono text-obsidian-muted mt-1">{perm.summary}</p>
            )}
            {isPending && onPermissionDecision && (
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => onPermissionDecision('once')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-medium hover:bg-white transition-colors"
                >
                  <LuCheck className="w-3.5 h-3.5" />
                  Yes, Allow
                </button>
                <button
                  type="button"
                  onClick={() => onPermissionDecision('deny')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-obsidian-bg border border-obsidian-border text-xs text-obsidian-secondary hover:text-red-300 hover:border-red-500/40 transition-colors"
                >
                  <LuX className="w-3.5 h-3.5" />
                  No, Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Typing indicator with tool trace
  if (message.isTyping) {
    return (
      <div className="py-3 animate-fade-in">
        {message.tools?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {message.tools.map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-obsidian-surface border border-obsidian-border text-[11px] font-mono text-obsidian-secondary"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${t.status === 'done' ? 'bg-emerald-500' : t.status === 'error' ? 'bg-red-500' : 'bg-amber-400 animate-pulse'}`} />
                <LuWrench className="w-3 h-3 text-obsidian-muted" />
                {t.name}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-md bg-obsidian-elevated border border-obsidian-border flex items-center justify-center font-mono text-[10px] font-bold text-obsidian-secondary flex-shrink-0 mt-0.5">
            JV
          </div>
          <div className="flex-1 min-w-0">
            {message.text ? (
              <StreamingText text={message.text} isStreaming={true} />
            ) : (
              <div className="flex items-center gap-1.5 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 typing-dot" />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 typing-dot" />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 typing-dot" />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // User message
  if (isUser) {
    return (
      <div className="flex justify-end py-2 animate-fade-in group">
        <div className="max-w-[80%]">
          {isEditing ? (
            <div className="bg-obsidian-surface border border-obsidian-border rounded-2xl p-3 space-y-2">
              <textarea
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitEdit(); }
                  if (e.key === 'Escape') handleCancelEdit();
                }}
                rows={Math.min(editText.split('\n').length + 1, 6)}
                className="w-full bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-2 text-sm text-obsidian-text focus:outline-none focus:border-zinc-500 resize-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={handleCancelEdit}
                  className="px-2.5 py-1 rounded-lg text-xs text-obsidian-muted hover:text-obsidian-text"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitEdit}
                  disabled={!editText.trim()}
                  className="px-3 py-1 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-medium hover:bg-white disabled:opacity-40"
                >
                  Resend
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-obsidian-elevated border border-obsidian-border rounded-2xl rounded-br-sm px-4 py-2.5 relative">
              {message.text && (
                <p className="text-sm text-obsidian-text whitespace-pre-wrap leading-relaxed">
                  {message.text}
                </p>
              )}
              {message.image && (
                <div className="mt-2">
                  <img
                    src={message.image}
                    alt="Attachment"
                    className="rounded-lg max-h-64 object-contain border border-obsidian-border"
                  />
                </div>
              )}
              {/* Edit button on hover */}
              {onEdit && (
                <button
                  onClick={handleStartEdit}
                  className="absolute -bottom-6 right-1 opacity-0 group-hover:opacity-70 hover:!opacity-100 p-1 rounded text-obsidian-muted hover:text-obsidian-text transition-all text-[11px] inline-flex items-center gap-1"
                >
                  <LuPencil className="w-3 h-3" />
                  Edit
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="group py-3 animate-fade-in">
      {/* Executed Tools Trace */}
      {message.tools?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2.5 pl-9">
          {message.tools.map((t, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-obsidian-surface border border-obsidian-border text-[11px] font-mono text-obsidian-secondary"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${t.status === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`} />
              {t.name}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className="w-6 h-6 rounded-md bg-zinc-100 text-zinc-950 flex items-center justify-center font-mono text-[10px] font-bold flex-shrink-0 mt-0.5">
          JV
        </div>

        <div className="flex-1 min-w-0">
          {message.isError ? (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-950/30 border border-red-900/50 text-red-200 text-sm">
              <LuCircleAlert className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <span>{message.text}</span>
            </div>
          ) : (
            <StreamingText text={message.text || ''} isStreaming={false} />
          )}

          {message.image && (
            <div className="mt-3 relative inline-block group/img">
              <img
                src={message.image}
                alt="Output"
                className="rounded-lg max-w-full max-h-96 object-contain border border-obsidian-border cursor-pointer"
                onClick={() => window.open(message.image, '_blank')}
              />
              <button
                onClick={handleSaveImage}
                className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-obsidian-surface hover:bg-obsidian-elevated border border-obsidian-border text-xs text-obsidian-secondary hover:text-obsidian-text transition-colors"
              >
                <LuDownload className="w-3.5 h-3.5" />
                Save Image to Desktop
              </button>
            </div>
          )}

          {/* Action Bar */}
          {message.text && (
            <div className="flex items-center gap-2 mt-2 opacity-70 group-hover:opacity-100 transition-opacity flex-wrap">
              {message.timestamp && (
                <span className="text-[11px] font-mono text-obsidian-muted">{message.timestamp}</span>
              )}
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-[11px] text-obsidian-muted hover:text-obsidian-text transition-colors"
              >
                {copied ? <LuCheck className="w-3 h-3 text-emerald-400" /> : <LuCopy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={() => speakText(message.text, { label: 'Reading response...' })}
                className="inline-flex items-center gap-1 text-[11px] text-obsidian-muted hover:text-obsidian-text transition-colors"
              >
                <LuVolume2 className="w-3 h-3" />
                Listen
              </button>
              {window.electronAPI && (
                <button
                  onClick={handleSaveNote}
                  className="inline-flex items-center gap-1 text-[11px] text-obsidian-muted hover:text-obsidian-text transition-colors"
                >
                  <LuFileText className="w-3 h-3" />
                  {savedNotice ? 'Saved to Desktop' : 'Save Note'}
                </button>
              )}
              {onRegenerate && (
                <button
                  onClick={() => onRegenerate(message.id)}
                  className="inline-flex items-center gap-1 text-[11px] text-obsidian-muted hover:text-obsidian-text transition-colors"
                >
                  <LuRefreshCw className="w-3 h-3" />
                  Regenerate
                </button>
              )}
              {/* Reactions */}
              <div className="inline-flex items-center gap-0.5 ml-1">
                <button
                  onClick={() => handleReaction('up')}
                  className={`p-1 rounded transition-colors ${
                    reaction === 'up'
                      ? 'text-emerald-400 bg-emerald-500/10'
                      : 'text-obsidian-muted hover:text-obsidian-text'
                  }`}
                >
                  <LuThumbsUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => handleReaction('down')}
                  className={`p-1 rounded transition-colors ${
                    reaction === 'down'
                      ? 'text-red-400 bg-red-500/10'
                      : 'text-obsidian-muted hover:text-obsidian-text'
                  }`}
                >
                  <LuThumbsDown className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
