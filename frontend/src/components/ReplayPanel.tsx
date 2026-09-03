import { useEffect, useMemo, useState } from 'react';
import { Film, Pause, Play, SkipBack } from 'lucide-react';
import PlanPlayer from '@/components/PlanPlayer';
import { replayRecording, type Recording } from '@/lib/replayEngine';

interface ReplayPanelProps {
  /** A validated v1 recording — see parseRecording. */
  recording: Recording;
}

/**
 * Replay driver for a captured Watch session. Folds the recording's
 * frames through the same pipeline the live panel runs and hands the
 * result to the same view, so a recording renders exactly as the run it
 * was captured from — no live database involved.
 *
 * Segment count comes from the *recording*, not the currently connected
 * cluster: Motion N:M labels have to describe the cluster the query
 * actually ran on.
 *
 * Playback is a cursor over the pre-folded state array, not a re-run:
 * every frame's state is computed once on load, so stepping is a state
 * index change and nothing in the monotonic pipeline can drift.
 *
 * Playback position is plain component state, so callers mount one
 * ReplayPanel per recording (`key` it on the loaded file) rather than
 * swapping the prop underneath a running one.
 */
export default function ReplayPanel({ recording }: ReplayPanelProps) {
  const segments = recording.clusterInfo?.num_segments;
  const states = useMemo(() => replayRecording(recording, segments), [recording, segments]);
  const lastIndex = states.length - 1;

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const state = states[Math.min(index, lastIndex)];

  // Advance one frame at a time, waiting out the gap the frames
  // themselves recorded — a run that stalled for 3s stalls for 3s here
  // too. Re-armed per frame rather than run off one interval so an
  // irregular poll cadence (a slow /progress response, a tab that was
  // backgrounded mid-capture) replays with its real rhythm.
  useEffect(() => {
    if (!playing || index >= lastIndex) return;
    const delay = states[index + 1].tsMs - states[index].tsMs;
    const timer = setTimeout(() => setIndex(i => i + 1), Math.max(0, delay));
    return () => clearTimeout(timer);
  }, [playing, index, lastIndex, states]);

  const atEnd = index >= lastIndex;
  const restart = () => {
    setIndex(0);
    setPlaying(true);
  };
  // Hitting ▶ on a finished playback rewinds instead of doing nothing —
  // the alternative is a dead button at the one moment you most want to
  // watch the run again.
  const togglePlay = () => {
    if (atEnd) restart();
    else setPlaying(p => !p);
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-zinc-800">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-200">
            <Film size={14} className="text-zinc-500" /> Replaying recording
          </h2>
          <p className="text-xs text-zinc-500 font-mono truncate">{recording.query || '(query not recorded)'}</p>
        </div>
        <div className="shrink-0 text-right text-[11px] text-zinc-500 leading-5">
          <div>
            {states.length} frames · {(states[states.length - 1].tsMs / 1000).toFixed(1)}s
          </div>
          <div>
            {recording.clusterInfo?.mode ?? 'unknown'}
            {segments != null && ` · ${segments} segments`}
            {recording.startedAt && ` · ${new Date(recording.startedAt).toLocaleString()}`}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800">
        <button
          onClick={togglePlay}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors text-xs"
          title={atEnd ? 'Replay from the start' : playing ? 'Pause' : 'Play'}
        >
          {playing && !atEnd ? <Pause size={12} /> : <Play size={12} />}
          {playing && !atEnd ? 'Pause' : atEnd ? 'Replay' : 'Play'}
        </button>
        <button
          onClick={restart}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors text-xs"
          title="Back to the first frame"
        >
          <SkipBack size={12} /> Restart
        </button>
        <span className="text-[11px] text-zinc-500 tabular-nums">
          Frame {state.frameIndex + 1}/{states.length} · {(state.tsMs / 1000).toFixed(1)}s
        </span>
      </div>

      <PlanPlayer {...state} segments={segments} />
    </div>
  );
}
