import { useEffect, useState } from 'react';
import { LuVolume2, LuPause, LuPlay, LuSquare } from 'react-icons/lu';
import {
  subscribeSpeech,
  pauseSpeech,
  resumeSpeech,
  stopSpeech,
  cycleSpeechRate,
  VOICE_PROFILES,
} from '../services/speech';

export default function AudioPlayerBar() {
  const [speech, setSpeech] = useState({
    isPlaying: false,
    isPaused: false,
    isLoading: false,
    currentChunk: 0,
    totalChunks: 0,
    rate: 1,
    label: '',
    voiceMode: 'auto',
    detectedProfile: 'hinglish',
    engine: 'gemini',
  });

  useEffect(() => subscribeSpeech(setSpeech), []);

  if (!speech.isPlaying) return null;

  const activeProfileLabel = VOICE_PROFILES[speech.detectedProfile]?.shortLabel || 'Hinglish';

  return (
    <div className="px-4 sm:px-6 pb-2 animate-fade-in">
      <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 px-3.5 py-2 rounded-xl bg-obsidian-surface border border-obsidian-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <LuVolume2 className={`w-4 h-4 text-emerald-400 flex-shrink-0 ${speech.isPaused ? '' : 'animate-pulse'}`} />
          <span className="text-xs font-medium text-obsidian-text truncate">
            {speech.isLoading ? 'Generating studio voice...' : speech.label || 'Reading aloud...'}
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-obsidian-bg border border-obsidian-border text-obsidian-secondary flex-shrink-0">
            {activeProfileLabel}{speech.voiceMode === 'auto' ? ' (Auto)' : ''}
          </span>
          {speech.totalChunks > 1 && (
            <span className="text-[11px] font-mono text-obsidian-muted flex-shrink-0">
              {speech.currentChunk}/{speech.totalChunks}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={cycleSpeechRate}
            className="px-2 py-1 rounded-md bg-obsidian-bg border border-obsidian-border text-[11px] font-mono text-obsidian-secondary hover:text-obsidian-text transition-colors"
            title="Playback Speed"
          >
            {speech.rate}x
          </button>

          {speech.isPaused ? (
            <button
              onClick={resumeSpeech}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-100 text-zinc-950 text-xs font-medium hover:bg-white transition-colors"
            >
              <LuPlay className="w-3 h-3" />
              Resume
            </button>
          ) : (
            <button
              onClick={pauseSpeech}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-obsidian-elevated border border-obsidian-border text-xs text-obsidian-text hover:bg-obsidian-hover transition-colors"
            >
              <LuPause className="w-3 h-3" />
              Pause
            </button>
          )}

          <button
            onClick={stopSpeech}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-obsidian-elevated border border-obsidian-border text-xs text-red-400 hover:bg-red-950/40 transition-colors"
          >
            <LuSquare className="w-3 h-3" />
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
