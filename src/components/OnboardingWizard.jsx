import { useState, useEffect } from 'react';
import {
  LuKey,
  LuShieldCheck,
  LuGlobe,
  LuCheck,
  LuCopy,
  LuArrowRight,
  LuExternalLink,
  LuX,
} from 'react-icons/lu';
import {
  PERMISSION_CATEGORIES,
  getPermissionRules,
  savePermissionRules,
} from '../services/permissions';
import { testGeminiConnection } from '../services/gemini';
import { getAiName, setAiName, getWakeTriggerPhrase, setWakeTriggerPhrase } from '../services/voiceRouter';
import { getDocSummaryPref, setDocSummaryPref } from '../services/userPrefs';
import { toast } from '../services/toast';

export default function OnboardingWizard({
  initialApiKey,
  initialCloudUrl,
  onSaveApiKey,
  onSaveCloudUrl,
  onUnlockOwner,
  onComplete,
}) {
  const [step, setStep] = useState(1);
  const [assistantNameInput, setAssistantNameInput] = useState(() => getAiName());
  const [wakeTriggerInput, setWakeTriggerInput] = useState(() => getWakeTriggerPhrase());
  const [speakReplies, setSpeakReplies] = useState(() => localStorage.getItem('jeeva_tts') === 'true');
  const [docPref, setDocPref] = useState(() => getDocSummaryPref());
  const [apiKeyInput, setApiKeyInput] = useState(initialApiKey || '');
  const [cloudUrlInput, setCloudUrlInput] = useState(
    initialCloudUrl || localStorage.getItem('jeeva_last_render_url') || 'https://jeeva-ai-mjr1.onrender.com'
  );
  const [checkingCloud, setCheckingCloud] = useState(false);
  const [cloudVerified, setCloudVerified] = useState(false);
  const [cloudRequiresPin, setCloudRequiresPin] = useState(false);
  const [cloudPinInput, setCloudPinInput] = useState('');
  const [unlockingPin, setUnlockingPin] = useState(false);
  const [testingWizConn, setTestingWizConn] = useState(false);
  const [wizConnStatus, setWizConnStatus] = useState(null);

  const [permRules, setPermRules] = useState(() => getPermissionRules());
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [renderUrl, setRenderUrl] = useState(
    initialCloudUrl || localStorage.getItem('jeeva_last_render_url') || 'https://jeeva-ai-mjr1.onrender.com'
  );
  const [pairToken, setPairToken] = useState('');
  const [relayConnected, setRelayConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    window.electronAPI?.getAutoLaunch?.().then((v) => {
      if (v) {
        setAutoLaunch(true);
      } else if (window.electronAPI?.setAutoLaunch) {
        // Auto-enable Start with Windows during setup so background Camera Notch stays ready
        window.electronAPI.setAutoLaunch(true).then((ok) => setAutoLaunch(Boolean(ok))).catch(() => {});
      }
    }).catch(() => {});
    window.electronAPI?.relayStatus?.().then((s) => {
      if (s?.pairToken) setPairToken(s.pairToken);
      if (s?.renderUrl) {
        setRenderUrl(s.renderUrl);
        setCloudUrlInput(s.renderUrl);
      }
      setRelayConnected(Boolean(s?.connected));
    }).catch(() => {});
    const unsub = window.electronAPI?.onRelayStatusChange?.((s) => {
      if (s?.pairToken) setPairToken(s.pairToken);
      setRelayConnected(Boolean(s?.connected));
    });
    return () => unsub?.();
  }, []);

  const handleUseCloudAI = async () => {
    const clean = cloudUrlInput.trim().replace(/\/+$/, '');
    if (!clean) {
      toast.error('Enter the Render website URL first');
      return;
    }
    setCheckingCloud(true);
    try {
      const savedToken = localStorage.getItem('jeeva_app_token') || '';
      const res = await fetch(`${clean}/api/config`, {
        headers: savedToken ? { 'x-app-token': savedToken } : {},
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const cfg = await res.json();
      if (!cfg?.serverManagedKey) {
        setCloudRequiresPin(false);
        setCloudVerified(false);
        toast.warning('Server reachable hai par owner key configured nahi — neeche apni API key daalein.');
        return;
      }
      onSaveCloudUrl?.(clean);
      setRenderUrl(clean);
      localStorage.setItem('jeeva_last_render_url', clean);
      if (cfg.requiresPin && !cfg.authorized) {
        setCloudRequiresPin(true);
        setCloudVerified(false);
        toast.info('Cloud server PIN se protected hai — neeche Admin Access PIN enter karein.');
      } else {
        setCloudRequiresPin(false);
        setCloudVerified(true);
        toast.success('Connected to Host Cloud AI! Koi personal key nahi chahiye.');
      }
    } catch (err) {
      setCloudRequiresPin(false);
      setCloudVerified(false);
      toast.error('Cloud server reachable nahi hai: ' + (err?.message || 'Check URL'));
    } finally {
      setCheckingCloud(false);
    }
  };

  const handleUnlockWizardPin = async () => {
    if (!cloudPinInput.trim() || !onUnlockOwner) return;
    setUnlockingPin(true);
    try {
      await onUnlockOwner(cloudPinInput.trim());
      setCloudRequiresPin(false);
      setCloudVerified(true);
      setCloudPinInput('');
      toast.success('Owner Cloud Key unlocked!');
    } catch (err) {
      toast.error(err?.message || 'Invalid Access PIN');
    } finally {
      setUnlockingPin(false);
    }
  };

  const handleSaveStep1 = () => {
    const cleanName = setAiName(assistantNameInput.trim() || 'Jeeva');
    const triggerVal = wakeTriggerInput.trim();
    setWakeTriggerPhrase(triggerVal || `Hey ${cleanName}`);
    localStorage.setItem('jeeva_tts', String(speakReplies));
    window.dispatchEvent(new CustomEvent('jeeva-tts-updated', { detail: Boolean(speakReplies) }));
    setDocSummaryPref(docPref);

    if (apiKeyInput.trim()) {
      onSaveApiKey(apiKeyInput.trim());
    } else if (cloudUrlInput.trim() && (cloudVerified || cloudRequiresPin)) {
      onSaveCloudUrl?.(cloudUrlInput.trim().replace(/\/+$/, ''));
    }
    setStep(2);
  };

  const handleToggleAutoLaunch = async () => {
    if (!window.electronAPI?.setAutoLaunch) return;
    try {
      const wantEnable = !autoLaunch;
      const next = Boolean(await window.electronAPI.setAutoLaunch(wantEnable));
      setAutoLaunch(next);
      if (wantEnable && !next) {
        toast.error('Windows ne auto-start block kiya — Tray Startup folder check karein');
      } else {
        toast.success(next ? 'JEEVA ab Windows ke saath System Tray mein auto-start hoga' : 'Windows auto-start band kiya gaya');
      }
    } catch (err) {
      toast.error(err?.message || 'Could not toggle Windows auto-start');
    }
  };

  const handleRuleChange = (catId, policy) => {
    const next = savePermissionRules({ ...permRules, [catId]: policy });
    setPermRules(next);
  };

  const handleConnectRelay = async () => {
    const clean = renderUrl.trim().replace(/\/+$/, '');
    if (!clean) {
      toast.error('Please enter your Render App URL');
      return;
    }
    setConnecting(true);
    localStorage.setItem('jeeva_last_render_url', clean);
    onSaveCloudUrl?.(clean);
    try {
      const s = await window.electronAPI.relayConnect({ renderUrl: clean, pairToken });
      if (s?.pairToken) setPairToken(s.pairToken);
      toast.success('Connecting PC to Render Cloud...');
    } catch (err) {
      toast.error(err?.message || 'Relay connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const pairedShareUrl = renderUrl.trim() && pairToken
    ? `${renderUrl.trim().replace(/\/+$/, '')}/app?pair=${encodeURIComponent(pairToken)}`
    : '';

  const copyShareUrl = () => {
    if (!pairedShareUrl) return;
    navigator.clipboard.writeText(pairedShareUrl);
    setCopied(true);
    toast.success('Paired Phone/Web link copied!');
    setTimeout(() => setCopied(false), 1800);
  };

  const finishWizard = () => {
    savePermissionRules(permRules);
    localStorage.setItem('jeeva_onboarding_done', 'true');
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-obsidian-surface border border-obsidian-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-obsidian-border flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-emerald-400">STEP {step} OF 3</span>
              <span className="text-xs text-obsidian-muted">· JEEVA PC Setup</span>
            </div>
            <h2 className="text-base font-semibold text-obsidian-text mt-0.5">
              {step === 1
                ? 'Name Your Assistant & Preferences'
                : step === 2
                ? 'Grant PC Access Permissions'
                : 'Link Your Phone / Web Console'}
            </h2>
          </div>
          <button
            onClick={finishWizard}
            className="p-1.5 rounded-lg text-obsidian-muted hover:text-obsidian-text hover:bg-obsidian-elevated"
            title="Skip setup"
          >
            <LuX className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 max-h-[65vh] overflow-y-auto space-y-4">
          {step === 1 && (
            <>
              <div className="p-3.5 rounded-xl bg-obsidian-bg border border-emerald-500/30 space-y-3">
                <p className="text-xs font-semibold text-obsidian-text">
                  Personalize Your AI &amp; Voice Command Trigger
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-obsidian-secondary mb-1">
                      Assistant Name
                    </label>
                    <input
                      type="text"
                      maxLength={24}
                      value={assistantNameInput}
                      onChange={(e) => {
                        const prevDefault = `Hey ${assistantNameInput || 'Jeeva'}`;
                        const nextName = e.target.value;
                        setAssistantNameInput(nextName);
                        if (!wakeTriggerInput || wakeTriggerInput === prevDefault) {
                          setWakeTriggerInput(`Hey ${nextName || 'Jeeva'}`);
                        }
                      }}
                      placeholder="Jeeva, Jarvis, Buddy..."
                      className="w-full bg-obsidian-surface border border-obsidian-border rounded-lg px-3 py-1.5 text-xs text-obsidian-text focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-obsidian-secondary mb-1">
                      Voice Activation Phrase
                    </label>
                    <input
                      type="text"
                      maxLength={36}
                      value={wakeTriggerInput}
                      onChange={(e) => setWakeTriggerInput(e.target.value)}
                      placeholder="Hey Jeeva, Sun Bhai..."
                      className="w-full bg-obsidian-surface border border-obsidian-border rounded-lg px-3 py-1.5 text-xs text-obsidian-text focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-obsidian-border/60">
                  <button
                    type="button"
                    onClick={() => setSpeakReplies((v) => !v)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${
                      speakReplies
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        : 'bg-obsidian-surface border-obsidian-border text-obsidian-secondary'
                    }`}
                  >
                    Speak Replies: {speakReplies ? 'On' : 'Off'}
                  </button>
                  <select
                    value={docPref}
                    onChange={(e) => setDocPref(e.target.value)}
                    className="bg-obsidian-surface border border-obsidian-border rounded-lg px-2.5 py-1 text-[11px] text-obsidian-text focus:outline-none"
                  >
                    <option value="ask">PDFs: Ask / Smart Auto</option>
                    <option value="summarize">PDFs: Always Summarize</option>
                    <option value="read_full">PDFs: Always Read Full</option>
                  </select>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-obsidian-bg border border-obsidian-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-obsidian-text flex items-center gap-1.5">
                    <LuGlobe className="w-4 h-4 text-emerald-400" />
                    Option 1: Use Owner Cloud AI (No API Key Needed)
                  </span>
                  {cloudVerified && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                      READY
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-obsidian-muted">
                  Apna (ya friend ka) Render website URL daalkar connect karein — server ki Gemini API automatically chalegi.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={cloudUrlInput}
                    onChange={(e) => setCloudUrlInput(e.target.value)}
                    placeholder="https://jeeva-ai.onrender.com"
                    className="flex-1 bg-obsidian-surface border border-obsidian-border rounded-lg px-3 py-2 text-xs font-mono text-obsidian-text"
                  />
                  <button
                    type="button"
                    onClick={handleUseCloudAI}
                    disabled={checkingCloud}
                    className="px-3 py-2 rounded-lg bg-emerald-500 text-zinc-950 text-xs font-semibold hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {checkingCloud ? '...' : 'Connect'}
                  </button>
                </div>
                {cloudRequiresPin && (
                  <div className="flex items-center gap-2 pt-1.5">
                    <input
                      type="password"
                      value={cloudPinInput}
                      onChange={(e) => setCloudPinInput(e.target.value)}
                      placeholder="Enter Server Owner PIN..."
                      className="flex-1 bg-obsidian-surface border border-obsidian-border rounded-lg px-3 py-1.5 text-xs font-mono text-obsidian-text"
                    />
                    <button
                      type="button"
                      onClick={handleUnlockWizardPin}
                      disabled={unlockingPin || !cloudPinInput.trim()}
                      className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-white disabled:opacity-40"
                    >
                      {unlockingPin ? '...' : 'Unlock PIN'}
                    </button>
                  </div>
                )}
              </div>

              <div className="p-3.5 rounded-xl bg-obsidian-bg border border-obsidian-border space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-obsidian-text flex items-center gap-1.5">
                    <LuKey className="w-3.5 h-3.5 text-obsidian-muted" />
                    Option 2: Personal Gemini API Key (Optional)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const url = 'https://aistudio.google.com/apikey';
                      if (window.electronAPI?.openURL) window.electronAPI.openURL(url);
                      else window.open(url, '_blank', 'noopener,noreferrer');
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/25"
                  >
                    Create Gemini API Key <LuExternalLink className="w-3 h-3" />
                  </button>
                </div>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Optional: AIza..."
                  className="w-full bg-obsidian-surface border border-obsidian-border rounded-lg px-3 py-2 text-xs font-mono text-obsidian-text placeholder:text-obsidian-muted focus:outline-none focus:border-zinc-500"
                />
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button
                    type="button"
                    disabled={testingWizConn}
                    onClick={async () => {
                      setTestingWizConn(true);
                      setWizConnStatus(null);
                      const trimmed = apiKeyInput.trim();
                      const cleanCloud = cloudUrlInput.trim().replace(/\/+$/, '');
                      const appToken = localStorage.getItem('jeeva_app_token') || '';
                      const res = await testGeminiConnection({
                        apiKey: trimmed,
                        useServerProxy: !trimmed && Boolean(cleanCloud && (cloudVerified || appToken)),
                        proxyBaseUrl: cleanCloud,
                        appToken,
                      });
                      setTestingWizConn(false);
                      setWizConnStatus(res);
                      if (res.ok) toast.success(`API Verified (${res.activeModel}, ${res.latencyMs}ms)`);
                      else toast.error(res.error || 'Connection test failed');
                    }}
                    className="px-2.5 py-1 rounded-md bg-obsidian-surface hover:bg-obsidian-elevated border border-obsidian-border text-[11px] font-medium text-obsidian-text disabled:opacity-50"
                  >
                    {testingWizConn ? 'Testing...' : 'Test API / Cloud Connection'}
                  </button>
                  {wizConnStatus && (
                    <span
                      className={`text-[10px] font-mono ${
                        wizConnStatus.ok ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {wizConnStatus.ok ? `OK (${wizConnStatus.activeModel})` : wizConnStatus.error?.slice(0, 50)}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-obsidian-bg border border-obsidian-border">
                <div>
                  <p className="text-xs font-medium text-obsidian-text">Start Automatically with Windows</p>
                  <p className="text-[11px] text-obsidian-muted">Keeps JEEVA ready in System Tray for remote &amp; Alt+Space voice</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoLaunch}
                  aria-label="Start Automatically with Windows"
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

              <div className="space-y-2">
                <p className="text-xs font-medium text-obsidian-text flex items-center gap-1.5">
                  <LuShieldCheck className="w-4 h-4 text-emerald-400" />
                  Select Permission Policy Per Category
                </p>
                {PERMISSION_CATEGORIES.map((cat) => (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between gap-3 bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-obsidian-text">{cat.label}</p>
                      <p className="text-[10px] text-obsidian-muted truncate">{cat.description}</p>
                    </div>
                    <select
                      value={permRules[cat.id] || 'ask'}
                      onChange={(e) => handleRuleChange(cat.id, e.target.value)}
                      className="bg-obsidian-surface border border-obsidian-border rounded-md px-2 py-1 text-[11px] text-obsidian-text flex-shrink-0"
                    >
                      <option value="ask">Ask Every Time</option>
                      <option value="always">Always Allow</option>
                      <option value="block">Block</option>
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-obsidian-bg border border-obsidian-border">
                <LuGlobe className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-obsidian-secondary leading-relaxed">
                  Apni Render URL connect karein aur neeche diya link apne Phone par kholein — kisi aur ko aapka PC nahi dikhega.
                </div>
              </div>

              <div className="space-y-2.5">
                <label className="block text-xs font-medium text-obsidian-text">Render Website URL</label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={renderUrl}
                    onChange={(e) => setRenderUrl(e.target.value)}
                    placeholder="https://jeeva-ai.onrender.com"
                    className="flex-1 bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-2 text-xs font-mono text-obsidian-text"
                  />
                  <button
                    type="button"
                    onClick={handleConnectRelay}
                    disabled={connecting}
                    className="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-white"
                  >
                    {relayConnected ? 'Connected' : connecting ? '...' : 'Connect'}
                  </button>
                </div>
              </div>

              {pairToken && (
                <div className="bg-obsidian-bg border border-obsidian-border rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-obsidian-muted">YOUR PRIVATE PAIR KEY</span>
                    <span className="text-xs font-mono font-bold text-emerald-400">{pairToken}</span>
                  </div>
                  {pairedShareUrl && (
                    <div className="flex items-center gap-2 pt-1">
                      <code className="flex-1 text-[11px] font-mono text-obsidian-secondary truncate bg-obsidian-surface px-2 py-1 rounded border border-obsidian-border">
                        {pairedShareUrl}
                      </code>
                      <button
                        type="button"
                        onClick={copyShareUrl}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-obsidian-elevated border border-obsidian-border text-xs text-obsidian-text"
                      >
                        {copied ? <LuCheck className="w-3 h-3 text-emerald-400" /> : <LuCopy className="w-3 h-3" />}
                        Copy
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-obsidian-border bg-obsidian-bg/50 flex items-center justify-between">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="px-3 py-1.5 rounded-lg text-xs text-obsidian-secondary hover:text-obsidian-text"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={finishWizard}
              className="px-3 py-1.5 rounded-lg text-xs text-obsidian-muted hover:text-obsidian-text"
            >
              Skip Setup
            </button>
          )}

          {step === 1 && (
            <button
              type="button"
              onClick={handleSaveStep1}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-white"
            >
              Continue <LuArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              onClick={() => setStep(3)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-white"
            >
              Continue <LuArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              onClick={finishWizard}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 text-zinc-950 text-xs font-semibold hover:bg-emerald-400"
            >
              <LuCheck className="w-3.5 h-3.5" />
              Finish &amp; Start
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
