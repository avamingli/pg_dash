import { formatDuration, sliceColor, type SliceSummary } from '@/lib/planTree';

// Left-side info column for the Watch panel's graphical plan view — overall
// run time / estimated progress plus a per-slice time breakdown, GPCC-style.
// Deliberately doesn't try to reproduce GPCC's "Top 5 slices by CPU/Memory/
// Disk I/O" panel: none of that is captured anywhere in this project (see
// advanceSliceTiming's own comment), so showing it would mean fabricating
// numbers instead of approximating from something real.
//
// Slice chip colors are keyed on slice id (via sliceColor from planTree),
// not on ordinal position in this list — the same slice must read the same
// color everywhere it appears (here, on tree nodes, and on graph cards).

interface SliceSummaryPanelProps {
  slices: SliceSummary[];
  runTimeMs: number;
  estProgressPct: number | null;
}

export default function SliceSummaryPanel({ slices, runTimeMs, estProgressPct }: SliceSummaryPanelProps) {
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
          {/* Per-slice active time, framed as "share of Run Time" — slices
              run concurrently so several near-100% at once is expected, not
              a bug. No "Total" row: summing concurrent slice times just
              gives N × Run Time, which was the source of the earlier "1m
              Run Time but 7m Total" surprise. */}
          {slices.map(s => {
            const hex = sliceColor(s.id);
            return (
              <div key={s.id} className="flex items-start gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0 mt-0.5" style={{ backgroundColor: hex ?? '#71717a' }} />
                <div className="min-w-0">
                  <div className="text-zinc-400 truncate">{s.label}</div>
                  <div className="text-zinc-300 font-mono text-[11px]">
                    {formatDuration(s.activeMs)} ({s.pct.toFixed(0)}%)
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
