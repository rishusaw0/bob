import { useEffect, useState } from 'react';
import {
  LuKey,
  LuShieldCheck,
  LuCheck,
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

export default function OnboardingWizard({ initialApiKey = '', onSaveApiKey, onComplete }) {
  const [step, setStep] = useState(1);
  const [assistantNameInput, setAssistantNameInput] = useState(() => getAiName());
  const [wakeTriggerInput, setWakeTriggerInput] = useState(() => getWakeTriggerPhrase());
  const [speakReplies, setSpeakReplies] = useState(() => localStorage.getItem('jeeva_tts') === 'true');
  const [docPref, setDocPref] = useState(() => getDocSummaryPref());
  const [apiKeyInput, setApiKeyInput] = useState(initialApiKey);
  const [testingWizConn, setTestingWizConn] = useState(false);
  const [wizConnStatus, setWizConnStatus] = useState(null);
  const [permRules, setPermRules] = useState(() => getPermissionRules());
  const [autoLaunch, setAutoLaunch] = useState(false);

  useEffect(() => {
    let mounted = true;
    window.electronAPI?.getAutoLaunch?.()
      .then(async (enabled) => {
        if (!mounted) return;
        if (enabled) {
          setAutoLaunch(true);
          return;
        }
        if (window.electronAPI?.setAutoLaunch) {
          const result = await window.electronAPI.setAutoLaunch(true).catch(() => false);
          if (mounted) setAutoLaunch(Boolean(result));
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const handleSaveStep1 = () => {
    const cleanName = setAiName(assistantNameInput.trim() || 'Jeeva');
    const trigger = wakeTriggerInput.trim();
    setWakeTriggerPhrase(trigger || `Hey ${cleanName}`);
    localStorage.setItem('jeeva_tts', String(speakReplies));
    window.dispatchEvent(new CustomEvent('jeeva-tts-updated', { detail: Boolean(speakReplies) }));
    setDocSummaryPref(docPref);

    const key = apiKeyInput.trim();
    if (key) onSaveApiKey?.(key);
    setStep(2);
  };

  const handleTestApiKey = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      toast.error('Pehle Gemini API key paste karein.');
      return;
    }
    setTestingWizConn(true);
    setWizConnStatus(null);
    try {
      const result = await testGeminiConnection({ apiKey: key });
      setWizConnStatus(result);
      if (result.ok) toast.success(`Gemini API verified (${result.activeModel})`);
      else toast.error(result.error || 'Gemini API connection failed');
    } finally {
      setTestingWizConn(false);
    }
  };

  const handleToggleAutoLaunch = async () => {
    if (!window.electronAPI?.setAutoLaunch) return;
    try {
      const next = Boolean(await window.electronAPI.setAutoLaunch(!autoLaunch));
      setAutoLaunch(next);
      toast.success(next ? 'JEEVA Windows startup ke saath chalega.' : 'Windows auto-start band kar diya.');
    } catch (err) {
      toast.error(err?.message || 'Windows auto-start setting change nahi hui.');
    }
  };

  const handleRuleChange = (categoryId, policy) => {
    setPermRules((current) => savePermissionRules({ ...current, [categoryId]: policy }));
  };

  const finishWizard = () => {
    savePermissionRules(permRules);
    localStorage.setItem('jeeva_onboarding_done', 'true');
    onComplete?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-obsidian-surface border border-obsidian-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-obsidian-border flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-emerald-400">PC SETUP · STEP {step} OF 2</span>
              <span className="text-xs text-obsidian-muted">· JEEVA Desktop</span>
            </div>
            <h2 className="text-base font-semibold text-obsidian-text mt-0.5">
              {step === 1 ? 'Assistant & Gemini Setup' : 'PC Permissions & Startup'}
            </h2>
          </div>
          <button
            type="button"
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
                <p className="text-xs font-semibold text-obsidian-text">Personalize your desktop assistant</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-obsidian-secondary mb-1">Assistant Name</label>
                    <input
                      type="text"
                      maxLength={24}
                      value={assistantNameInput}
                      onChange={(event) => {
                        const previousDefault = `Hey ${assistantNameInput || 'Jeeva'}`;
                        const nextName = event.target.value;
                        setAssistantNameInput(nextName);
                        if (!wakeTriggerInput || wakeTriggerInput === previousDefault) {
                          setWakeTriggerInput(`Hey ${nextName || 'Jeeva'}`);
                        }
                      }}
                      placeholder="Jeeva"
                      className="w-full bg-obsidian-surface border border-obsidian-border rounded-lg px-3 py-1.5 text-xs text-obsidian-text"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-obsidian-secondary mb-1">Wake Phrase</label>
                    <input
                      type="text"
                      maxLength={36}
                      value={wakeTriggerInput}
                      onChange={(event) => setWakeTriggerInput(event.target.value)}
                      placeholder="Hey Jeeva"
                      className="w-full bg-obsidian-surface border border-obsidian-border rounded-lg px-3 py-1.5 text-xs text-obsidian-text"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-obsidian-border/60">
                  <button
                    type="button"
                    onClick={() => setSpeakReplies((value) => !value)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] border ${speakReplies ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-obsidian-surface border-obsidian-border text-obsidian-secondary'}`}
                  >
                    {speakReplies ? 'Voice replies ON' : 'Voice replies OFF'}
                  </button>
                  <label className="text-[11px] text-obsidian-secondary">PDF reading</label>
                  <select
                    value={docPref}
                    onChange={(event) => setDocPref(event.target.value)}
                    className="bg-obsidian-surface border border-obsidian-border rounded px-2 py-1 text-[11px] text-obsidian-text"
                  >
                    <option value="read_summary">Read PDF summary</option>
                    <option value="read_full">Always read full PDF</option>
                  </select>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-obsidian-bg border border-obsidian-border space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-obsidian-text flex items-center gap-1.5">
                    <LuKey className="w-3.5 h-3.5 text-obsidian-muted" />
                    Gemini API Key
                  </label>
                  <button
                    type="button"
                    onClick={() => window.electronAPI?.openURL?.('https://aistudio.google.com/apikey')}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-medium text-emerald-300"
                  >
                    Create API Key <LuExternalLink className="w-3 h-3" />
                  </button>
                </div>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(event) => setApiKeyInput(event.target.value)}
                  placeholder="Paste your Gemini API key..."
                  autoComplete="off"
                  className="w-full bg-obsidian-surface border border-obsidian-border rounded-lg px-3 py-2 text-xs font-mono text-obsidian-text"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleTestApiKey}
                    disabled={testingWizConn || !apiKeyInput.trim()}
                    className="px-2.5 py-1 rounded-md bg-obsidian-surface border border-obsidian-border text-[11px] text-obsidian-text disabled:opacity-50"
                  >
                    {testingWizConn ? 'Testing…' : 'Test Gemini API'}
                  </button>
                  {wizConnStatus && (
                    <span className={`text-[10px] font-mono ${wizConnStatus.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {wizConnStatus.ok ? `OK · ${wizConnStatus.activeModel}` : wizConnStatus.error?.slice(0, 70)}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-obsidian-muted">
                  API key isi Windows PC ke secure vault mein save hoti hai.
                </p>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-obsidian-bg border border-obsidian-border">
                <div>
                  <p className="text-xs font-medium text-obsidian-text">Start Automatically with Windows</p>
                  <p className="text-[11px] text-obsidian-muted">JEEVA desktop app Windows startup par System Tray mein chalega.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoLaunch}
                  aria-label="Start Automatically with Windows"
                  onClick={handleToggleAutoLaunch}
                  className={`w-10 h-5 rounded-full p-0.5 ${autoLaunch ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white ${autoLaunch ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-obsidian-text flex items-center gap-1.5">
                  <LuShieldCheck className="w-4 h-4 text-emerald-400" />
                  PC Permission Policy
                </p>
                {PERMISSION_CATEGORIES.map((category) => (
                  <div key={category.id} className="flex items-center justify-between gap-3 bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-obsidian-text">{category.label}</p>
                      <p className="text-[10px] text-obsidian-muted truncate">{category.description}</p>
                    </div>
                    <select
                      value={permRules[category.id] || 'ask'}
                      onChange={(event) => handleRuleChange(category.id, event.target.value)}
                      className="bg-obsidian-surface border border-obsidian-border rounded-md px-2 py-1 text-[11px] text-obsidian-text"
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
        </div>

        <div className="px-6 py-4 border-t border-obsidian-border bg-obsidian-bg/50 flex items-center justify-between">
          {step === 1 ? (
            <button
              type="button"
              onClick={finishWizard}
              className="px-3 py-1.5 rounded-lg text-xs text-obsidian-muted hover:text-obsidian-text"
            >
              Skip Setup
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-3 py-1.5 rounded-lg text-xs text-obsidian-secondary hover:text-obsidian-text"
            >
              Back
            </button>
          )}
          {step === 1 ? (
            <button
              type="button"
              onClick={handleSaveStep1}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-100 text-zinc-950 text-xs font-semibold"
            >
              Continue <LuArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={finishWizard}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 text-zinc-950 text-xs font-semibold"
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
