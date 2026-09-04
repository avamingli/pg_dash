/**
 * The dashboard's time-range vocabulary, shared by the selector control
 * and the pages that fetch against it.
 *
 * Lives outside TimeRangeSelector.tsx because a component file that also
 * exports non-components breaks Fast Refresh — the same reason
 * planAggregate.ts sits outside QueryWatchPanel.tsx.
 */
export type TimeRange = 'realtime' | '1h' | '6h' | '24h' | '3d' | '7d';

/**
 * Resolve a range to the ISO window the snapshot API expects, or null
 * for 'realtime' — which has no window, because it reads the live
 * WebSocket history rather than stored snapshots.
 */
export function timeRangeToISO(range: TimeRange): { from: string; to: string } | null {
  if (range === 'realtime') return null;
  const to = new Date();
  const from = new Date();
  switch (range) {
    case '1h': from.setHours(from.getHours() - 1); break;
    case '6h': from.setHours(from.getHours() - 6); break;
    case '24h': from.setDate(from.getDate() - 1); break;
    case '3d': from.setDate(from.getDate() - 3); break;
    case '7d': from.setDate(from.getDate() - 7); break;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}
