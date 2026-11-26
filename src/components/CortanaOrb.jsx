import { LuMic, LuAudioLines, LuActivity } from 'react-icons/lu';

export default function CortanaOrb({
  state = 'idle',
  audioLevel = 0,
  freqBands = null,
  liveActive = false,
  onClick,
}) {
  // state: 'idle' | 'listening' | 'thinking' | 'speaking'
  const effectiveLevel = Math.max(0, Math.min(1, audioLevel || 0));
  const bars = Array.isArray(freqBands) && freqBands.length === 5
    ? freqBands
    : [
        effectiveLevel * 0.65,
        effectiveLevel * 0.9,
        effectiveLevel,
        effectiveLevel * 0.85,
        effectiveLevel * 0.6,
      ];

  const outerScale =
    state === 'listening'
      ? 1 + Math.min(0.45, effectiveLevel * 0.55)
      : state === 'speaking'
      ? 1.08 + Math.min(0.35, effectiveLevel * 0.45)
      : state === 'thinking'
      ? 1.08
      : 1;

  const ringScale =
    state === 'listening' || state === 'speaking'
      ? 1 + effectiveLevel * 0.24
      : 1;

  const palette = {
    idle: {
      ring: 'border-zinc-500/60',
      halo: 'bg-zinc-500/10',
      inner: 'border-zinc-400/70 bg-obsidian-surface text-obsidian-secondary hover:border-zinc-200 hover:text-white',
      bar: 'bg-zinc-400',
    },
    listening: {
      ring: 'border-sky-400',
      halo: 'bg-sky-400/20',
      inner: 'border-sky-300 bg-sky-500/15 text-sky-300 shadow-[0_0_28px_rgba(56,189,248,0.35)]',
      bar: 'bg-sky-300',
    },
    thinking: {
      ring: 'border-amber-400/80 border-dashed animate-spin',
      halo: 'bg-amber-400/15',
      inner: 'border-amber-300/80 bg-amber-500/10 text-amber-300',
      bar: 'bg-amber-300',
    },
    speaking: {
      ring: 'border-emerald-400',
      halo: 'bg-emerald-400/20',
      inner: 'border-emerald-300 bg-emerald-500/15 text-emerald-300 shadow-[0_0_28px_rgba(52,211,153,0.35)]',
      bar: 'bg-emerald-300',
    },
  }[state] || {
    ring: 'border-zinc-500/60',
    halo: 'bg-zinc-500/10',
    inner: 'border-zinc-400/70 bg-obsidian-surface text-obsidian-secondary',
    bar: 'bg-zinc-400',
  };

  const showSpectrum = (state === 'listening' || state === 'speaking') && effectiveLevel > 0.02;

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-32 h-32 flex items-center justify-center focus:outline-none group cursor-pointer"
      title={state === 'listening' ? 'Tap to Stop Listening' : 'Tap to Speak'}
    >
      {/* Dynamic Audio-Reactive Halo */}
      <span
        className={`absolute inset-2 rounded-full transition-transform duration-75 ${palette.halo}`}
        style={{ transform: `scale(${outerScale})` }}
      />

      {/* Outer Cortana Ring */}
      <span
        className={`absolute inset-4 rounded-full border-[3px] transition-transform duration-75 ${palette.ring}`}
        style={{ transform: `scale(${ringScale})` }}
      />

      {liveActive && (
        <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-rose-400 animate-ping" />
      )}

      {/* Inner Core */}
      <span
        className={`relative w-16 h-16 rounded-full border-2 flex items-center justify-center transition-all duration-150 ${palette.inner}`}
      >
        {showSpectrum ? (
          <span className="flex items-center justify-center gap-1 h-7">
            {bars.map((val, idx) => (
              <span
                key={idx}
                className={`w-1 rounded-full transition-all duration-75 ${palette.bar}`}
                style={{ height: `${Math.max(5, Math.min(26, 5 + val * 22))}px` }}
              />
            ))}
          </span>
        ) : state === 'speaking' ? (
          <LuAudioLines className="w-7 h-7 animate-pulse" />
        ) : state === 'thinking' ? (
          <LuActivity className="w-7 h-7 animate-pulse" />
        ) : (
          <LuMic className="w-7 h-7" />
        )}
      </span>
    </button>
  );
}
