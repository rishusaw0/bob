import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import ChatWindow from './components/ChatWindow';
import InputBar from './components/InputBar';
import Sidebar from './components/Sidebar';
import TitleBar from './components/TitleBar';
import WelcomeScreen from './components/WelcomeScreen';
import PermissionModal from './components/PermissionModal';
import AudioPlayerBar from './components/AudioPlayerBar';
import CommandPalette from './components/CommandPalette';
import CortanaView from './components/CortanaView';
import SpeakerPill from './components/SpeakerPill';

const SettingsPanel = lazy(() => import('./components/SettingsPanel'));
const OnboardingWizard = lazy(() => import('./components/OnboardingWizard'));
const PcControlCenterModal = lazy(() => import('./components/PcControlCenterModal'));
import {
  initGemini,
  setModel as setGeminiModel,
  setCustomInstructions as setGeminiInstructions,
  setAiNamePrompt,
  sendMessage,
  resetConversation,
  generateTitle,
} from './services/gemini';
import { speakText, stopSpeech, getVoiceMode, setVoiceMode as setSpeechVoiceMode, createStreamingSpeaker, getSpeechSpeedMode } from './services/speech';
import { playWakeChime } from './services/earcon';
import { startVoiceCapture } from './services/voiceCapture';
import {
  detectCommandLanguage,
  buildLocalizedPermissionQuestion,
  parseVoiceConfirmation,
} from './services/voicePermissionPrompt';
import { getAiName, getStrictVoiceMode, getWakeOpenMode } from './services/voiceRouter';
import { getDocSummaryPref, setDocSummaryPref, getReplyStyle, setReplyStyle } from './services/userPrefs';
import { runLocalQuickBrain, buildLocalTitle } from './services/localQuickBrain';
import { runLocalSlmTurn } from './services/localLlm';
import {
  getBrainMode,
  setBrainMode as persistBrainMode,
  assessQueryRouting,
  recordBrainUsage,
  compactHistoryForCloud,
} from './services/brainRouter';
import { logEpisodicTurn } from './services/episodicMemory';
import { isTextOrDocAttachment, runLocalDocumentTurn } from './services/docExtractor';
import { useVoiceEngine } from './services/useVoiceEngine';
import { useWatchdogAndStats } from './hooks/useWatchdogAndMemory';
import ToastContainer from './components/ToastContainer';
import { toast } from './services/toast';

export default function App() {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(() => window.innerWidth >= 900);
  const [showPalette, setShowPalette] = useState(false);
  const [showPcControl, setShowPcControl] = useState(false);
  const [pcControlTab, setPcControlTab] = useState('clipboard');
  const [windowMode, setWindowMode] = useState('full'); // Always start in Full Chat Workstation
  const [autoListenSignal, setAutoListenSignal] = useState(0);
  const [apiKey, setApiKey] = useState(
    () => (window.electronAPI ? '' : (localStorage.getItem('jeeva_api_key') || import.meta.env.VITE_GEMINI_API_KEY || ''))
  );
  const [model, setModel] = useState(
    () => localStorage.getItem('jeeva_model') || 'gemini-3.5-flash-lite'
  );
  const [customInstructions, setCustomInstructions] = useState(
    () => localStorage.getItem('jeeva_custom_instructions') || ''
  );
  const [isReady, setIsReady] = useState(false);
  const [conversations, setConversations] = useState(() => {
    try {
      const saved = localStorage.getItem('jeeva_conversations');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [ttsEnabled, setTtsEnabled] = useState(() => localStorage.getItem('jeeva_tts') === 'true');
  const [voiceMode, setVoiceMode] = useState(() => getVoiceMode());
  const [docSummaryPref, setDocSummaryPrefState] = useState(() => getDocSummaryPref());
  const [replyStyle, setReplyStyleState] = useState(() => getReplyStyle());
  const [aiName, setAiNameState] = useState(() => getAiName());
  const [brainMode, setBrainModeState] = useState(() => getBrainMode());
  const [permissionRequest, setPermissionRequest] = useState(null);
  const [showWizard, setShowWizard] = useState(
    () => Boolean(window.electronAPI) && localStorage.getItem('jeeva_onboarding_done') !== 'true'
  );
  const permissionResolverRef = useRef(null);
  const permissionCleanupRef = useRef(null);
  const activePermIdRef = useRef(null);
  const activeVoiceTurnRef = useRef(false);
  const voiceprintMismatchRef = useRef(false);
  const lastUserPromptRef = useRef('');

  // Handle browser back/forward navigation & ?pair= auto-pairing URL + Electron jeeva:// deep links
  useEffect(() => {

    const onAiNameEvent = (ev) => {
      if (ev?.detail) {
        setAiNameState(ev.detail);
        setAiNamePrompt(ev.detail);
      }
    };
    setAiNamePrompt(aiName);
    window.addEventListener('jeeva-ai-name-updated', onAiNameEvent);

    const unsubSched = window.electronAPI?.onSchedulerFired?.((item) => {
      const label = item?.message || item?.description || 'Scheduled PC task completed';
      if (item?.earlyWarning) {
        toast.info(`⏰ 30 Min Alert (${item.timeLabel || ''}): ${label}`);
        speakText?.(`30 minute baad aapka kaam hai: ${label}`, { instant: true }).catch?.(() => {});
        return;
      }
      toast.success(`⏰ ${label}`);
      if (item?.kind === 'reminder') {
        speakText?.(`Reminder: ${label}`, { instant: true }).catch?.(() => {});
      }
    });

    // Proactive Startup / Device-Open Catch-Up for Today's & Missed Reminders (90-day retention)
    const agendaTimer = setTimeout(async () => {
      if (!window.electronAPI?.scheduler) return;
      try {
        const agenda = await window.electronAPI.scheduler('agenda');
        const todayItems = Array.isArray(agenda?.todayItems) ? agenda.todayItems : [];
        const missedItems = Array.isArray(agenda?.missedItems) ? agenda.missedItems : [];
        if (todayItems.length === 0 && missedItems.length === 0) return;
        if (sessionStorage.getItem('jeeva_agenda_announced') === (agenda?.todayKey || '1')) return;
        sessionStorage.setItem('jeeva_agenda_announced', agenda?.todayKey || '1');

        const lines = [];
        if (todayItems.length > 0) {
          lines.push('**Aaj ke Reminders:**');
          todayItems.forEach((it) => lines.push(`• ${it.timeLabel || 'Today'}: ${it.message}`));
        }
        if (missedItems.length > 0) {
          lines.push('\n**Jab PC band tha tab yeh kaam miss hue (kya ho gaye?):**');
          missedItems.slice(0, 5).forEach((it) => lines.push(`• ${it.dateKey} (${it.timeLabel || ''}): ${it.message}`));
        }
        const msgText = lines.join('\n');
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 7,
            role: 'assistant',
            text: msgText,
            brainMeta: { tier: 'fast', modelLabel: 'Smart Agenda · 0 API' },
            timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
          },
        ]);

        const spokenParts = [];
        if (todayItems.length > 0) {
          spokenParts.push(`Aaj aapko yaad dilana tha: ${todayItems.map((i) => i.message).join(', ')}.`);
        }
        if (missedItems.length > 0) {
          spokenParts.push(`Jab PC band tha tab miss hua tha: ${missedItems[0].message}. Kya yeh kaam ho gaya?`);
        }
        if (spokenParts.length > 0) {
          speakText?.(spokenParts.join(' '), { instant: true }).catch?.(() => {});
        }
      } catch {}
    }, 1500);

    const unsubEmergency = window.electronAPI?.onEmergencyStop?.(() => {
      stopSpeech();
      toast.info('Emergency Stop: All voice & speech actions stopped.');
    });

    return () => {
      clearTimeout(agendaTimer);
      window.removeEventListener('jeeva-ai-name-updated', onAiNameEvent);
      unsubSched?.();
      unsubEmergency?.();
    };
  }, [aiName]);

  // Load API key from OS-encrypted safeStorage vault on Electron startup
  useEffect(() => {
    if (!window.electronAPI?.vaultGetKey) return;
    // Desktop API keys must never be read from or written to renderer localStorage.
    localStorage.removeItem('jeeva_api_key');
    window.electronAPI.vaultGetKey().then((vaultKey) => {
      if (vaultKey) setApiKey(vaultKey);
    }).catch((err) => {
      console.error('Could not read the encrypted API key vault:', err);
    });
  }, []);

  useEffect(() => {
    if (apiKey) {
      try {
        initGemini(apiKey);
        if (window.electronAPI?.vaultSaveKey) {
          localStorage.removeItem('jeeva_api_key');
          window.electronAPI.vaultSaveKey(apiKey).then((saved) => {
            if (!saved) console.warn('OS encryption is unavailable; API key remains in memory only.');
          }).catch((err) => console.error('Could not save API key to encrypted vault:', err));
        } else {
          localStorage.setItem('jeeva_api_key', apiKey);
        }
        setIsReady(true);
      } catch (err) {
        console.error('Failed to init Gemini:', err);
        setIsReady(false);
      }
      return;
    }
    localStorage.removeItem('jeeva_api_key');
    window.electronAPI?.vaultSaveKey?.('').catch?.((err) => console.error('Could not clear API key vault:', err));
    setIsReady(false);
  }, [apiKey]);

  // Initialize live system telemetry and watchdog state used throughout the UI.
  const { liveStats, watchdogAlert, applyWatchdogFix } = useWatchdogAndStats({
    isElectron: Boolean(window.electronAPI),
    onOpenControlTab: (tab) => {
      setPcControlTab(tab);
      setShowPcControl(true);
    },
  });

  const handleSend = useCallback(async (text, attachment = null, meta = null) => {
    if (!text.trim() && !attachment) return;

    const fromVoice = Boolean(meta?.fromVoice);
    const forceCloud = Boolean(meta?.forceCloud);
    const routing = assessQueryRouting(text, attachment, forceCloud ? 'cloud' : brainMode, {
      batteryLow: Boolean(liveStats?.battery && liveStats.battery < 20 && !liveStats?.charging),
    });
    const promptText = routing.cleanText;

    lastUserPromptRef.current = String(meta?.rawVoiceText || text).trim();
    activeVoiceTurnRef.current = fromVoice;
    voiceprintMismatchRef.current = meta?.speakerVerified === false;

    const userMsg = {
      id: Date.now(),
      role: 'user',
      text: text.trim() || (attachment ? `Attachment: ${attachment.name}` : ''),
      image: attachment?.isImage ? attachment.dataUrl : null,
      timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    const typingId = Date.now() + 1;
    setMessages(prev => [...prev, { id: typingId, role: 'assistant', text: '', tools: [], isTyping: true }]);

    const finalizeReply = ({
      replyText,
      tier = 'fast',
      modelLabel = 'Instant Local',
      routeReason = routing.routeReason,
      image = null,
      tools = [],
      shouldSpeak = ttsEnabled || fromVoice,
      speakLabel = 'Reading response...',
    }) => {
      if (tier && tier !== 'offline-guard') {
        recordBrainUsage(tier, promptText.length);
      }
      if (messages.length === 0 && tier !== 'cloud') {
        const localTitle = buildLocalTitle(promptText);
        if (localTitle) {
          setMessages(prev => prev.map(m => (m.id === userMsg.id ? { ...m, aiTitle: localTitle } : m)));
        }
      }
      setMessages(prev =>
        prev.map(m =>
          m.id === typingId
            ? {
                ...m,
                text: replyText || 'Done.',
                isTyping: false,
                image,
                tools,
                brainMeta: { tier, modelLabel, routeReason },
                timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
              }
            : m
        )
      );
      if (promptText && !tools.some((t) => t.name === 'episodic_recall')) {
        logEpisodicTurn({
          source: fromVoice ? 'voice' : 'chat',
          brainTier: tier,
          routeReason,
          userPrompt: promptText,
          assistantReply: replyText,
          toolsUsed: tools.map((t) => t.name),
        }).catch(() => {});
      }
      if (typeof document !== 'undefined' && document.hidden && window.electronAPI?.updateNotchState) {
        window.electronAPI.updateNotchState({
          userMessage: String(promptText || '').slice(0, 80),
          replyText: String(replyText || 'Done.').replace(/\s+/g, ' ').slice(0, 120),
          error: '',
        }).catch(() => {});
      }
      if (shouldSpeak && replyText) {
        speakText(replyText, { label: speakLabel, instant: tier !== 'cloud' });
      }
    };

    try {
      const userAskedSpeech = /\b(read aloud|speak|sunao|bolkar|bol kar|awaz mein)\b/i.test(promptText);
      // Tier-0 & Layer-1: Zero-API Deterministic + Slot Extractor + Episodic Date + Semantic Intent Local Brain
      if (!forceCloud && (!routing.forceCloud || routing.strictNoApi) && !attachment) {
        const quick = await runLocalQuickBrain(promptText, { requestPermission, historyMessages: messages });
        if (quick?.handled) {
          finalizeReply({
            replyText: quick.replyText || 'Done.',
            tier: quick.tier || 'fast',
            modelLabel: quick.modelLabel || 'Instant Local',
            routeReason: quick.routeReason || routing.routeReason,
            image: quick.image || null,
            tools: quick.tools || [],
            shouldSpeak: Boolean(ttsEnabled || fromVoice || userAskedSpeech),
            speakLabel: 'Local Brain',
          });
          return;
        }
      }

      // Local Document & PDF Reader Pipeline (0 Gemini API calls for digital PDF, DOCX, TXT, MD, CSV!)
      if (attachment && isTextOrDocAttachment(attachment) && !forceCloud && !routing.forceCloud) {
        const docTurn = await runLocalDocumentTurn({
          attachment,
          userPrompt: promptText,
          historyMessages: messages,
          requestPermission,
          fromVoice,
        });
        if (docTurn?.handled) {
          finalizeReply({
            replyText: docTurn.replyText,
            tier: docTurn.tier || 'fast',
            modelLabel: docTurn.modelLabel || 'Offline Doc Reader',
            routeReason: docTurn.routeReason,
            tools: docTurn.tools || [],
            shouldSpeak: Boolean(ttsEnabled || fromVoice || userAskedSpeech),
            speakLabel: `Reading: ${attachment.name}`,
          });
          return;
        }
      }

      // Tier-2: Low-End Friendly Local SLM Brain (with 15s CPU timeout guard)
      if (routing.shouldTryLocalFirst && !attachment) {
        const slm = await runLocalSlmTurn({
          text: promptText,
          historyMessages: messages,
          requestPermission,
          fromVoice,
          onToolUpdate: (toolsSnapshot) => {
            setMessages(prev => prev.map(m => (m.id === typingId ? { ...m, tools: toolsSnapshot } : m)));
          },
        });
        if (slm?.handled) {
          finalizeReply({
            replyText: slm.replyText,
            tier: 'local-slm',
            modelLabel: slm.modelLabel || 'Local SLM',
            routeReason: !routing.online
              ? 'Offline auto-switch: answered with Local SLM'
              : 'Auto Hybrid: solved locally by SLM (0 Gemini API calls)',
            image: slm.image || null,
            tools: slm.tools || [],
            shouldSpeak: Boolean(ttsEnabled || fromVoice || userAskedSpeech),
            speakLabel: 'Local SLM',
          });
          return;
        }
      }

      // Command-First Local Lock: never silently burn Gemini API on PC commands
      if (routing.strictNoApi && !forceCloud) {
        finalizeReply({
          replyText:
            'PC commands abhi 100% Local AI mode par locked hain, isliye Gemini API use nahi hui. Simple commands jaise "Notepad kholo", "10 minute baad meeting reminder lagao", "Downloads organize karo", ya "YouTube par song play karo" seedhe chalte hain. Advanced multi-step commands ke liye Settings -> Local AI Brain me lightweight offline model enable karein, ya zaroorat ho to neeche "Ask Gemini" dabaiye.',
          tier: 'local-guard',
          modelLabel: 'Local Command Lock',
          routeReason: routing.routeReason,
          shouldSpeak: Boolean(ttsEnabled || fromVoice || userAskedSpeech),
          speakLabel: 'Local Guard',
        });
        return;
      }

      // Offline-Only Guard (when user selected Offline Mode OR internet is completely disconnected)
      if (routing.mode === 'offline' || !routing.online) {
        const offlineNote = !routing.online
          ? 'Internet offline detected — auto-switched to Local Mode. Is heavy query ke liye Internet connect karein ya Settings -> Local AI Brain me halka offline model pull karein.'
          : window.electronAPI
            ? 'Offline Brain Mode ON hai. Is task ke liye Settings -> Local AI Brain me halka model (Qwen 2.5 1.5B / Gemma 3 1B) setup karein, ya Brain Mode ko "Hybrid" par karein.'
            : 'Offline Brain Mode ON hai. Complex web query ke liye "Hybrid" mode select karein.';
        finalizeReply({
          replyText: offlineNote,
          tier: 'offline-guard',
          modelLabel: !routing.online ? 'Offline Auto-Switch' : 'Offline Guard',
          routeReason: routing.routeReason,
          shouldSpeak: ttsEnabled || fromVoice,
        });
        return;
      }

      // Tier-3: Escalate to Gemini Cloud (heavy/vision/search/low-confidence SLM)
      if (!isReady) {
        if (!fromVoice) {
          switchWindowMode('full');
          setShowSettings(true);
        }
        throw new Error('Is heavy task ke liye Gemini API key ya Cloud AI URL Settings me connect karein (chhote PC tasks aur date memory bina key ke bhi chalte hain).');
      }

      if (messages.length === 0 && promptText.trim()) {
        generateTitle(promptText.trim()).then((aiTitle) => {
          if (aiTitle) {
            setMessages((prev) =>
              prev.map((m) => (m.id === userMsg.id ? { ...m, aiTitle } : m))
            );
          }
        });
      }

      const historyDigest = compactHistoryForCloud(messages);
      const wantSpeech = Boolean(ttsEnabled || fromVoice || userAskedSpeech);
      const streamSpeaker =
        wantSpeech && getSpeechSpeedMode() !== 'cloud_studio'
          ? createStreamingSpeaker({ label: attachment?.isDocument ? `Reading: ${attachment.name}` : 'Answering...' })
          : null;
      try {
        const response = await sendMessage(
          promptText,
          attachment,
          (streamedText) => {
            streamSpeaker?.push(streamedText);
            setMessages(prev =>
              prev.map(m => (m.id === typingId ? { ...m, text: streamedText, isTyping: false } : m))
            );
          },
          requestPermission,
          (toolsSnapshot) => {
            setMessages(prev =>
              prev.map(m => (m.id === typingId ? { ...m, tools: toolsSnapshot } : m))
            );
          },
          { fromVoice, strictVoice: getStrictVoiceMode(), historyDigest }
        );

        const fallbackToolSummary =
          response.tools?.length > 0
            ? `Done: ${response.tools.map((t) => t.name.replace(/_/g, ' ')).join(', ')}.`
            : 'Completed.';
        const finalAssistantText = (response.text || '').trim() || fallbackToolSummary;

        if (streamSpeaker) {
          streamSpeaker.finish(finalAssistantText);
        }

        finalizeReply({
          replyText: finalAssistantText,
          tier: 'cloud',
          modelLabel: routing.heavyReason ? `Gemini Cloud (${routing.heavyReason.replace(/_/g, ' ')})` : 'Gemini Cloud',
          routeReason: routing.routeReason,
          image: response.image || null,
          tools: response.tools || [],
          shouldSpeak: wantSpeech && !streamSpeaker,
          speakLabel: attachment?.isDocument ? `Reading: ${attachment.name}` : 'Reading response...',
        });
      } catch (cloudErr) {
        streamSpeaker?.cancel();
        // Reverse Auto-Switch Fallback: if Gemini rate-limited (429) or unreachable, retry with Local SLM!
        const msg = String(cloudErr?.message || cloudErr);
        const canFallbackLocal = !attachment && /429|503|quota|rate|fetch|network|timeout|unavailable/i.test(msg);
        if (canFallbackLocal) {
          const slmFallback = await runLocalSlmTurn({
            text: promptText,
            historyMessages: messages,
            requestPermission,
            fromVoice,
          });
          if (slmFallback?.handled) {
            finalizeReply({
              replyText: slmFallback.replyText,
              tier: 'local-slm',
              modelLabel: `${slmFallback.modelLabel || 'Local SLM'} (Auto-Fallback)`,
              routeReason: 'Gemini busy/unreachable — Auto-Switched back to Local SLM',
              image: slmFallback.image || null,
              tools: slmFallback.tools || [],
            });
            return;
          }
        }
        throw cloudErr;
      }
    } catch (err) {
      setMessages(prev =>
        prev.map(m =>
          m.id === typingId
            ? {
                ...m,
                text: err.message,
                isTyping: false,
                isError: true,
              }
            : m
        )
      );
    } finally {
      activeVoiceTurnRef.current = false;
      voiceprintMismatchRef.current = false;
      setIsLoading(false);
    }
  }, [isReady, brainMode, liveStats, ttsEnabled, requestPermission, apiKey, switchWindowMode, messages]);

  // Persistent Always-On Wake Word & Mic Engine:
  // - On Electron Desktop: active 24/7 across Full, Minimized, Tray, Speaker & Cortana modes once API/Cloud is ready
  // - Runs inside the local Windows desktop app across Full, Minimized, Tray, Speaker & Cortana modes
  const voiceEngine = useVoiceEngine({
    aiName,
    onSend: handleSend,
    isLoading,
    autoListenSignal,
    requestPermission,
    enabled: Boolean(
      ((window.electronAPI && (isReady || brainMode !== 'cloud')) ||
        (isReady && windowMode !== 'full'))
    ),
    onWakeOpen: (mode) => {
      if (mode && mode !== 'notch') setWindowMode(mode);
    },
  });

  const handleLoadConv = useCallback((conv) => {
    setMessages(conv.messages);
    resetConversation();
    if (window.innerWidth < 900) setShowSidebar(false);
  }, []);

  const handleDeleteConv = useCallback((convId) => {
    setConversations(prev => prev.filter(c => c.id !== convId));
  }, []);

  const handleExportChat = useCallback(async () => {
    if (!messages.length) return;
    const md = messages
      .map(m => `### ${m.role === 'user' ? 'User' : 'JEEVA'} (${m.timestamp || ''})\n\n${m.text || ''}`)
      .join('\n\n---\n\n');
    if (window.electronAPI?.saveDesktopFile) {
      await window.electronAPI.saveDesktopFile(`jeeva-thread-${Date.now()}.md`, md);
      toast.success('Thread exported to Desktop!');
    } else {
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jeeva-thread-${Date.now()}.md`;
      a.click();
    }
  }, [messages]);

  const handleClearHistory = useCallback(() => {
    setConversations([]);
    localStorage.removeItem('jeeva_conversations');
    toast.info('Conversation history cleared');
  }, []);

  // Edit user message → replay from that point
  const handleEditMessage = useCallback((msgId, newText) => {
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    // Remove everything from this message onward
    setMessages((prev) => prev.slice(0, idx));
    resetConversation();
    // Re-send with edited text
    setTimeout(() => handleSend(newText), 50);
  }, [messages, handleSend]);

  // Regenerate last assistant response
  const handleRegenerate = useCallback((msgId) => {
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    // Find the user message just before this assistant message
    let userMsg = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMsg = messages[i];
        break;
      }
    }
    if (!userMsg) return;
    // Remove the assistant message and replay
    setMessages((prev) => prev.slice(0, idx));
    resetConversation();
    setTimeout(() => handleSend(userMsg.text), 50);
  }, [messages, handleSend]);

  // Escalate a specific local reply straight to Gemini Cloud API
  const handleEscalateToGemini = useCallback((msgId) => {
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    let userMsg = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMsg = messages[i];
        break;
      }
    }
    if (!userMsg) return;
    setMessages((prev) => prev.slice(0, idx));
    setTimeout(() => handleSend(userMsg.text, null, { forceCloud: true }), 50);
  }, [messages, handleSend]);

  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant' && !m.isTyping);

  if (windowMode === 'speaker') {
    return (
      <>
        <SpeakerPill
          aiName={aiName}
          onSend={handleSend}
          isLoading={isLoading}
          lastAssistantMessage={lastAssistantMessage}
          liveStats={liveStats}
          voiceEngine={voiceEngine}
          onExpandToChat={() => switchWindowMode('full')}
          onOpenCortana={() => switchWindowMode('cortana')}
          autoListenSignal={autoListenSignal}
        />
        <PermissionModal request={permissionRequest} onDecision={handlePermissionDecision} />
        <ToastContainer />
      </>
    );
  }

  if (windowMode === 'cortana') {
    return (
      <>
        <CortanaView
          aiName={aiName}
          onSend={handleSend}
          isLoading={isLoading}
          lastAssistantMessage={lastAssistantMessage}
          voiceEngine={voiceEngine}
          onExpandToChat={() => switchWindowMode('full')}
          onSwitchSpeaker={() => switchWindowMode('speaker')}
          onOpenSettings={() => setShowSettings(true)}
          voiceMode={voiceMode}
          onVoiceModeChange={setVoiceMode}
          autoListenSignal={autoListenSignal}
        />

        <Suspense fallback={null}>
          {showSettings && (
            <SettingsPanel
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              ttsEnabled={ttsEnabled}
              onToggleTTS={() => setTtsEnabled(!ttsEnabled)}
              voiceMode={voiceMode}
              onVoiceModeChange={setVoiceMode}
              model={model}
              onModelChange={setModel}
              customInstructions={customInstructions}
              onCustomInstructionsChange={setCustomInstructions}
              onExportChat={handleExportChat}
              onClearHistory={handleClearHistory}
              onOpenWizard={() => setShowWizard(true)}
              onClose={() => setShowSettings(false)}
            />
          )}

          {showWizard && window.electronAPI && (
            <OnboardingWizard
              initialApiKey={apiKey}
              onSaveApiKey={setApiKey}
              onComplete={() => setShowWizard(false)}
            />
          )}
        </Suspense>

        <PermissionModal request={permissionRequest} onDecision={handlePermissionDecision} />
        <ToastContainer />
      </>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-obsidian-bg text-obsidian-text overflow-hidden">
      <TitleBar
        aiName={aiName}
        onMenuClick={() => setShowSidebar(!showSidebar)}
        onSettingsClick={() => setShowSettings(true)}
        onNewChat={handleNewChat}
        onOpenPalette={() => setShowPalette(true)}
        onOpenPcControl={openPcControlCenter}
        onSwitchCortana={() => switchWindowMode('cortana')}
        onSwitchSpeaker={() => switchWindowMode('speaker')}
        wakeEnabled={voiceEngine.wakeEnabled}
        orbState={voiceEngine.orbState}
        onToggleWake={voiceEngine.toggleWake}
        model={model}
        onModelChange={setModel}
        liveStats={liveStats}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {showSidebar && (
          <Sidebar
            conversations={conversations}
            onSelect={handleLoadConv}
            onDelete={handleDeleteConv}
            onNewChat={handleNewChat}
            onOpenSettings={() => setShowSettings(true)}
            onOpenPcControl={openPcControlCenter}
            onQuickPrompt={(p) => handleSend(p)}
            isReady={isReady}
            liveStats={liveStats}
          />
        )}

        <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-obsidian-bg">
          {watchdogAlert && (
            <div className="mx-4 mt-2.5 px-3.5 py-2 rounded-xl bg-amber-950/35 border border-amber-500/40 flex items-center justify-between gap-3 text-xs animate-fade-in">
              <div className="min-w-0">
                <span className="font-semibold text-amber-300">{watchdogAlert.title}: </span>
                <span className="text-obsidian-secondary">{watchdogAlert.message}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {watchdogAlert.fixAction && (
                  <button
                    type="button"
                    onClick={() => applyWatchdogFix(watchdogAlert)}
                    className="px-2.5 py-1 rounded-md bg-amber-400 text-zinc-950 font-semibold hover:bg-amber-300"
                  >
                    {watchdogAlert.fixAction.label}
                  </button>
                )}
                <button
                  type="button"
                  onClick={dismissWatchdogAlert}
                  className="text-obsidian-muted hover:text-obsidian-text px-1"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {messages.length === 0 && !isLoading ? (
            <WelcomeScreen
              onSuggestionClick={(p) => handleSend(p)}
              isReady={isReady}
              onSetupClick={() => setShowSettings(true)}
            />
          ) : (
            <ChatWindow
              messages={messages}
              onEdit={handleEditMessage}
              onRegenerate={handleRegenerate}
              onEscalateToGemini={handleEscalateToGemini}
              onPermissionDecision={handlePermissionDecision}
            />
          )}

          <AudioPlayerBar />

          <InputBar
            onSend={handleSend}
            isLoading={isLoading}
            isReady={isReady}
            brainMode={brainMode}
            onBrainModeChange={(m) => setBrainModeState(persistBrainMode(m))}
            ttsEnabled={ttsEnabled}
            onToggleTTS={() => setTtsEnabled(!ttsEnabled)}
            voiceMode={voiceMode}
            onVoiceModeChange={setVoiceMode}
            docSummaryPref={docSummaryPref}
            onDocSummaryPrefChange={(m) => setDocSummaryPrefState(setDocSummaryPref(m))}
            replyStyle={replyStyle}
            onReplyStyleChange={(s) => setReplyStyleState(setReplyStyle(s))}
            onClear={handleClearHistory}
            onExport={handleExportChat}
          />
        </main>
      </div>

      <Suspense fallback={null}>
        {showSettings && (
          <SettingsPanel
            apiKey={apiKey}
            onApiKeyChange={setApiKey}
            ttsEnabled={ttsEnabled}
            onToggleTTS={() => setTtsEnabled(!ttsEnabled)}
            voiceMode={voiceMode}
            onVoiceModeChange={setVoiceMode}
            model={model}
            onModelChange={setModel}
            customInstructions={customInstructions}
            onCustomInstructionsChange={setCustomInstructions}
            onExportChat={handleExportChat}
            onClearHistory={handleClearHistory}
            onOpenWizard={() => setShowWizard(true)}
            onClose={() => setShowSettings(false)}
          />
        )}


        {showPcControl && (
          <PcControlCenterModal
            isOpen={showPcControl}
            initialTab={pcControlTab}
            onClose={() => setShowPcControl(false)}
            liveStats={liveStats}
            watchdogAlert={watchdogAlert}
            onApplyWatchdogFix={applyWatchdogFix}
          />
        )}

        {showWizard && window.electronAPI && (
          <OnboardingWizard
            initialApiKey={apiKey}
            onSaveApiKey={setApiKey}
            onComplete={() => {
              setShowWizard(false);
              window.electronAPI?.saveWindowPrefs?.({ onboardingComplete: true });
              window.electronAPI?.updateNotchState?.({ visible: true, standby: true, orbState: 'idle' }, { explicitShow: true });
              window.electronAPI?.hideToTray?.();
            }}
          />
        )}
      </Suspense>

      <CommandPalette
        isOpen={showPalette}
        onClose={() => setShowPalette(false)}
        onRunPrompt={(p) => handleSend(p)}
        onNewChat={handleNewChat}
        onOpenSettings={() => setShowSettings(true)}
        onOpenPcControl={openPcControlCenter}
        onToggleTTS={() => setTtsEnabled(t => !t)}
        onExportChat={handleExportChat}
        onClearHistory={handleClearHistory}
        conversations={conversations}
        onSelectConv={handleLoadConv}
      />

      <PermissionModal request={permissionRequest} onDecision={handlePermissionDecision} />
      <ToastContainer />
    </div>
  );
}
