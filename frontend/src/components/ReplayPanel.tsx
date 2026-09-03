import { useMemo } from 'react';
import { Film } from 'lucide-react';
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
 */
export default function ReplayPanel({ recording }: ReplayPanelProps) {
  const segments = recording.clusterInfo?.num_segments;
  const states = useMemo(() => replayRecording(recording, segments), [recording, segments]);
  const state = states[states.length - 1];

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

      <PlanPlayer {...state} segments={segments} />
    </div>
  );
}
