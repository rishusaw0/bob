import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  LuPaperclip,
  LuCamera,
  LuVolume2,
  LuVolumeX,
  LuMic,
  LuMicOff,
  LuArrowUp,
  LuX,
  LuFileText,
  LuSparkles,
  LuImage,
  LuLanguages,
  LuMonitor,
  LuTerminal,
  LuDownload,
  LuTrash2,
  LuCpu,
  LuZap,
} from 'react-icons/lu';
import { startVoiceCapture } from '../services/voiceCapture';
import { isTextOrDocAttachment } from '../services/docExtractor';
import { toast } from '../services/toast';

const SLASH_COMMANDS = [
  { cmd: '/image', label: 'Generate Image', icon: LuImage, hint: '/image <prompt>', run: (arg) => arg ? `Generate an image: ${arg}` : null },
  { cmd: '/translate', label: 'Translate Text', icon: LuLanguages, hint: '/translate [lang] <text>', run: (arg) => arg ? `Translate this: ${arg}` : null },
  { cmd: '/summarize', label: 'Summarize Chat', icon: LuSparkles, hint: '/summarize', run: () => 'Summarize our entire conversation concisely.' },
  { cmd: '/screenread', label: 'Screen Reader (Offline)', icon: LuMonitor, hint: '/screenread', run: () => 'Screen padh kar sunao aur clickable buttons batao' },
  { cmd: '/screenshot', label: 'Take Screenshot', icon: LuMonitor, hint: '/screenshot', run: () => 'Screenshot le lo aur batao screen par kya hai' },
  { cmd: '/system', label: 'System Info', icon: LuCpu, hint: '/system', run: () => 'System ki complete info batao' },
  { cmd: '/voice', label: 'Switch Voice', icon: LuVolume2, hint: '/voice [en/hi/mix]', meta: 'settings' },
  { cmd: '/clear', label: 'Clear Chat', icon: LuTrash2, hint: '/clear', meta: 'action-clear' },
  { cmd: '/export', label: 'Export Thread', icon: LuDownload, hint: '/export', meta: 'action-export' },
  { cmd: '/run', label: 'Run Command', icon: LuTerminal, hint: '/run <command>', run: (arg) => arg ? `Run this command: ${arg}` : null },
  { cmd: '/explain', label: 'Explain Code', icon: LuZap, hint: '/explain <code or concept>', run: (arg) => arg ? `Explain this in detail with examples: ${arg}` : null },
];

export default function InputBar({
  onSend,
  isLoading,
  isReady,
  brainMode = 'auto',
  onBrainModeChange = null,
  ttsEnabled,
  onToggleTTS,
  voiceMode,
  onVoiceModeChange,
  onClear,
  onExport,
}) {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [voiceLang, setVoiceLang] = useState('hi-IN');
  const [autoSendVoice, setAutoSendVoice] = useState(() => localStorage.getItem('jeeva_autosend_voice') !== 'false');
  const [attachment, setAttachment] = useState(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashHighlight, setSlashHighlight] = useState(0);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const spokenBufferRef = useRef('');
  const autoSendTimerRef = useRef(null);

  const slashMatches = useMemo(() => {
    if (!text.startsWith('/')) return [];
    const typed = text.split(' ')[0].toLowerCase();
    return SLASH_COMMANDS.filter((s) => s.cmd.startsWith(typed));
  }, [text]);

  const executeSlashCommand = useCallback((entry) => {
    const afterCmd = text.slice(entry.cmd.length).trim();

    if (entry.meta === 'settings') {
      const v = afterCmd === 'en' ? 'english' : afterCmd === 'hi' ? 'hindi' : afterCmd === 'mix' ? 'hinglish' : 'auto';
      onVoiceModeChange(v);
      toast.success(`Voice switched to ${v}`);
      setText('');
      setSlashOpen(false);
      return;
    }
    if (entry.meta === 'action-clear') {
      onClear?.();
      setText('');
      setSlashOpen(false);
      return;
    }
    if (entry.meta === 'action-export') {
      onExport?.();
      setText('');
      setSlashOpen(false);
      return;
    }

    const prompt = entry.run?.(afterCmd);
    if (prompt) {
      setText('');
      setSlashOpen(false);
      onSend(prompt);
    } else if (afterCmd) {
      // No enough args, keep typing
    } else {
      setText(entry.cmd + ' ');
      setSlashOpen(false);
      textareaRef.current?.focus();
    }
  }, [text, onSend, onVoiceModeChange, onClear, onExport]);

  const handleSubmit = useCallback((e, overrideText = null) => {
    e?.preventDefault();
    const msgText = overrideText !== null ? overrideText : text;

    // Check if it's a slash command
    if (msgText.startsWith('/') && slashMatches.length > 0) {
      const exact = SLASH_COMMANDS.find((s) => msgText.startsWith(s.cmd));
      if (exact) {
        executeSlashCommand(exact);
        return;
      }
    }

    if ((!msgText.trim() && !attachment) || isLoading) return;
    onSend(msgText, attachment);
    setText('');
    setAttachment(null);
    setSlashOpen(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    textareaRef.current?.focus();
  }, [text, attachment, isLoading, onSend, slashMatches, executeSlashCommand]);

  const handleKeyDown = (e) => {
    if (slashOpen && slashMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashHighlight((h) => Math.min(h + 1, slashMatches.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        executeSlashCommand(slashMatches[slashHighlight]);
        return;
      }
      if (e.key === 'Escape') {
        setSlashOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextChange = (e) => {
    const val = e.target.value;
    setText(val);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 144) + 'px';

    if (val.startsWith('/') && val.length <= 20) {
      setSlashOpen(true);
      setSlashHighlight(0);
    } else {
      setSlashOpen(false);
    }
  };

  const loadFile = (file) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error('File must be under 15 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const mimeType =
        file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
      const isImage = mimeType.startsWith('image/');
      setAttachment({
        dataUrl: ev.target.result,
        mimeType,
        name: file.name,
        isImage,
        isDocument: !isImage && isTextOrDocAttachment({ name: file.name, mimeType, isImage }),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e) => {
    loadFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length > 0) {
      loadFile(e.dataTransfer.files[0]);
    }
  };

  const handleCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      await new Promise(r => setTimeout(r, 400));

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);

      stream.getTracks().forEach(t => t.stop());
      setAttachment({
        dataUrl: canvas.toDataURL('image/jpeg', 0.85),
        mimeType: 'image/jpeg',
        name: 'camera-frame.jpg',
        isImage: true,
        isDocument: false,
      });
    } catch {
      toast.error('Camera access denied.');
    }
  };

  useEffect(() => {
    return () => {
      recognitionRef.current?.cancel?.();
      window.dispatchEvent(new CustomEvent('jeeva-mic-active', { detail: false }));
    };
  }, []);

  const canUseBrain = isReady || brainMode !== 'cloud';

  const startRecording = () => {
    if (!canUseBrain) {
      toast.error('Pehle Settings mein Gemini API key connect karein ya Brain Mode ko Hybrid par set karein.');
      return;
    }
    const baseText = text ? text + ' ' : '';
    setIsRecording(true);
    setVoiceStatus('Sun raha hoon... Boliye');
    window.dispatchEvent(new CustomEvent('jeeva-mic-active', { detail: true }));

    recognitionRef.current = startVoiceCapture({
      lang: voiceLang,
      autoStopOnSilence: autoSendVoice,
      silenceMs: 1150,
      onStatus: (st) => {
        if (st === 'transcribing') setVoiceStatus('Understanding voice command...');
        else setVoiceStatus('Sun raha hoon... Boliye');
      },
      onInterim: (interimTxt) => {
        if (interimTxt && !/^(Listening|Understanding)\.\.\.$/i.test(interimTxt) && interimTxt !== 'Understanding command...') {
          setText(baseText + interimTxt);
        }
      },
      onResult: (finalCmd) => {
        recognitionRef.current = null;
        setIsRecording(false);
        setVoiceStatus('');
        window.dispatchEvent(new CustomEvent('jeeva-mic-active', { detail: false }));
        const combined = (baseText + (finalCmd || '')).trim();
        if (!combined) {
          setText(baseText.trim());
          return;
        }
        if (autoSendVoice && !isLoading) {
          setText('');
          onSend(combined, null, { fromVoice: true });
        } else {
          setText(combined + ' ');
        }
      },
      onError: (errMsg) => {
        recognitionRef.current = null;
        setIsRecording(false);
        setVoiceStatus('');
        window.dispatchEvent(new CustomEvent('jeeva-mic-active', { detail: false }));
        setText(baseText.trim());
        toast.error(errMsg || 'Microphone error');
      },
    });
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
  };

  const toggleAutoSendVoice = () => {
    setAutoSendVoice((prev) => {
      const next = !prev;
      localStorage.setItem('jeeva_autosend_voice', String(next));
      return next;
    });
  };

  return (
    <div
      className="px-4 sm:px-6 pb-4 pt-2 bg-obsidian-bg"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <div className="max-w-3xl mx-auto">
        {/* Docked Composer */}
        <form
          onSubmit={handleSubmit}
          className={`bg-obsidian-surface border rounded-2xl p-2.5 transition-colors shadow-lg relative ${
            isDragging ? 'border-zinc-400 bg-obsidian-elevated' : 'border-obsidian-border focus-within:border-zinc-600'
          }`}
        >
          {/* Slash Command Autocomplete Popup */}
          {slashOpen && slashMatches.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-obsidian-surface border border-obsidian-border rounded-xl shadow-2xl overflow-hidden z-50 max-h-64 overflow-y-auto">
              <div className="px-3 py-1.5 border-b border-obsidian-border">
                <span className="text-[10px] font-mono uppercase tracking-wider text-obsidian-muted">
                  Slash Commands
                </span>
              </div>
              {slashMatches.map((entry, idx) => {
                const Icon = entry.icon;
                return (
                  <button
                    key={entry.cmd}
                    type="button"
                    onClick={() => executeSlashCommand(entry)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                      idx === slashHighlight
                        ? 'bg-obsidian-elevated text-obsidian-text'
                        : 'text-obsidian-secondary hover:bg-obsidian-elevated hover:text-obsidian-text'
                    }`}
                  >
                    <Icon className="w-4 h-4 text-obsidian-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">{entry.label}</span>
                      <span className="text-[11px] font-mono text-obsidian-muted ml-2">{entry.hint}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {/* Attachment Preview + PDF Quick Actions */}
          {attachment && (
            <div className="px-2 pb-2.5 mb-2 border-b border-obsidian-border flex flex-wrap items-center gap-2">
              <div className="relative inline-flex items-center gap-2 bg-obsidian-bg border border-obsidian-border rounded-lg p-1.5 pr-7">
                {attachment.isImage ? (
                  <img src={attachment.dataUrl} alt="Upload" className="h-14 rounded object-cover" />
                ) : (
                  <div className="flex items-center gap-2 px-1.5 py-1 text-xs text-obsidian-text">
                    <LuFileText className="w-4 h-4 text-obsidian-secondary" />
                    <span className="max-w-[180px] truncate font-mono">{attachment.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="absolute top-1 right-1 p-0.5 rounded bg-obsidian-elevated text-obsidian-muted hover:text-obsidian-text"
                >
                  <LuX className="w-3 h-3" />
                </button>
              </div>

              {attachment.isDocument && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleSubmit(null, 'Is PDF ko poora read karke sunao (clear aur natural bhasha mein).')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-obsidian-elevated hover:bg-obsidian-hover border border-obsidian-border text-xs text-obsidian-text transition-colors"
                  >
                    <LuVolume2 className="w-3.5 h-3.5 text-emerald-400" />
                    Read Aloud
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSubmit(null, 'Is PDF ka short summary batao aur sunao.')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-obsidian-elevated hover:bg-obsidian-hover border border-obsidian-border text-xs text-obsidian-text transition-colors"
                  >
                    <LuSparkles className="w-3.5 h-3.5 text-obsidian-secondary" />
                    Summarize & Listen
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Input Textarea */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={
              voiceStatus
                ? voiceStatus
                : canUseBrain
                  ? 'Ask anything, drop a PDF/TXT, or give a PC command...'
                  : 'Connect Gemini API key or switch Brain to Hybrid'
            }
            rows={1}
            className="w-full bg-transparent px-2 py-1.5 text-sm text-obsidian-text placeholder:text-obsidian-muted focus:outline-none resize-none max-h-36 overflow-y-auto"
            disabled={!canUseBrain}
          />

          {/* Bottom Toolbar */}
          <div className="flex items-center justify-between pt-2 mt-1 border-t border-obsidian-border/60">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-lg text-obsidian-secondary hover:text-obsidian-text hover:bg-obsidian-elevated transition-colors"
                title="Attach PDF, TXT, DOCX, Image, Video, or Audio"
              >
                <LuPaperclip className="w-4 h-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.json,.log,image/*,video/*,audio/*"
                onChange={handleFileUpload}
                className="hidden"
              />

              <button
                type="button"
                onClick={handleCamera}
                className="p-1.5 rounded-lg text-obsidian-secondary hover:text-obsidian-text hover:bg-obsidian-elevated transition-colors"
                title="Capture Camera Frame"
              >
                <LuCamera className="w-4 h-4" />
              </button>

              {window.electronAPI && (
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => onSend('Screen padh kar sunao aur buttons batao')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-mono text-obsidian-secondary hover:text-emerald-300 hover:bg-obsidian-elevated transition-colors disabled:opacity-40"
                  title="Read active screen text & clickable buttons offline"
                >
                  <LuMonitor className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Screen</span>
                </button>
              )}

              <button
                type="button"
                onClick={onToggleTTS}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors ${
                  ttsEnabled
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : 'text-obsidian-muted hover:text-obsidian-text hover:bg-obsidian-elevated'
                }`}
                title="Toggle Auto Voice Reply"
              >
                {ttsEnabled ? <LuVolume2 className="w-3.5 h-3.5" /> : <LuVolumeX className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{ttsEnabled ? 'Voice On' : 'Voice Off'}</span>
              </button>

              {onBrainModeChange && (
                <select
                  value={brainMode}
                  onChange={(e) => onBrainModeChange(e.target.value)}
                  className={`bg-obsidian-bg hover:bg-obsidian-elevated border rounded-lg px-2 py-1 text-[11px] font-mono focus:outline-none cursor-pointer transition-colors ${
                    brainMode === 'offline'
                      ? 'border-emerald-500/40 text-emerald-300'
                      : brainMode === 'cloud'
                        ? 'border-sky-500/40 text-sky-300'
                        : 'border-obsidian-border text-obsidian-secondary hover:text-obsidian-text'
                  }`}
                  title="Brain Mode: Auto Hybrid (chhota/moderate=Local, bada=Gemini), Offline Only (0 API), or Gemini Cloud"
                >
                  <option value="auto" className="bg-obsidian-surface">Brain: Hybrid</option>
                  <option value="offline" className="bg-obsidian-surface">Brain: Offline</option>
                  <option value="cloud" className="bg-obsidian-surface">Brain: Gemini</option>
                </select>
              )}

              <select
                value={voiceMode}
                onChange={(e) => onVoiceModeChange(e.target.value)}
                className="bg-obsidian-bg hover:bg-obsidian-elevated border border-obsidian-border rounded-lg px-2 py-1 text-[11px] font-mono text-obsidian-secondary hover:text-obsidian-text focus:outline-none cursor-pointer transition-colors"
                title="Speaker Voice Profile (Auto / English / Hindi / Hinglish)"
              >
                <option value="auto" className="bg-obsidian-surface">Voice: Auto</option>
                <option value="english" className="bg-obsidian-surface">Voice: English</option>
                <option value="hindi" className="bg-obsidian-surface">Voice: Hindi</option>
                <option value="hinglish" className="bg-obsidian-surface">Voice: Hinglish</option>
              </select>

              <button
                type="button"
                onClick={() => setVoiceLang(l => (l === 'hi-IN' ? 'en-IN' : 'hi-IN'))}
                className="px-2 py-1 rounded-lg text-[11px] font-mono text-obsidian-muted hover:text-obsidian-text hover:bg-obsidian-elevated transition-colors"
                title="Mic Dictation Language"
              >
                {voiceLang === 'hi-IN' ? 'Mic: HI/EN' : 'Mic: EN'}
              </button>

              <button
                type="button"
                onClick={toggleAutoSendVoice}
                className={`px-2 py-1 rounded-lg text-[11px] font-mono transition-colors ${
                  autoSendVoice
                    ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/25'
                    : 'text-obsidian-muted hover:text-obsidian-text hover:bg-obsidian-elevated'
                }`}
                title="Hands-Free Voice: automatically sends command when you pause speaking"
              >
                {autoSendVoice ? 'Hands-Free' : 'Draft Mic'}
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                className={`p-2 rounded-lg transition-colors ${
                  isRecording
                    ? 'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse'
                    : 'text-obsidian-secondary hover:text-obsidian-text hover:bg-obsidian-elevated'
                }`}
                title={isRecording ? 'Stop Dictation' : 'Voice Dictation'}
              >
                {isRecording ? <LuMicOff className="w-4 h-4" /> : <LuMic className="w-4 h-4" />}
              </button>

              <button
                type="submit"
                disabled={isLoading || (!text.trim() && !attachment)}
                className="p-2 rounded-lg bg-zinc-100 text-zinc-950 hover:bg-white disabled:bg-obsidian-elevated disabled:text-obsidian-muted disabled:cursor-not-allowed transition-colors"
                title="Send (Enter)"
              >
                <LuArrowUp className="w-4 h-4" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
