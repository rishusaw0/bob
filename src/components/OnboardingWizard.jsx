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
  const [apiKeyInput, setApiKeyInput] = useState(initialApiKey || '');
  const [cloudUrlInput, setCloudUrlInput] = useState(
    initialCloudUrl || localStorage.getItem('jeeva_last_render_url') || 'https://jeeva-ai.onrender.com'
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
    initialCloudUrl || localStorage.getItem('jeeva_last_render_url') || 'https://jeeva-ai.onrender.com'
  );
  const [pairToken, setPairToken] = useState('');
  const [relayConnected, setRelayConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    window.electronAPI?.getAutoLaunch?.().then((v) => setAutoLaunch(Boolean(v))).catch(() => {});
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
    if (apiKeyInput.trim()) {
      onSaveApiKey(apiKeyInput.trim());
    } else if (cloudUrlInput.trim() && (cloudVerified || cloudRequiresPin)) {
      onSaveCloudUrl?.(cloudUrlInput.trim().replace(/\/+$/, ''));
    }
    setStep(2);
  };

  const handleToggleAutoLaunch = async () => {
    if (!window.electronAPI?.setAutoLaunch) return;
    const next = await window.electronAPI.setAutoLaunch(!autoLaunch);
    setAutoLaunch(Boolean(next));
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
                ? 'Connect AI Engine (Cloud or Personal Key)'
                : step === 2
                ? 'Grant PC Access Permissions'
                : 'Link Your Phone / Render Web Console'}
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
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline"
                  >
                    Get Free Key <LuExternalLink className="w-3 h-3" />
                  </a>
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
                  onClick={handleToggleAutoLaunch}
                  className={`w-10 h-5 rounded-full transition-colors p-0.5 ${
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
