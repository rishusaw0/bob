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
const MobileConnectModal = lazy(() => import('./components/MobileConnectModal'));
const OnboardingWizard = lazy(() => import('./components/OnboardingWizard'));
const LandingPage = lazy(() => import('./components/LandingPage'));
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
import { speakText, stopSpeech, getVoiceMode, setVoiceMode as setSpeechVoiceMode } from './services/speech';
import { playWakeChime } from './services/earcon';
import { startVoiceCapture } from './services/voiceCapture';
import {
  detectCommandLanguage,
  buildLocalizedPermissionQuestion,
  parseVoiceConfirmation,
} from './services/voicePermissionPrompt';
import { refreshRenderRelayDevices, setPairToken, getAuthHeaders } from './services/bridge';
import { getAiName, getStrictVoiceMode } from './services/voiceRouter';
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
import { useVoiceEngine } from './services/useVoiceEngine';
import { useWatchdogAndStats } from './hooks/useWatchdogAndMemory';
import ToastContainer from './components/ToastContainer';
import { toast } from './services/toast';

function getInitialRouteView() {
  if (typeof window === 'undefined' || window.electronAPI) return 'app';
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const isStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches;
  if (path.startsWith('/app') || path.startsWith('/chat') || params.has('pair') || isStandalone) {
    return 'app';
  }
  return 'landing';
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(() => window.innerWidth >= 900);
  const [showPalette, setShowPalette] = useState(false);
  const [showMobileModal, setShowMobileModal] = useState(false);
  const [showPcControl, setShowPcControl] = useState(false);
  const [pcControlTab, setPcControlTab] = useState('clipboard');
  const [windowMode, setWindowMode] = useState('full'); // Always start in Full Chat Workstation
  const [autoListenSignal, setAutoListenSignal] = useState(0);
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem('jeeva_api_key') || import.meta.env.VITE_GEMINI_API_KEY || ''
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
  const [aiName, setAiNameState] = useState(() => getAiName());
  const [brainMode, setBrainModeState] = useState(() => getBrainMode());
  const [permissionRequest, setPermissionRequest] = useState(null);
  const [serverConfig, setServerConfig] = useState({
    checked: Boolean(window.electronAPI),
    serverManagedKey: false,
    requiresPin: false,
    authorized: false,
  });
  const [appToken, setAppToken] = useState(() => localStorage.getItem('jeeva_app_token') || '');
  const [cloudApiUrl, setCloudApiUrl] = useState(
    () => (localStorage.getItem('jeeva_cloud_api_url') || import.meta.env.VITE_RENDER_URL || '').trim().replace(/\/+$/, '')
  );
  const [pinEntry, setPinEntry] = useState('');
  const [pinError, setPinError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [routeView, setRouteView] = useState(() => getInitialRouteView());
  const [showWizard, setShowWizard] = useState(
    () => Boolean(window.electronAPI) && localStorage.getItem('jeeva_onboarding_done') !== 'true'
  );
  const permissionResolverRef = useRef(null);
  const permissionCleanupRef = useRef(null);
  const activePermIdRef = useRef(null);
  const activeVoiceTurnRef = useRef(false);
  const voiceprintMismatchRef = useRef(false);
  const lastUserPromptRef = useRef('');

  const updateCloudApiUrl = useCallback((url) => {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    if (clean) localStorage.setItem('jeeva_cloud_api_url', clean);
    else localStorage.removeItem('jeeva_cloud_api_url');
    setCloudApiUrl(clean);
  }, []);

  const navigateToApp = useCallback(() => {
    setRouteView('app');
    if (!window.electronAPI && window.location.pathname === '/') {
      window.history.pushState({}, '', '/app');
    }
  }, []);

  // Handle browser back/forward navigation & ?pair= auto-pairing URL + Electron jeeva:// deep links
  useEffect(() => {
    const onPopState = () => setRouteView(getInitialRouteView());
    window.addEventListener('popstate', onPopState);

    const onCloudUrlEvent = (ev) => {
      if (ev?.detail !== undefined) setCloudApiUrl(String(ev.detail || '').trim().replace(/\/+$/, ''));
    };
    const onAiNameEvent = (ev) => {
      if (ev?.detail) {
        setAiNameState(ev.detail);
        setAiNamePrompt(ev.detail);
      }
    };
    setAiNamePrompt(aiName);
    window.addEventListener('jeeva-cloud-url-updated', onCloudUrlEvent);
    window.addEventListener('jeeva-ai-name-updated', onAiNameEvent);

    if (!window.electronAPI) {
      const params = new URLSearchParams(window.location.search);
      const urlPair = (params.get('pair') || '').trim();
      if (urlPair.length >= 12) {
        setPairToken(urlPair);
        setRouteView('app');
        params.delete('pair');
        const nextSearch = params.toString();
        window.history.replaceState({}, '', `/app${nextSearch ? '?' + nextSearch : ''}`);
        toast.success('PC Pair Key linked to this browser!');
        refreshRenderRelayDevices();
      }
    } else {
      window.electronAPI?.relayStatus?.().then((s) => {
        if (s?.renderUrl && !localStorage.getItem('jeeva_cloud_api_url')) {
          updateCloudApiUrl(s.renderUrl);
        }
      }).catch(() => {});
    }

    const unsubDeep = window.electronAPI?.onDeepLinked?.((data) => {
      if (data?.renderUrl) updateCloudApiUrl(data.renderUrl);
      toast.success(`1-Click linked to ${data?.renderUrl || 'Render'}!`);
      setShowMobileModal(true);
    });

    const unsubSched = window.electronAPI?.onSchedulerFired?.((item) => {
      const label = item?.message || item?.description || 'Scheduled PC task completed';
      toast.success(`⏰ ${label}`);
      if (item?.kind === 'reminder') {
        speakText?.(`Reminder: ${label}`, { autoStop: true }).catch?.(() => {});
      }
    });

    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('jeeva-cloud-url-updated', onCloudUrlEvent);
      window.removeEventListener('jeeva-ai-name-updated', onAiNameEvent);
      unsubDeep?.();
      unsubSched?.();
    };
  }, [updateCloudApiUrl]);

  // Capture browser PWA install prompt (Chrome / Edge / Android)
  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      toast.success('JEEVA AI App installed!');
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Check Render Cloud AI / proxy config (works both on Browser/PWA and on Desktop .exe via cloudApiUrl)
  useEffect(() => {
    const isDesktop = Boolean(window.electronAPI);
    if (isDesktop && !cloudApiUrl) {
      setServerConfig((prev) => ({ ...prev, checked: true, serverManagedKey: false }));
      return;
    }
    const base = isDesktop ? cloudApiUrl : '';
    const savedToken = localStorage.getItem('jeeva_app_token') || '';
    fetch(`${base}/api/config`, {
      headers: getAuthHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return null;
        return res.json();
      })
      .then((cfg) => {
        if (cfg && typeof cfg.serverManagedKey === 'boolean') {
          setServerConfig({ checked: true, ...cfg });
          if (cfg.requiresPin && !cfg.authorized && savedToken) {
            localStorage.removeItem('jeeva_app_token');
            setAppToken('');
          }
          if (!isDesktop) refreshRenderRelayDevices();
        } else {
          setServerConfig((prev) => ({ ...prev, checked: true }));
        }
      })
      .catch(() => {
        setServerConfig((prev) => ({ ...prev, checked: true }));
      });
  }, [cloudApiUrl]);

  // Load API key from OS-encrypted safeStorage vault on Electron startup
  useEffect(() => {
    if (!window.electronAPI?.vaultGetKey) return;
    window.electronAPI.vaultGetKey().then((vaultKey) => {
      if (vaultKey) {
        setApiKey(vaultKey);
      } else if (apiKey) {
        window.electronAPI.vaultSaveKey?.(apiKey);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (apiKey) {
      try {
        initGemini(apiKey);
        localStorage.setItem('jeeva_api_key', apiKey);
        window.electronAPI?.vaultSaveKey?.(apiKey);
        setIsReady(true);
      } catch (err) {
        console.error('Failed to init Gemini:', err);
        setIsReady(false);
      }
      return;
    }

    localStorage.removeItem('jeeva_api_key');

    if (
      serverConfig.serverManagedKey &&
      (!serverConfig.requiresPin || serverConfig.authorized)
    ) {
      try {
        initGemini('server-proxy', {
          useServerProxy: true,
          proxyBaseUrl: window.electronAPI ? cloudApiUrl : undefined,
          appToken,
        });
        setIsReady(true);
      } catch (err) {
        console.error('Failed to init Gemini proxy:', err);
        setIsReady(false);
      }
    } else {
      setIsReady(false);
    }
  }, [apiKey, serverConfig, appToken, cloudApiUrl]);

  const unlockOwnerKey = useCallback(async (pinValue) => {
    const base = window.electronAPI ? cloudApiUrl : '';
    const res = await fetch(`${base}/api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: String(pinValue || '').trim() }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Invalid PIN');
    }
    localStorage.setItem('jeeva_app_token', data.token);
    setAppToken(data.token);
    setServerConfig((prev) => ({ ...prev, authorized: true }));
    if (!window.electronAPI) refreshRenderRelayDevices();
  }, [cloudApiUrl]);

  const handleUnlockApp = async (e) => {
    e.preventDefault();
    if (!pinEntry.trim()) return;
    setPinError('');
    setUnlocking(true);
    try {
      await unlockOwnerKey(pinEntry.trim());
      setPinEntry('');
    } catch (err) {
      setPinError(err.message || 'Unlock failed');
    } finally {
      setUnlocking(false);
    }
  };

  const handleInstallPWA = useCallback(async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice?.outcome === 'accepted') {
      setInstallPrompt(null);
    }
  }, [installPrompt]);

  useEffect(() => {
    setGeminiModel(model);
    localStorage.setItem('jeeva_model', model);
  }, [model]);

  useEffect(() => {
    setGeminiInstructions(customInstructions);
    localStorage.setItem('jeeva_custom_instructions', customInstructions);
  }, [customInstructions]);

  useEffect(() => {
    localStorage.setItem('jeeva_conversations', JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    localStorage.setItem('jeeva_tts', ttsEnabled.toString());
  }, [ttsEnabled]);

  useEffect(() => {
    setSpeechVoiceMode(voiceMode);
  }, [voiceMode]);

  const openPcControlCenter = useCallback((tab = 'clipboard') => {
    setPcControlTab(tab);
    setShowPcControl(true);
  }, []);

  const {
    liveStats,
    watchdogAlert,
    dismissWatchdogAlert,
    applyWatchdogFix,
  } = useWatchdogAndStats({
    isElectron: Boolean(window.electronAPI),
    onOpenControlTab: openPcControlCenter,
  });

  // Listen for Electron window mode changes, Alt+Space hotkey wake & tray PC Control triggers
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const unsubMode = api.onWindowModeChange?.((mode) => setWindowMode(mode));
    const unsubWake = api.onHotkeyWake?.(() => {
      setWindowMode('cortana');
      setAutoListenSignal((n) => n + 1);
    });
    const unsubPcControl = api.onOpenPcControl?.((tab) => {
      if (tab) setPcControlTab(tab);
      setShowPcControl(true);
    });
    return () => {
      unsubMode?.();
      unsubWake?.();
      unsubPcControl?.();
    };
  }, []);

  const switchWindowMode = useCallback((mode) => {
    setWindowMode(mode);
    window.electronAPI?.setWindowMode?.(mode);
    if (mode === 'cortana') {
      setAutoListenSignal((n) => n + 1);
    }
  }, []);

  const handleNewChat = useCallback(() => {
    if (messages.length > 0) {
      const firstUserMsg = messages.find((m) => m.role === 'user');
      const conv = {
        id: Date.now(),
        title: firstUserMsg?.aiTitle || messages[0]?.text?.substring(0, 44) || 'New Thread',
        messages,
        date: new Date().toLocaleDateString('en-IN'),
      };
      setConversations(prev => [conv, ...prev].slice(0, 50));
    }
    setMessages([]);
    resetConversation();
  }, [messages]);

  // Global keyboard shortcuts (Ctrl+K, Ctrl+N, Ctrl+,, Ctrl+Shift+M)
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowPalette(p => !p);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setShowPcControl(p => !p);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleNewChat();
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setShowSettings(s => !s);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleNewChat]);

  const handlePermissionDecision = useCallback((decision) => {
    const permId = activePermIdRef.current;
    activePermIdRef.current = null;
    permissionCleanupRef.current?.();
    permissionCleanupRef.current = null;
    stopSpeech();
    setPermissionRequest(null);

    if (permId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === permId && m.permissionPrompt
            ? {
                ...m,
                permissionPrompt: {
                  ...m.permissionPrompt,
                  status: decision === 'deny' ? 'denied' : 'allowed',
                },
              }
            : m
        )
      );
    }

    if (permissionResolverRef.current) {
      const resolve = permissionResolverRef.current;
      permissionResolverRef.current = null;
      resolve(decision);
    }
  }, []);

  const requestPermission = useCallback((req) => {
    // Expand tiny corner pill before displaying PermissionModal so buttons are never clipped
    setWindowMode((prevMode) => {
      if (prevMode === 'speaker') {
        window.electronAPI?.setWindowMode?.('cortana');
        return 'cortana';
      }
      return prevMode;
    });

    const isVoice = Boolean(req.fromVoice || activeVoiceTurnRef.current);
    const voiceBlockedByMismatch = Boolean(isVoice && voiceprintMismatchRef.current && req.riskLevel === 'high');
    const userLang = req.userLang || detectCommandLanguage(req.userPrompt || lastUserPromptRef.current || '');
    const questionText = voiceBlockedByMismatch
      ? userLang === 'english'
        ? `Voiceprint did not match registered owner. Click Allow manually for: ${req.summary}`
        : `Aapki aawaz registered voiceprint se match nahi hui — manual Allow button dabayein: ${req.summary}`
      : buildLocalizedPermissionQuestion(req, userLang);
    const permId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    permissionCleanupRef.current?.();
    activePermIdRef.current = permId;

    setMessages((prev) => [
      ...prev,
      {
        id: permId,
        role: 'assistant',
        text: '',
        permissionPrompt: {
          id: permId,
          questionText,
          summary: req.summary,
          riskLevel: req.riskLevel,
          fromVoice: isVoice,
          status: 'pending',
        },
      },
    ]);

    return new Promise((resolve) => {
      permissionResolverRef.current = resolve;
      setPermissionRequest({
        ...req,
        id: permId,
        questionText,
        userLang,
        fromVoice: isVoice,
        voiceStatus: isVoice ? (voiceBlockedByMismatch ? 'waiting_click' : 'speaking') : 'idle',
        heardText: '',
      });

      if (!isVoice) return;

      if (voiceBlockedByMismatch) {
        speakText(questionText, { label: 'Voiceprint Check', forceProfile: userLang }).catch(() => {});
        return;
      }

      let cancelled = false;
      let activeCap = null;
      permissionCleanupRef.current = () => {
        cancelled = true;
        activeCap?.cancel?.();
        activeCap = null;
        window.dispatchEvent(new CustomEvent('jeeva-mic-active', { detail: false }));
      };

      (async () => {
        window.dispatchEvent(new CustomEvent('jeeva-mic-active', { detail: true }));
        try {
          await speakText(questionText, { label: 'Confirm Action', forceProfile: userLang });
          if (cancelled || permissionResolverRef.current !== resolve) return;

          for (let attempt = 0; attempt < 2; attempt++) {
            if (cancelled || permissionResolverRef.current !== resolve) return;
            setPermissionRequest((cur) =>
              cur && cur.id === permId ? { ...cur, voiceStatus: 'listening', heardText: '' } : cur
            );
            playWakeChime();
            await new Promise((r) => setTimeout(r, 150));
            if (cancelled || permissionResolverRef.current !== resolve) return;

            const heard = await new Promise((resVoice) => {
              activeCap = startVoiceCapture({
                lang: userLang === 'english' ? 'en-IN' : 'hi-IN',
                autoStopOnSilence: true,
                silenceMs: 900,
                onResult: (txt) => {
                  activeCap = null;
                  resVoice(txt || '');
                },
                onError: () => {
                  activeCap = null;
                  resVoice('');
                },
              });
            });

            if (cancelled || permissionResolverRef.current !== resolve) return;
            if (heard) {
              setPermissionRequest((cur) =>
                cur && cur.id === permId ? { ...cur, heardText: heard } : cur
              );
            }

            const verdict = parseVoiceConfirmation(heard);
            if (verdict === 'yes') {
              handlePermissionDecision('once');
              return;
            }
            if (verdict === 'no') {
              handlePermissionDecision('deny');
              return;
            }
            if (attempt === 0) {
              setPermissionRequest((cur) =>
                cur && cur.id === permId ? { ...cur, voiceStatus: 'speaking' } : cur
              );
              const retryAsk =
                userLang === 'english'
                  ? 'Please say yes to allow or no to cancel.'
                  : userLang === 'hindi'
                    ? 'कृपया हाँ या नहीं कहें।'
                    : 'Samajh nahi aaya. Haan ya Nahi bolein.';
              await speakText(retryAsk, { label: 'Confirm Action', forceProfile: userLang });
            }
          }

          if (!cancelled && permissionResolverRef.current === resolve) {
            setPermissionRequest((cur) =>
              cur && cur.id === permId ? { ...cur, voiceStatus: 'waiting_click' } : cur
            );
            window.dispatchEvent(new CustomEvent('jeeva-mic-active', { detail: false }));
          }
        } catch {
          window.dispatchEvent(new CustomEvent('jeeva-mic-active', { detail: false }));
        }
      })();
    });
  }, [handlePermissionDecision]);

  useEffect(() => {
    const onBrainModeEvent = (ev) => {
      if (ev?.detail) setBrainModeState(ev.detail);
    };
    window.addEventListener('jeeva-brain-mode-changed', onBrainModeEvent);
    return () => window.removeEventListener('jeeva-brain-mode-changed', onBrainModeEvent);
  }, []);

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
      if (shouldSpeak && replyText) {
        speakText(replyText, { label: speakLabel, instant: tier !== 'cloud' });
      }
    };

    try {
      // Tier-0 & Tier-1: Zero-API Deterministic + Episodic Date + Semantic Intent Local Brain
      if (!forceCloud && !routing.forceCloud && !attachment) {
        const quick = await runLocalQuickBrain(promptText, { requestPermission });
        if (quick?.handled) {
          finalizeReply({
            replyText: quick.replyText || 'Done.',
            tier: quick.tier || 'fast',
            modelLabel: quick.modelLabel || 'Instant Local',
            routeReason: quick.routeReason || routing.routeReason,
            image: quick.image || null,
            tools: quick.tools || [],
            speakLabel: 'Local Brain',
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
            speakLabel: 'Local SLM',
          });
          return;
        }
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
      try {
        const response = await sendMessage(
          promptText,
          attachment,
          (streamedText) => {
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

        finalizeReply({
          replyText: finalAssistantText,
          tier: 'cloud',
          modelLabel: routing.heavyReason ? `Gemini Cloud (${routing.heavyReason.replace(/_/g, ' ')})` : 'Gemini Cloud',
          routeReason: routing.routeReason,
          image: response.image || null,
          tools: response.tools || [],
          shouldSpeak: Boolean(response.autoSpeak || ttsEnabled || meta?.fromVoice),
          speakLabel: attachment?.isDocument ? `Reading: ${attachment.name}` : 'Reading response...',
        });
      } catch (cloudErr) {
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
      if (
        !apiKey &&
        serverConfig.serverManagedKey &&
        serverConfig.requiresPin &&
        /401|Workspace locked|Access PIN/i.test(err?.message || '')
      ) {
        localStorage.removeItem('jeeva_app_token');
        setAppToken('');
        setServerConfig(prev => ({ ...prev, authorized: false }));
      }
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
  }, [isReady, brainMode, liveStats, ttsEnabled, requestPermission, apiKey, serverConfig.serverManagedKey, serverConfig.requiresPin, switchWindowMode, messages]);

  // Persistent Always-On Wake Word & Mic Engine:
  // - On Electron Desktop: active 24/7 across Full, Minimized, Tray, Speaker & Cortana modes once API/Cloud is ready
  // - On Web/Mobile: only listens inside /app Voice modes (never triggers unprompted mic popup on Landing Page)
  const isLockedScreen =
    serverConfig.checked &&
    serverConfig.requiresFullLock &&
    serverConfig.requiresPin &&
    !serverConfig.authorized &&
    !apiKey;
  const voiceEngine = useVoiceEngine({
    aiName,
    onSend: handleSend,
    isLoading,
    autoListenSignal,
    requestPermission,
    enabled: Boolean(
      !isLockedScreen &&
      ((window.electronAPI && (isReady || brainMode !== 'cloud')) ||
        (isReady && routeView === 'app' && windowMode !== 'full'))
    ),
    onWakeOpen: (mode) => setWindowMode(mode),
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

  if (!window.electronAPI && routeView === 'landing') {
    return (
      <>
        <Suspense fallback={<div className="min-h-screen bg-obsidian-bg" />}>
          <LandingPage
            installerUrl={serverConfig.installerUrl}
            canInstallPWA={Boolean(installPrompt)}
            onInstallPWA={handleInstallPWA}
            onEnterWorkspace={navigateToApp}
          />
        </Suspense>
        <ToastContainer />
      </>
    );
  }

  const isServerLocked =
    serverConfig.checked &&
    serverConfig.requiresFullLock &&
    serverConfig.requiresPin &&
    !serverConfig.authorized &&
    !apiKey;

  if (isServerLocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-obsidian-bg text-obsidian-text p-4">
        <div className="w-full max-w-sm bg-obsidian-surface border border-obsidian-border rounded-2xl p-6 shadow-2xl">
          <div className="w-11 h-11 rounded-xl bg-obsidian-bg border border-obsidian-border flex items-center justify-center mb-4">
            <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 className="text-base font-semibold text-obsidian-text">JEEVA AI Workspace</h1>
          <p className="text-xs text-obsidian-muted mt-1 mb-5">
            Enter your Access PIN to unlock your Render-hosted AI workspace.
          </p>
          <form onSubmit={handleUnlockApp} className="space-y-3">
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pinEntry}
              onChange={(e) => setPinEntry(e.target.value)}
              placeholder="Enter Access PIN..."
              className="w-full bg-obsidian-bg border border-obsidian-border rounded-xl px-3.5 py-2.5 text-sm font-mono tracking-widest text-obsidian-text placeholder:text-obsidian-muted placeholder:tracking-normal focus:outline-none focus:border-zinc-500"
            />
            {pinError && <p className="text-xs text-red-400">{pinError}</p>}
            <button
              type="submit"
              disabled={unlocking || !pinEntry.trim()}
              className="w-full py-2.5 rounded-xl bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-white transition-colors disabled:opacity-40"
            >
              {unlocking ? 'Verifying...' : 'Unlock Workspace'}
            </button>
          </form>
        </div>
      </div>
    );
  }

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
          onOpenMobileModal={() => setShowMobileModal(true)}
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
              canInstallPWA={Boolean(installPrompt)}
              onInstallPWA={handleInstallPWA}
              onOpenWizard={() => setShowWizard(true)}
              serverConfig={serverConfig}
              onUnlockOwner={unlockOwnerKey}
              onClose={() => setShowSettings(false)}
            />
          )}

          {showMobileModal && (
            <MobileConnectModal isOpen={showMobileModal} onClose={() => setShowMobileModal(false)} />
          )}
          {showWizard && window.electronAPI && (
            <OnboardingWizard
              initialApiKey={apiKey}
              initialCloudUrl={cloudApiUrl}
              onSaveApiKey={setApiKey}
              onSaveCloudUrl={updateCloudApiUrl}
              onUnlockOwner={unlockOwnerKey}
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
        onOpenMobileModal={() => setShowMobileModal(true)}
        onOpenPcControl={openPcControlCenter}
        onSwitchCortana={() => switchWindowMode('cortana')}
        onSwitchSpeaker={() => switchWindowMode('speaker')}
        wakeEnabled={voiceEngine.wakeEnabled}
        orbState={voiceEngine.orbState}
        onToggleWake={voiceEngine.toggleWake}
        canInstallPWA={Boolean(installPrompt)}
        onInstallPWA={handleInstallPWA}
        model={model}
        onModelChange={setModel}
        liveStats={liveStats}
      />

      <div className="flex flex-1 overflow-hidden">
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

        <main className="flex-1 flex flex-col min-w-0 bg-obsidian-bg">
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
            canInstallPWA={Boolean(installPrompt)}
            onInstallPWA={handleInstallPWA}
            onOpenWizard={() => setShowWizard(true)}
            serverConfig={serverConfig}
            onUnlockOwner={unlockOwnerKey}
            onClose={() => setShowSettings(false)}
          />
        )}

        {showMobileModal && (
          <MobileConnectModal isOpen={showMobileModal} onClose={() => setShowMobileModal(false)} />
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
            initialCloudUrl={cloudApiUrl}
            onSaveApiKey={setApiKey}
            onSaveCloudUrl={updateCloudApiUrl}
            onUnlockOwner={unlockOwnerKey}
            onComplete={() => setShowWizard(false)}
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
