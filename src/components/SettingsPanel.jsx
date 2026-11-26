import { useState, useEffect } from 'react';
import {
  LuX,
  LuKey,
  LuEye,
  LuEyeOff,
  LuCheck,
  LuTrash2,
  LuDownload,
  LuShieldCheck,
  LuVolume2,
  LuRefreshCw,
  LuMic,
  LuCpu,
} from 'react-icons/lu';
import { clearSessionPermissions, isUsingServerProxy, testGeminiConnection } from '../services/gemini';
import { getBrainMode, setBrainMode, getBrainStats, resetBrainStats } from '../services/brainRouter';
import {
  speakText,
  getVoiceAccent,
  setVoiceAccent,
  getPreferredNativeVoice,
  setPreferredNativeVoice,
  getAvailableSpeechVoices,
  getSpeechSpeedMode,
  setSpeechSpeedMode,
} from '../services/speech';
import { startVoiceCapture } from '../services/voiceCapture';
import {
  getVoiceprintStatus,
  enrollVoiceprintSamples,
  clearVoiceprint,
  setVoiceprintGuardEnabled,
} from '../services/speakerVerify';
import {
  getAiName,
  setAiName,
  getStrictVoiceMode,
  setStrictVoiceMode,
  getWakeWordEnabled,
  setWakeWordEnabled,
  getWakeOpenMode,
  setWakeOpenMode,
} from '../services/voiceRouter';
import {
  PERMISSION_CATEGORIES,
  getPermissionRules,
  savePermissionRules,
  getAuditLog,
  clearAuditLog,
} from '../services/permissions';
import { toast } from '../services/toast';

export default function SettingsPanel({
  apiKey,
  onApiKeyChange,
  ttsEnabled,
  onToggleTTS,
  voiceMode,
  onVoiceModeChange,
  model,
  onModelChange,
  customInstructions,
  onCustomInstructionsChange,
  onExportChat,
  onClearHistory,
  canInstallPWA,
  onInstallPWA,
  onOpenWizard,
  serverConfig,
  onUnlockOwner,
  onClose,
}) {
  const isElectron = Boolean(window.electronAPI);
  const [activeTab, setActiveTab] = useState('assistant'); // 'assistant' | 'permissions' | 'audit'
  const [ownerPin, setOwnerPin] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [key, setKey] = useState(apiKey);
  const [cloudUrl, setCloudUrl] = useState(() => localStorage.getItem('jeeva_cloud_api_url') || '');
  const [assistantName, setAssistantName] = useState(() => getAiName());
  const [wakeWordOn, setWakeWordOn] = useState(() => getWakeWordEnabled());
  const [wakeOpenMode, setWakeOpenModeState] = useState(() => getWakeOpenMode());
  const [strictVoice, setStrictVoice] = useState(() => getStrictVoiceMode());
  const [showKey, setShowKey] = useState(false);
  const [instructions, setInstructions] = useState(customInstructions || '');
  const [saved, setSaved] = useState(false);
  const [permsCleared, setPermsCleared] = useState(false);

  const [permRules, setPermRules] = useState(() => getPermissionRules());
  const [auditEntries, setAuditEntries] = useState(() => getAuditLog());
  const [hostAuditEntries, setHostAuditEntries] = useState([]);
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [connStatus, setConnStatus] = useState(null);
  const [updateRepo, setUpdateRepo] = useState(() => {
    const savedRepo = localStorage.getItem('jeeva_update_repo');
    return savedRepo !== null ? savedRepo : 'rishusaw0/bob';
  });
  const [updaterState, setUpdaterState] = useState(null);
  const [voiceprintStatus, setVoiceprintStatus] = useState(() => getVoiceprintStatus());
  const [enrollingVoice, setEnrollingVoice] = useState(false);
  const [brainMode, setBrainModeState] = useState(() => getBrainMode());
  const [brainStats, setBrainStats] = useState(() => getBrainStats());
  const [localBrain, setLocalBrain] = useState(null);
  const [brainProgress, setBrainProgress] = useState(null);
  const [brainBusy, setBrainBusy] = useState(false);
  const [voiceAccent, setVoiceAccentState] = useState(() => getVoiceAccent());
  const [nativeVoice, setNativeVoiceState] = useState(() => getPreferredNativeVoice());
  const [availableVoices, setAvailableVoices] = useState(() => getAvailableSpeechVoices());
  const [speechSpeedMode, setSpeechSpeedModeState] = useState(() => getSpeechSpeedMode());

  useEffect(() => {
    const refresh = () => setAvailableVoices(getAvailableSpeechVoices());
    refresh();
    const t = setTimeout(refresh, 400);
    return () => clearTimeout(t);
  }, []);

  const handleEnrollVoiceprint = async () => {
    if (enrollingVoice) return;
    setEnrollingVoice(true);
    try {
      const samples = [];
      for (let i = 0; i < 2; i++) {
        toast.info(`Voiceprint Sample ${i + 1}/2: Boliye "Hey ${assistantName || 'Jeeva'}, confirm my voice"`);
        const pcm = await new Promise((resolve, reject) => {
          let settled = false;
          const cap = startVoiceCapture({
            skipStt: true,
            autoStopOnSilence: true,
            silenceMs: 750,
            onResult: (_, info) => {
              if (settled) return;
              settled = true;
              resolve(info?.pcm16k || null);
            },
            onError: (e) => {
              if (settled) return;
              settled = true;
              reject(new Error(e || 'Mic capture failed'));
            },
          });
          setTimeout(() => {
            if (!settled) cap.stop();
          }, 3400);
        });
        if (pcm && pcm.length >= 2400) samples.push(pcm);
      }
      enrollVoiceprintSamples(samples);
      setVoiceprintGuardEnabled(true);
      setVoiceprintStatus(getVoiceprintStatus());
      toast.success('Speaker voiceprint enrolled & protection enabled!');
    } catch (err) {
      toast.error(err?.message || 'Could not enroll voiceprint');
    } finally {
      setEnrollingVoice(false);
    }
  };

  useEffect(() => {
    if (isElectron) {
      window.electronAPI?.getPermissionRules?.().then((hostRules) => {
        if (hostRules) setPermRules(savePermissionRules(hostRules));
      }).catch(() => {});
      window.electronAPI?.getAutoLaunch?.().then((v) => setAutoLaunch(Boolean(v))).catch(() => {});
      window.electronAPI?.localBrainStatus?.().then(setLocalBrain).catch(() => {});
      window.electronAPI?.getUpdaterState?.().then(setUpdaterState).catch(() => {});
      const unsubUp = window.electronAPI?.onUpdaterStatus?.(setUpdaterState);
      const unsubBrain = window.electronAPI?.onLocalBrainProgress?.((ev) => {
        setBrainProgress(ev);
        if (ev?.stage === 'done' || ev?.stage === 'installed') {
          window.electronAPI?.localBrainStatus?.().then(setLocalBrain).catch(() => {});
        }
      });
      return () => {
        unsubUp?.();
        unsubBrain?.();
      };
    }
  }, [isElectron]);

  const refreshLocalBrain = async () => {
    setBrainStats(getBrainStats());
    if (window.electronAPI?.localBrainStatus) {
      const st = await window.electronAPI.localBrainStatus().catch(() => null);
      if (st) setLocalBrain(st);
    }
  };

  const handleLocalBrainAction = async (action, payload = {}) => {
    if (!window.electronAPI?.localBrainSetup || brainBusy) return;
    setBrainBusy(true);
    try {
      const res = await window.electronAPI.localBrainSetup(action, payload);
      if (res?.ok) {
        toast.success(
          action === 'stop_model'
            ? 'Local model unloaded from RAM (0 MB idle)'
            : action === 'pull_model'
              ? `${payload?.model || 'Model'} ready!`
              : 'Local Brain updated!'
        );
      } else {
        toast.error(res?.error || 'Local Brain action failed');
      }
      await refreshLocalBrain();
    } catch (err) {
      toast.error(err?.message || 'Local Brain setup error');
    } finally {
      setBrainBusy(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConn(true);
    setConnStatus(null);
    const trimmedKey = key.trim();
    const cleanCloud = cloudUrl.trim().replace(/\/+$/, '');
    const appToken = localStorage.getItem('jeeva_app_token') || '';
    const res = await testGeminiConnection({
      apiKey: trimmedKey,
      useServerProxy: !trimmedKey && Boolean(isElectron ? cleanCloud : serverConfig?.serverManagedKey),
      proxyBaseUrl: isElectron ? cleanCloud : undefined,
      appToken,
      model,
    });
    setTestingConn(false);
    setConnStatus(res);
    if (res.ok) {
      if (res.fallbackUsed && res.activeModel) {
        onModelChange?.(res.activeModel);
        toast.info(`Auto-switched to supported model: ${res.activeModel}`);
      } else {
        toast.success(`Gemini API working (${res.activeModel}, ${res.latencyMs}ms)`);
      }
    } else {
      toast.error(res.error || 'Gemini connection failed');
    }
  };

  const handleCheckUpdates = async () => {
    if (!window.electronAPI?.checkForUpdates) return;
    const cleanRepo = updateRepo.trim();
    localStorage.setItem('jeeva_update_repo', cleanRepo);
    const cleanCloud = cloudUrl.trim().replace(/\/+$/, '');
    await window.electronAPI.checkForUpdates({
      githubRepo: cleanRepo.includes('/') ? cleanRepo : '',
      feedUrl: !cleanRepo && cleanCloud ? `${cleanCloud}/api/config` : '',
    });
  };

  useEffect(() => {
    if (activeTab === 'audit') {
      setAuditEntries(getAuditLog());
      if (isElectron) {
        window.electronAPI?.getHostAuditLog?.().then((list) => {
          if (Array.isArray(list)) setHostAuditEntries(list);
        }).catch(() => {});
      }
    }
  }, [activeTab, isElectron]);

  const handleSave = () => {
    onApiKeyChange(key.trim());
    onCustomInstructionsChange(instructions);
    savePermissionRules(permRules);
    setAiName(assistantName);
    setWakeWordEnabled(wakeWordOn);
    setStrictVoiceMode(strictVoice);
    if (isElectron) {
      const cleanCloud = cloudUrl.trim().replace(/\/+$/, '');
      if (cleanCloud) localStorage.setItem('jeeva_cloud_api_url', cleanCloud);
      else localStorage.removeItem('jeeva_cloud_api_url');
      window.dispatchEvent(new CustomEvent('jeeva-cloud-url-updated', { detail: cleanCloud }));
    }
    setSaved(true);
    toast.success('Preferences saved');
    setTimeout(() => setSaved(false), 1800);
  };

  const handleRuleChange = (catId, policy) => {
    const next = savePermissionRules({ ...permRules, [catId]: policy });
    setPermRules(next);
  };

  const handleToggleAutoLaunch = async () => {
    if (!window.electronAPI?.setAutoLaunch) return;
    try {
      const wantEnable = !autoLaunch;
      const updated = Boolean(await window.electronAPI.setAutoLaunch(wantEnable));
      setAutoLaunch(updated);
      if (wantEnable && !updated) {
        toast.error('Windows blocked auto-start registration — check Windows Startup settings');
      } else {
        toast.info(updated ? 'JEEVA will start automatically in Tray with Windows' : 'Auto-start disabled');
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to update Windows auto-start');
    }
  };

  const handleClearAudit = async () => {
    clearAuditLog();
    setAuditEntries([]);
    if (isElectron) {
      await window.electronAPI?.clearHostAuditLog?.();
      setHostAuditEntries([]);
    }
    toast.info('Activity log cleared');
  };

  const mergedAudit = isElectron && hostAuditEntries.length
    ? [...hostAuditEntries.map((e) => ({ ...e, origin: 'PC Host' })), ...auditEntries.map((e) => ({ ...e, origin: 'Assistant' }))]
    : auditEntries;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px] animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-obsidian-surface border border-obsidian-border rounded-xl w-full max-w-lg mx-4 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-obsidian-border">
          <div>
            <h2 className="text-sm font-semibold text-obsidian-text">Preferences</h2>
            <p className="text-xs text-obsidian-muted">API, voice, permissions, startup, and audit logs</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-obsidian-muted hover:text-obsidian-text hover:bg-obsidian-elevated transition-colors"
          >
            <LuX className="w-4 h-4" />
          </button>
        </div>

        {/* Section Tabs */}
        <div className="flex items-center gap-1 px-5 pt-3 border-b border-obsidian-border bg-obsidian-bg/40">
          {[
            { id: 'assistant', label: 'Assistant & Voice' },
            { id: 'permissions', label: 'Permissions & Install' },
            { id: 'audit', label: 'Activity Log' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-emerald-400 text-obsidian-text'
                  : 'border-transparent text-obsidian-muted hover:text-obsidian-secondary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 max-h-[68vh] overflow-y-auto">
          {activeTab === 'assistant' && (
            <>
              {/* API Key */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-obsidian-text mb-1.5">
                  <LuKey className="w-3.5 h-3.5 text-obsidian-muted" />
                  Gemini API Key
                </label>
                {isUsingServerProxy() && (
                  <div className="mb-2 px-2.5 py-2 rounded-lg bg-emerald-950/30 border border-emerald-800/50 text-[11px] text-emerald-300">
                    Server-protected Render key is active. Leave blank to keep using it, or enter a personal override key.
                  </div>
                )}
                <p className="text-[11px] text-obsidian-muted mb-2">
                  Free tier key from{' '}
                  <a
                    href="https://aistudio.google.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-obsidian-secondary underline"
                  >
                    aistudio.google.com
                  </a>
                </p>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="Paste your Gemini API key..."
                    className="w-full bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-2 pr-9 text-xs font-mono text-obsidian-text placeholder:text-obsidian-muted focus:outline-none focus:border-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-obsidian-muted hover:text-obsidian-text"
                  >
                    {showKey ? <LuEyeOff className="w-3.5 h-3.5" /> : <LuEye className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={testingConn}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-obsidian-bg hover:bg-obsidian-elevated border border-obsidian-border text-[11px] font-medium text-obsidian-text disabled:opacity-50"
                  >
                    <LuRefreshCw className={`w-3 h-3 ${testingConn ? 'animate-spin' : ''}`} />
                    {testingConn ? 'Testing Gemini...' : 'Test Connection'}
                  </button>
                  {connStatus && (
                    <span
                      className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                        connStatus.ok
                          ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300'
                          : 'bg-red-950/40 border-red-800/50 text-red-300'
                      }`}
                    >
                      {connStatus.ok
                        ? `OK: ${connStatus.activeModel} (${connStatus.latencyMs}ms)`
                        : connStatus.error?.slice(0, 65)}
                    </span>
                  )}
                </div>

                {!isElectron && serverConfig?.serverManagedKey && serverConfig?.requiresPin && !serverConfig?.authorized && onUnlockOwner && (
                  <div className="mt-2.5 p-2.5 rounded-lg bg-obsidian-bg border border-obsidian-border space-y-1.5">
                    <p className="text-[11px] text-obsidian-secondary">
                      Host Owner? Unlock server-hosted Gemini key with Admin PIN:
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        value={ownerPin}
                        onChange={(e) => setOwnerPin(e.target.value)}
                        placeholder="Owner Access PIN..."
                        className="flex-1 bg-obsidian-surface border border-obsidian-border rounded px-2.5 py-1 text-xs font-mono text-obsidian-text"
                      />
                      <button
                        type="button"
                        disabled={unlockBusy || !ownerPin.trim()}
                        onClick={async () => {
                          setUnlockBusy(true);
                          try {
                            await onUnlockOwner(ownerPin.trim());
                            setOwnerPin('');
                            toast.success('Owner server key unlocked!');
                          } catch (err) {
                            toast.error(err?.message || 'Invalid PIN');
                          } finally {
                            setUnlockBusy(false);
                          }
                        }}
                        className="px-2.5 py-1 rounded bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-white disabled:opacity-40"
                      >
                        {unlockBusy ? '...' : 'Unlock'}
                      </button>
                    </div>
                  </div>
                )}

                {isElectron && (
                  <div className="mt-3">
                    <label className="block text-[11px] font-medium text-obsidian-secondary mb-1">
                      Or Cloud AI Server URL (No Personal API Key Needed)
                    </label>
                    <input
                      type="url"
                      value={cloudUrl}
                      onChange={(e) => setCloudUrl(e.target.value)}
                      placeholder="https://your-app.onrender.com"
                      className="w-full bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-1.5 text-xs font-mono text-obsidian-text placeholder:text-obsidian-muted focus:outline-none focus:border-zinc-600"
                    />
                  </div>
                )}
              </div>

              {/* Model */}
              <div>
                <label className="block text-xs font-medium text-obsidian-text mb-1.5">
                  Default Model
                </label>
                <select
                  value={model}
                  onChange={(e) => onModelChange(e.target.value)}
                  className="w-full bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-2 text-xs text-obsidian-text focus:outline-none focus:border-zinc-600"
                >
                  <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite — Lowest Latency</option>
                  <option value="gemini-4-hydrogen">Gemini 4 Hydrogen — Balanced Reasoning</option>
                  <option value="gemini-4-neon">Gemini 4 Neon — Complex Multi-Step</option>
                </select>
              </div>

              {/* Custom Instructions */}
              <div>
                <label className="block text-xs font-medium text-obsidian-text mb-1.5">
                  Custom System Instructions
                </label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={3}
                  placeholder="e.g., Always respond in Hindi, keep code examples concise, save notes to Desktop..."
                  className="w-full bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-2 text-xs text-obsidian-text placeholder:text-obsidian-muted focus:outline-none focus:border-zinc-600 resize-none"
                />
              </div>

              {/* Custom Wake Name & Voice Discipline */}
              <div className="p-3.5 rounded-xl bg-obsidian-bg border border-obsidian-border space-y-3">
                <div>
                  <label className="block text-xs font-medium text-obsidian-text mb-1">
                    Custom AI Wake Name (Boliye &quot;Hey {assistantName || 'Jeeva'}&quot;)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={24}
                      value={assistantName}
                      onChange={(e) => setAssistantName(e.target.value)}
                      placeholder="Jeeva"
                      className="flex-1 bg-obsidian-surface border border-obsidian-border rounded-lg px-3 py-1.5 text-xs font-medium text-obsidian-text focus:outline-none focus:border-zinc-500"
                    />
                    <div className="flex items-center gap-1">
                      {['Jeeva', 'Jarvis', 'Friday', 'Max'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setAssistantName(preset)}
                          className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
                            assistantName.toLowerCase() === preset.toLowerCase()
                              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                              : 'bg-obsidian-surface border-obsidian-border text-obsidian-muted hover:text-obsidian-text'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-obsidian-border/60">
                  <div>
                    <p className="text-xs font-medium text-obsidian-text">Always-On Wake Word</p>
                    <p className="text-[10px] text-obsidian-muted">
                      Listen passively for &quot;Hey {assistantName || 'Jeeva'}&quot; in Voice &amp; Speaker mode
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWakeWordOn((v) => !v)}
                    className={`w-10 h-5 rounded-full transition-colors p-0.5 ${
                      wakeWordOn ? 'bg-emerald-500' : 'bg-zinc-700'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-transform ${
                        wakeWordOn ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-obsidian-border/60 gap-3">
                  <div>
                    <p className="text-xs font-medium text-obsidian-text">When Woken by Voice Open</p>
                    <p className="text-[10px] text-obsidian-muted">
                      Minimized/tray se &quot;Hey {assistantName || 'Jeeva'}&quot; bolne par kya khulega
                    </p>
                  </div>
                  <select
                    value={wakeOpenMode}
                    onChange={(e) => {
                      const val = e.target.value;
                      setWakeOpenModeState(val);
                      setWakeOpenMode(val);
                    }}
                    className="bg-obsidian-surface border border-obsidian-border rounded-md px-2 py-1 text-[11px] text-obsidian-text focus:outline-none"
                  >
                    <option value="cortana">Voice Panel (Overlay)</option>
                    <option value="full">Full Workstation Window</option>
                    <option value="speaker">Mini Speaker Pill</option>
                  </select>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-obsidian-border/60">
                  <div>
                    <p className="text-xs font-medium text-obsidian-text">Direct Voice Execution (No Fluff)</p>
                    <p className="text-[10px] text-obsidian-muted">
                      Sirf kaam aur short clear jawab, bina faltu commentary ke
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStrictVoice((v) => !v)}
                    className={`w-10 h-5 rounded-full transition-colors p-0.5 ${
                      strictVoice ? 'bg-emerald-500' : 'bg-zinc-700'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-transform ${
                        strictVoice ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Auto Voice Toggle */}
              <div className="flex items-center justify-between bg-obsidian-bg rounded-lg px-3.5 py-3 border border-obsidian-border">
                <div>
                  <p className="text-xs font-medium text-obsidian-text">Auto Voice Replies</p>
                  <p className="text-[11px] text-obsidian-muted">Speak every assistant response automatically</p>
                </div>
                <button
                  type="button"
                  onClick={onToggleTTS}
                  className={`w-10 h-5 rounded-full transition-colors p-0.5 ${
                    ttsEnabled ? 'bg-emerald-500' : 'bg-zinc-700'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform ${
                      ttsEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* 3-Voice Profile Selector + Test */}
              <div>
                <label className="block text-xs font-medium text-obsidian-text mb-1.5">
                  Voice Profile (English / Hindi / Hinglish)
                </label>
                <select
                  value={voiceMode}
                  onChange={(e) => onVoiceModeChange(e.target.value)}
                  className="w-full bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-2 text-xs text-obsidian-text focus:outline-none focus:border-zinc-600 mb-2"
                >
                  <option value="auto">Auto Detect (Switches automatically per language)</option>
                  <option value="english">English — Clear Studio Narrator</option>
                  <option value="hindi">Hindi — Warm Native Speaker</option>
                  <option value="hinglish">Hinglish — Fluent Indian Bilingual Speaker</option>
                </select>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => speakText('Hello! I am Jeeva, ready to assist you on your computer.', { forceProfile: 'english', label: 'Testing English Voice' })}
                    className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-obsidian-bg border border-obsidian-border text-[11px] text-obsidian-secondary hover:text-obsidian-text transition-colors"
                  >
                    <LuVolume2 className="w-3 h-3" />
                    Test English
                  </button>
                  <button
                    type="button"
                    onClick={() => speakText('नमस्ते! मैं जीवा हूँ, आपके कंप्यूटर पर आपकी मदद के लिए तैयार हूँ।', { forceProfile: 'hindi', label: 'Testing Hindi Voice' })}
                    className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-obsidian-bg border border-obsidian-border text-[11px] text-obsidian-secondary hover:text-obsidian-text transition-colors"
                  >
                    <LuVolume2 className="w-3 h-3" />
                    Test Hindi
                  </button>
                  <button
                    type="button"
                    onClick={() => speakText('Namaste! Main Jeeva hoon, aapka personal AI assistant. Bataiye aaj kya kaam karna hai?', { forceProfile: 'hinglish', label: 'Testing Hinglish Voice' })}
                    className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-obsidian-bg border border-obsidian-border text-[11px] text-obsidian-secondary hover:text-obsidian-text transition-colors"
                  >
                    <LuVolume2 className="w-3 h-3" />
                    Test Hinglish
                  </button>
                </div>
              </div>

              {/* Workspace Maintenance */}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={onExportChat}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-obsidian-bg border border-obsidian-border text-xs text-obsidian-secondary hover:text-obsidian-text transition-colors"
                >
                  <LuDownload className="w-3.5 h-3.5" />
                  Export Thread (.md)
                </button>

                <button
                  type="button"
                  onClick={onClearHistory}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-obsidian-bg border border-obsidian-border text-xs text-red-400 hover:bg-red-950/40 transition-colors"
                >
                  <LuTrash2 className="w-3.5 h-3.5" />
                  Clear History
                </button>
              </div>
            </>
          )}

          {activeTab === 'permissions' && (
            <div className="space-y-4">
              {isElectron ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between bg-obsidian-bg rounded-lg px-3.5 py-3 border border-obsidian-border">
                    <div>
                      <p className="text-xs font-medium text-obsidian-text">Start with Windows (Background Tray)</p>
                      <p className="text-[11px] text-obsidian-muted">Keeps Render Cloud Relay ready automatically after PC boot</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoLaunch}
                      aria-label="Start with Windows"
                      onClick={handleToggleAutoLaunch}
                      className={`w-10 h-5 rounded-full transition-colors p-0.5 cursor-pointer ${
                        autoLaunch ? 'bg-emerald-500' : 'bg-zinc-700'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full bg-white transition-transform ${
                          autoLaunch ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Low-End Friendly Local AI Brain */}
                  <div className="bg-obsidian-bg rounded-lg px-3.5 py-3 border border-obsidian-border space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-obsidian-text flex items-center gap-1.5">
                          <LuCpu className="w-3.5 h-3.5 text-emerald-400" />
                          Hybrid Local AI Brain (Low-End Friendly)
                        </p>
                        <p className="text-[10px] text-obsidian-muted mt-0.5">
                          Chhote/moderate kaam local brain se · Sirf heavy/vision/web kaam par Gemini API
                        </p>
                      </div>
                      <select
                        value={brainMode}
                        onChange={(e) => setBrainModeState(setBrainMode(e.target.value))}
                        className="bg-obsidian-surface border border-obsidian-border rounded px-2 py-1 text-[11px] font-mono text-obsidian-text"
                      >
                        <option value="auto">Auto Hybrid</option>
                        <option value="offline">Offline Only (0 API)</option>
                        <option value="cloud">Gemini Cloud</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded bg-obsidian-surface border border-obsidian-border">
                      <span className="text-emerald-300 font-mono">
                        {brainStats.localPct}% Local ({brainStats.totalLocal} saved · {brainStats.cloudCalls} cloud)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          resetBrainStats();
                          setBrainStats(getBrainStats());
                        }}
                        className="text-obsidian-muted hover:text-obsidian-text text-[10px]"
                      >
                        Reset
                      </button>
                    </div>

                    {localBrain?.hardware && (
                      <div className="text-[10px] text-obsidian-muted space-y-1">
                        <p>
                          PC: <span className="text-obsidian-secondary font-mono">{localBrain.hardware.totalGb} GB RAM</span> ({localBrain.hardware.freeGb} GB free) · Cap: <span className="text-obsidian-secondary font-mono">{localBrain.hardware.safeThreads} CPU threads</span> · Active: <span className="text-emerald-300 font-mono">{localBrain.activeModel}</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {!localBrain.ollama?.running && (
                            <button
                              type="button"
                              disabled={brainBusy}
                              onClick={() => handleLocalBrainAction('install_ollama')}
                              className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-40"
                            >
                              {brainBusy ? 'Installing...' : '1-Click Install Ollama'}
                            </button>
                          )}
                          {(localBrain.catalog || []).map((m) => {
                            const isInstalled = localBrain.ollama?.installed?.includes(m.id);
                            return (
                              <button
                                key={m.id}
                                type="button"
                                disabled={brainBusy}
                                onClick={() =>
                                  isInstalled
                                    ? handleLocalBrainAction('save_config', { preferredModel: m.id })
                                    : handleLocalBrainAction('pull_model', { model: m.id })
                                }
                                className={`px-2 py-1 rounded border text-[10px] font-mono ${
                                  localBrain.config?.preferredModel === m.id
                                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200'
                                    : 'bg-obsidian-surface border-obsidian-border text-obsidian-secondary hover:text-obsidian-text'
                                }`}
                                title={m.description}
                              >
                                {isInstalled ? `Use ${m.id}` : `Pull ${m.id} (${m.sizeMb}MB)`}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            disabled={brainBusy}
                            onClick={() => handleLocalBrainAction('stop_model')}
                            className="px-2 py-1 rounded bg-obsidian-surface border border-obsidian-border text-obsidian-muted hover:text-obsidian-text text-[10px]"
                            title="Unload local model from RAM immediately"
                          >
                            Unload RAM
                          </button>
                        </div>
                        {brainProgress?.status && (
                          <p className="text-[10px] text-amber-300 font-mono">
                            {brainProgress.status}{brainProgress.pct != null ? ` (${brainProgress.pct}%)` : ''}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* App Auto-Updater */}
                  <div className="bg-obsidian-bg rounded-lg px-3.5 py-3 border border-obsidian-border space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-obsidian-text">App Auto-Updater</p>
                        <p className="text-[10px] text-obsidian-muted">
                          Checks GitHub Releases (owner/repo) or connected Render server feed
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCheckUpdates}
                        disabled={updaterState?.checking}
                        className="px-2.5 py-1 rounded bg-obsidian-surface hover:bg-obsidian-elevated border border-obsidian-border text-[11px] font-medium text-obsidian-text disabled:opacity-40"
                      >
                        {updaterState?.checking ? 'Checking...' : 'Check Updates'}
                      </button>
                    </div>
                    <input
                      type="text"
                      value={updateRepo}
                      onChange={(e) => setUpdateRepo(e.target.value)}
                      placeholder="GitHub repo: rishusaw0/bob (blank = use Render URL)"
                      className="w-full bg-obsidian-surface border border-obsidian-border rounded px-2.5 py-1 text-[11px] font-mono text-obsidian-text placeholder:text-obsidian-muted focus:outline-none"
                    />
                    {updaterState?.lastError && (
                      <p className="text-[10px] text-red-400">{updaterState.lastError}</p>
                    )}
                    {updaterState && !updaterState.lastError && !updaterState.checking && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className={updaterState.updateAvailable ? 'text-emerald-300 font-medium' : 'text-obsidian-muted'}>
                          {updaterState.updateAvailable
                            ? `Update ready: v${updaterState.latestVersion}`
                            : `Up to date (v${updaterState.latestVersion || '1.0.0'})`}
                        </span>
                        {updaterState.updateAvailable && (
                          <button
                            type="button"
                            disabled={updaterState.downloading}
                            onClick={() => window.electronAPI?.downloadUpdate?.()}
                            className="px-2.5 py-1 rounded bg-emerald-500 text-zinc-950 font-semibold hover:bg-emerald-400 disabled:opacity-50"
                          >
                            {updaterState.downloading ? `${updaterState.progress || 0}%...` : 'Download & Install'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {onOpenWizard && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenWizard();
                      }}
                      className="w-full py-2 rounded-lg bg-obsidian-bg hover:bg-obsidian-elevated border border-obsidian-border text-xs font-medium text-obsidian-text transition-colors"
                    >
                      Open PC Setup &amp; Permission Wizard
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-obsidian-bg rounded-lg px-3.5 py-3 border border-obsidian-border space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-obsidian-text">Install JEEVA App</p>
                      <p className="text-[11px] text-obsidian-muted">
                        Install as a standalone app on Android, Windows Edge/Chrome, or iOS Home Screen
                      </p>
                    </div>
                    {canInstallPWA && (
                      <button
                        type="button"
                        onClick={onInstallPWA}
                        className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-white flex-shrink-0"
                      >
                        Install App
                      </button>
                    )}
                  </div>
                  {!canInstallPWA && (
                    <p className="text-[11px] text-obsidian-muted">
                      Browser menu -&gt; &quot;Install JEEVA AI&quot; (or Share -&gt; Add to Home Screen on iOS). For Windows PC installer, run <code className="text-obsidian-secondary">npm run build:desktop</code> on PC to generate the <code className="text-obsidian-secondary">release/*.exe</code> installer.
                    </p>
                  )}
                </div>
              )}

              {/* Indian English Accent & Speech Clarity */}
              <div className="bg-obsidian-bg rounded-lg px-3.5 py-3 border border-obsidian-border space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-obsidian-text flex items-center gap-1.5">
                      <LuVolume2 className="w-3.5 h-3.5 text-emerald-400" />
                      English Voice Accent &amp; Clarity
                    </p>
                    <p className="text-[10px] text-obsidian-muted mt-0.5">
                      Clear Indian English (en-IN) pronunciation for both Cloud TTS and Offline speech
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      speakText(
                        'Hello! I am JEEVA AI speaking in clear Indian English. Main aapke PC ke chhote aur moderate kaam bina kisi delay ke kar sakta hoon.',
                        { label: 'Voice Clarity Test' }
                      )
                    }
                    className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 text-[11px] font-medium flex-shrink-0"
                  >
                    Test Voice
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select
                    value={voiceAccent}
                    onChange={(e) => {
                      const next = setVoiceAccent(e.target.value);
                      setVoiceAccentState(next);
                      toast.success(`English voice accent: ${next === 'indian' ? 'Indian English (en-IN)' : 'Global'}`);
                    }}
                    className="bg-obsidian-surface border border-obsidian-border rounded px-2.5 py-1.5 text-[11px] font-mono text-obsidian-text"
                  >
                    <option value="indian">Accent: Indian English (en-IN · Clear)</option>
                    <option value="global">Accent: Global Studio (en-US)</option>
                  </select>

                  <select
                    value={speechSpeedMode}
                    onChange={(e) => {
                      const next = setSpeechSpeedMode(e.target.value);
                      setSpeechSpeedModeState(next);
                      toast.success(`Speech mode: ${next}`);
                    }}
                    className="bg-obsidian-surface border border-obsidian-border rounded px-2.5 py-1.5 text-[11px] font-mono text-obsidian-text"
                  >
                    <option value="hybrid_fast">Speed: Fast Hybrid (&lt;50ms Instant)</option>
                    <option value="instant_local">Speed: Always Instant Offline</option>
                    <option value="cloud_studio">Speed: Cloud Studio First</option>
                  </select>

                  <select
                    value={nativeVoice}
                    onChange={(e) => {
                      setPreferredNativeVoice(e.target.value);
                      setNativeVoiceState(e.target.value);
                    }}
                    className="bg-obsidian-surface border border-obsidian-border rounded px-2.5 py-1.5 text-[11px] font-mono text-obsidian-text"
                  >
                    <option value="">Offline Voice: Auto Best Indian Voice</option>
                    {availableVoices.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Lightweight Acoustic Voiceprint Security */}
              <div className="bg-obsidian-bg rounded-lg px-3.5 py-3 border border-obsidian-border space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-obsidian-text flex items-center gap-1.5">
                      <LuMic className="w-3.5 h-3.5 text-emerald-400" />
                      Speaker Voiceprint Guard (Beta)
                    </p>
                    <p className="text-[10px] text-obsidian-muted mt-0.5">
                      {voiceprintStatus.enrolled
                        ? `Enrolled (${voiceprintStatus.samples} samples · Pitch ~${voiceprintStatus.pitchHz || '?'} Hz) — blocks hands-free voice approval on high-risk actions from other voices`
                        : 'Enroll your voice so sensitive voice confirmations require your voiceprint'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      disabled={enrollingVoice}
                      onClick={handleEnrollVoiceprint}
                      className="px-2.5 py-1 rounded bg-obsidian-surface hover:bg-obsidian-elevated border border-obsidian-border text-[11px] font-medium text-obsidian-text disabled:opacity-50"
                    >
                      {enrollingVoice ? 'Listening...' : voiceprintStatus.enrolled ? 'Re-Enroll' : 'Enroll Voice'}
                    </button>
                    {voiceprintStatus.enrolled && (
                      <button
                        type="button"
                        onClick={() => {
                          clearVoiceprint();
                          setVoiceprintStatus(getVoiceprintStatus());
                          toast.info('Voiceprint removed');
                        }}
                        className="px-2 py-1 rounded text-[11px] text-red-400 hover:bg-red-950/30"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
                {voiceprintStatus.enrolled && (
                  <div className="flex items-center justify-between pt-2 border-t border-obsidian-border/60">
                    <span className="text-[11px] text-obsidian-secondary">Require voiceprint match for high-risk voice actions</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={voiceprintStatus.enabled}
                      onClick={() => {
                        setVoiceprintGuardEnabled(!voiceprintStatus.enabled);
                        setVoiceprintStatus(getVoiceprintStatus());
                      }}
                      className={`w-9 h-4.5 rounded-full transition-colors p-0.5 ${
                        voiceprintStatus.enabled ? 'bg-emerald-500' : 'bg-zinc-700'
                      }`}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                          voiceprintStatus.enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-obsidian-text">
                    PC Access Scopes ({isElectron ? 'Enforced on PC Host' : 'Remote Client Policy'})
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      clearSessionPermissions();
                      setPermsCleared(true);
                      toast.info('Session permissions cleared');
                      setTimeout(() => setPermsCleared(false), 1800);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] text-obsidian-secondary hover:text-obsidian-text"
                  >
                    <LuShieldCheck className="w-3.5 h-3.5" />
                    {permsCleared ? 'Cleared' : 'Reset Session Passes'}
                  </button>
                </div>

                <div className="space-y-2">
                  {PERMISSION_CATEGORIES.map((cat) => (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between gap-3 bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-obsidian-text">{cat.label}</span>
                          <span
                            className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${
                              cat.risk === 'high'
                                ? 'bg-red-500/15 text-red-300'
                                : cat.risk === 'medium'
                                ? 'bg-amber-500/15 text-amber-300'
                                : 'bg-emerald-500/15 text-emerald-300'
                            }`}
                          >
                            {cat.risk}
                          </span>
                        </div>
                        <p className="text-[10px] text-obsidian-muted mt-0.5 leading-snug">{cat.description}</p>
                      </div>

                      <select
                        value={permRules[cat.id] || 'ask'}
                        onChange={(e) => handleRuleChange(cat.id, e.target.value)}
                        className="bg-obsidian-surface border border-obsidian-border rounded-md px-2 py-1 text-[11px] text-obsidian-text focus:outline-none flex-shrink-0"
                      >
                        <option value="ask">Ask Every Time</option>
                        <option value="always">Always Allow</option>
                        <option value="block">Block</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-obsidian-secondary">
                  Recent PC &amp; Remote Actions ({mergedAudit.length})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAuditEntries(getAuditLog());
                      if (isElectron) window.electronAPI?.getHostAuditLog?.().then(setHostAuditEntries).catch(() => {});
                    }}
                    className="inline-flex items-center gap-1 text-[11px] text-obsidian-secondary hover:text-obsidian-text"
                  >
                    <LuRefreshCw className="w-3 h-3" />
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAudit}
                    className="text-[11px] text-red-400 hover:underline"
                  >
                    Clear Log
                  </button>
                </div>
              </div>

              {mergedAudit.length === 0 ? (
                <div className="text-center py-8 text-xs text-obsidian-muted border border-dashed border-obsidian-border rounded-lg">
                  No executed tool actions recorded yet.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {mergedAudit.slice(0, 60).map((entry) => (
                    <div
                      key={entry.id}
                      className="bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-2 text-[11px]"
                    >
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="font-mono text-obsidian-secondary">
                          {entry.origin ? `[${entry.origin}] ` : ''}
                          {entry.source || 'local'} · {entry.category}
                        </span>
                        <span
                          className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                            /denied|blocked/i.test(entry.decision)
                              ? 'bg-red-500/15 text-red-300'
                              : 'bg-emerald-500/15 text-emerald-300'
                          }`}
                        >
                          {entry.decision}
                        </span>
                      </div>
                      <p className="text-obsidian-text break-words">{entry.summary || entry.tool || entry.action}</p>
                      <p className="text-[10px] text-obsidian-muted mt-0.5">{entry.timestamp}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-obsidian-border bg-obsidian-bg/50">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs text-obsidian-secondary hover:text-obsidian-text transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-medium hover:bg-white transition-colors"
          >
            {saved && <LuCheck className="w-3.5 h-3.5 text-emerald-600" />}
            {saved ? 'Saved' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
