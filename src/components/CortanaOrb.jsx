import { LuMic, LuAudioLines, LuActivity } from 'react-icons/lu';

export default function CortanaOrb({ state = 'idle', audioLevel = 0, onClick }) {
  // state: 'idle' | 'listening' | 'thinking' | 'speaking'
  const outerScale =
    state === 'listening'
      ? 1 + Math.min(0.45, audioLevel * 0.55)
      : state === 'speaking'
      ? 1.16
      : state === 'thinking'
      ? 1.08
      : 1;

  const palette = {
    idle: {
      ring: 'border-zinc-500/60',
      halo: 'bg-zinc-500/10',
      inner: 'border-zinc-400/70 bg-obsidian-surface text-obsidian-secondary hover:border-zinc-200 hover:text-white',
    },
    listening: {
      ring: 'border-sky-400',
      halo: 'bg-sky-400/20',
      inner: 'border-sky-300 bg-sky-500/15 text-sky-300 shadow-[0_0_28px_rgba(56,189,248,0.35)]',
    },
    thinking: {
      ring: 'border-amber-400/80 border-dashed animate-spin',
      halo: 'bg-amber-400/15',
      inner: 'border-amber-300/80 bg-amber-500/10 text-amber-300',
    },
    speaking: {
      ring: 'border-emerald-400 animate-pulse',
      halo: 'bg-emerald-400/20',
      inner: 'border-emerald-300 bg-emerald-500/15 text-emerald-300 shadow-[0_0_28px_rgba(52,211,153,0.35)]',
    },
  }[state] || {
    ring: 'border-zinc-500/60',
    halo: 'bg-zinc-500/10',
    inner: 'border-zinc-400/70 bg-obsidian-surface text-obsidian-secondary',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-32 h-32 flex items-center justify-center focus:outline-none group cursor-pointer"
      title={state === 'listening' ? 'Tap to Stop Listening' : 'Tap to Speak'}
    >
      {/* Dynamic Audio-Reactive Halo */}
      <span
        className={`absolute inset-2 rounded-full transition-transform duration-100 ${palette.halo}`}
        style={{ transform: `scale(${outerScale})` }}
      />

      {/* Outer Cortana Ring */}
      <span
        className={`absolute inset-4 rounded-full border-[3px] transition-all duration-150 ${palette.ring}`}
        style={{ transform: `scale(${state === 'listening' ? 1 + audioLevel * 0.22 : 1})` }}
      />

      {/* Inner Core */}
      <span
        className={`relative w-16 h-16 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${palette.inner}`}
      >
        {state === 'speaking' ? (
          <LuAudioLines className="w-7 h-7" />
        ) : state === 'thinking' ? (
          <LuActivity className="w-7 h-7 animate-pulse" />
        ) : (
          <LuMic className="w-7 h-7" />
        )}
      </span>
    </button>
  );
}
