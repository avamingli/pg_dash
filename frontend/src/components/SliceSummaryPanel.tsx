import { formatDuration, type SliceSummary } from '@/lib/planTree';

// Left-side info column for the Watch panel's graphical plan view — overall
// run time / estimated progress plus a per-slice time breakdown, GPCC-style.
// Deliberately doesn't try to reproduce GPCC's "Top 5 slices by CPU/Memory/
// Disk I/O" panel: none of that is captured anywhere in this project (see
// advanceSliceTiming's own comment), so showing it would mean fabricating
// numbers instead of approximating from something real.

const SLICE_COLORS = [
  'bg-blue-500', 'bg-amber-500', 'bg-emerald-500', 'bg-purple-500',
  'bg-pink-500', 'bg-cyan-500', 'bg-orange-500', 'bg-lime-500',
];

interface SliceSummaryPanelProps {
  slices: SliceSummary[];
  runTimeMs: number;
  estProgressPct: number | null;
}

export default function SliceSummaryPanel({ slices, runTimeMs, estProgressPct }: SliceSummaryPanelProps) {
  const totalMs = slices.reduce((sum, s) => sum + s.activeMs, 0);

  return (
    <div className="w-36 shrink-0 space-y-3 text-xs pl-4 pt-4">
      <div>
        <div className="text-zinc-500">Run Time</div>
        <div className="text-zinc-200 font-mono">{formatDuration(runTimeMs)}</div>
      </div>
      <div>
        <div className="text-zinc-500">Est. Progress</div>
        <div className="text-zinc-200 font-mono">{estProgressPct != null ? `${estProgressPct}%` : '—'}</div>
      </div>

      {slices.length > 0 && (
        <div className="pt-2 border-t border-zinc-800 space-y-2">
          {slices.map((s, i) => (
            <div key={s.id} className="flex items-start gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm shrink-0 mt-0.5 ${SLICE_COLORS[i % SLICE_COLORS.length]}`} />
              <div className="min-w-0">
                <div className="text-zinc-400 truncate">{s.label}</div>
                <div className="text-zinc-300 font-mono text-[11px]">
                  {formatDuration(s.activeMs)} ({s.pct.toFixed(0)}%)
                </div>
              </div>
            </div>
          ))}
          <div className="flex items-start gap-1.5 pt-1 border-t border-zinc-800/50">
            <span className="w-2.5 h-2.5 rounded-sm border border-zinc-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-zinc-500">Total</div>
              <div className="text-zinc-400 font-mono text-[11px]">{formatDuration(totalMs)} (100%)</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
