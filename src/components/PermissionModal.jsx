import { LuShieldAlert, LuShieldCheck, LuCheck, LuX, LuGlobe, LuMic, LuVolume2 } from 'react-icons/lu';

export default function PermissionModal({ request, onDecision }) {
  if (!request) return null;

  const { name, args, riskLevel, categoryLabel, summary, isRemote, questionText, fromVoice, voiceStatus, heardText } = request;
  const isHigh = riskLevel === 'high';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-[2px] animate-fade-in">
      <div className="bg-obsidian-surface border border-obsidian-border rounded-xl w-full max-w-md mx-4 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center border flex-shrink-0 ${
                isHigh
                  ? 'bg-red-950/40 border-red-900/60 text-red-400'
                  : 'bg-amber-950/40 border-amber-900/60 text-amber-400'
              }`}
            >
              {isHigh ? <LuShieldAlert className="w-4 h-4" /> : <LuShieldCheck className="w-4 h-4" />}
            </div>
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="text-sm font-semibold text-obsidian-text">
                  {isHigh ? 'High-Risk PC Action' : 'Permission Required'}
                </h3>
                <span
                  className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                    isHigh
                      ? 'bg-red-500/15 text-red-300 border border-red-500/30'
                      : riskLevel === 'medium'
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                      : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                  }`}
                >
                  {riskLevel || 'medium'}
                </span>
              </div>
              <p className="text-[11px] text-obsidian-muted">
                {categoryLabel || 'System Control'} · Confirm before running on PC
              </p>
            </div>
          </div>
          {isRemote && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-950/50 border border-sky-800/60 text-[10px] font-mono text-sky-300 flex-shrink-0">
              <LuGlobe className="w-3 h-3" />
              Remote
            </span>
          )}
        </div>

        {questionText && (
          <div className="mb-2.5 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-obsidian-text leading-relaxed">
            <p className="font-medium">{questionText}</p>
            {fromVoice && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-mono text-sky-300">
                {voiceStatus === 'speaking' ? (
                  <>
                    <LuVolume2 className="w-3.5 h-3.5 animate-pulse" />
                    <span>Asking via voice...</span>
                  </>
                ) : voiceStatus === 'listening' ? (
                  <>
                    <LuMic className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
                    <span className="text-emerald-300">
                      Listening for Yes / Haan or No / Nahi{heardText ? ` ("${heardText}")` : '...'}
                    </span>
                  </>
                ) : (
                  <span className="text-obsidian-muted">Tap a button below to confirm</span>
                )}
              </div>
            )}
          </div>
        )}

        {summary && (
          <div className="mb-2.5 px-3 py-2 rounded-lg bg-obsidian-elevated border border-obsidian-border text-xs text-obsidian-text font-medium">
            {summary}
          </div>
        )}

        <div className="bg-obsidian-bg border border-obsidian-border rounded-lg p-3 mb-4 text-xs font-mono text-zinc-300 overflow-x-auto max-h-36">
          <div className="text-obsidian-muted mb-1">
            tool: <span className="text-obsidian-text font-semibold">{name}</span>
          </div>
          <pre className="whitespace-pre-wrap break-all text-[11px] text-obsidian-secondary">
            {JSON.stringify(args, null, 2)}
          </pre>
        </div>

        <div className="flex items-center justify-end gap-2 flex-wrap">
          <button
            onClick={() => onDecision('deny')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-obsidian-bg border border-obsidian-border text-xs text-obsidian-secondary hover:text-red-400 hover:border-red-900/60 transition-colors"
          >
            <LuX className="w-3.5 h-3.5" />
            Deny
          </button>
          <button
            onClick={() => onDecision('once')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-medium hover:bg-white transition-colors"
          >
            <LuCheck className="w-3.5 h-3.5" />
            Allow Once
          </button>
          {!isHigh && (
            <>
              <button
                onClick={() => onDecision('session_category')}
                className="px-3 py-1.5 rounded-lg bg-sky-600/20 border border-sky-500/40 text-xs font-medium text-sky-300 hover:bg-sky-600 hover:text-white transition-colors"
              >
                Allow Category (Session)
              </button>
              <button
                onClick={() => onDecision('always_category')}
                className="px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-xs font-medium text-emerald-300 hover:bg-emerald-600 hover:text-white transition-colors"
              >
                Always Allow
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
