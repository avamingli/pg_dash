import { describe, expect, it } from 'vitest';
import {
  advanceSliceTiming,
  computeCompletedSlices,
  EMPTY_SLICE_TIMING,
  summarizeSlices,
  type LiveNodeStats,
  type NodeCompletionState,
  type PlanNode,
} from './planTree';

// Helpers — build the two args advanceSliceTiming expects. `freshByNode`
// mirrors what QueryWatchPanel's aggregateByNode returns each poll (rows
// summed across segments, `growing` always false — the actual growth
// decision is advanceSliceTiming's own job, using prev.rawRows).
function fresh(rowsByNid: Record<number, number>): Record<number, LiveNodeStats> {
  const out: Record<number, LiveNodeStats> = {};
  for (const [nid, rows] of Object.entries(rowsByNid)) {
    out[Number(nid)] = { rows, segments: 1, growing: false };
  }
  return out;
}
function sliceMap(mapping: Record<number, number>): Map<number, number> {
  return new Map(Object.entries(mapping).map(([nid, sid]) => [Number(nid), sid]));
}

describe('advanceSliceTiming', () => {
  it('credits a slice on every poll where any node has rows > 0', () => {
    const s = sliceMap({ 10: 3, 11: 3 });
    let t = EMPTY_SLICE_TIMING;
    t = advanceSliceTiming(t, fresh({ 10: 100, 11: 0 }), s, 800);
    expect(t.activeMs).toEqual({ 3: 800 });
    t = advanceSliceTiming(t, fresh({ 10: 250, 11: 0 }), s, 800);
    expect(t.activeMs).toEqual({ 3: 1600 });
  });

  it('keeps crediting a slice whose Motion plateaued but stayed non-zero (dim-table finished early)', () => {
    // Motion 12 stuck at 124k for 4 polls — slice 4's gang is still alive
    // upstream, so credit it the whole time (this is the "slice completed
    // but sidebar showed 1%" bug the growth-only rule caused).
    const s = sliceMap({ 20: 4 });
    let t = advanceSliceTiming(EMPTY_SLICE_TIMING, fresh({ 20: 60000 }), s, 800);
    t = advanceSliceTiming(t, fresh({ 20: 60000 }), s, 800);
    t = advanceSliceTiming(t, fresh({ 20: 60000 }), s, 800);
    t = advanceSliceTiming(t, fresh({ 20: 60000 }), s, 800);
    expect(t.activeMs).toEqual({ 4: 3200 });
  });

  it('sticky-credits a slice that was once producing even if it later shows only zero-row placeholders', () => {
    // Poll 1: caught with rows > 0 → seenActive
    // Poll 2..N: nodes recycled to placeholder (rows=0), still in freshByNode
    //   → keep crediting on the sticky rule
    const s = sliceMap({ 30: 5 });
    let t = advanceSliceTiming(EMPTY_SLICE_TIMING, fresh({ 30: 42 }), s, 800);
    expect(t.activeMs).toEqual({ 5: 800 });
    // Now rows go to 0 (placeholder only) but the nid is still in fresh
    t = advanceSliceTiming(t, fresh({ 30: 0 }), s, 800);
    t = advanceSliceTiming(t, fresh({ 30: 0 }), s, 800);
    expect(t.activeMs).toEqual({ 5: 2400 });
  });

  it('does NOT credit a slice we never observe with rows > 0', () => {
    // Regression guard for the "presence-based inflates everything to 99%"
    // case: coord dispatcher rows are 0/1 from query start to end, so
    // presence would falsely credit every slice for basically the whole
    // query. Rows-based skips them honestly.
    const s = sliceMap({ 40: 6 });
    let t = EMPTY_SLICE_TIMING;
    for (let i = 0; i < 10; i++) {
      t = advanceSliceTiming(t, fresh({ 40: 0 }), s, 800);
    }
    expect(t.activeMs[6]).toBeUndefined();
    expect(t.seenActive.has(6)).toBe(false);
  });

  it('stops crediting once a sticky-credited slice disappears from freshByNode entirely', () => {
    // Once the gang tears down, the nid is gone from shmem entirely —
    // slice loses its sticky credit even though seenActive still remembers.
    const s = sliceMap({ 50: 7 });
    let t = advanceSliceTiming(EMPTY_SLICE_TIMING, fresh({ 50: 12345 }), s, 800);
    t = advanceSliceTiming(t, fresh({ 50: 12345 }), s, 800);
    expect(t.activeMs).toEqual({ 7: 1600 });
    // Nid 50 is no longer reported this poll
    t = advanceSliceTiming(t, fresh({}), s, 800);
    expect(t.activeMs).toEqual({ 7: 1600 });
    expect(t.seenActive.has(7)).toBe(true); // memory stays, credit doesn't
  });

  it('carries prev activeMs forward for slices not observed this poll', () => {
    const s = sliceMap({ 10: 3, 20: 4 });
    let t = advanceSliceTiming(EMPTY_SLICE_TIMING, fresh({ 10: 100, 20: 5 }), s, 800);
    expect(t.activeMs).toEqual({ 3: 800, 4: 800 });
    // Slice 4's nid disappears (gang gone); slice 3 keeps rolling
    t = advanceSliceTiming(t, fresh({ 10: 200 }), s, 800);
    expect(t.activeMs).toEqual({ 3: 1600, 4: 800 });
  });

  it('ignores freshByNode.growing entirely (it is always false at this point)', () => {
    // Regression guard: an earlier version keyed off stats.growing, but
    // aggregateByNode fills it as false — that broke slice timing silently
    // (every slice showed 0%). This test locks in that our own diff runs
    // regardless.
    const s = sliceMap({ 40: 6 });
    const withRows: Record<number, LiveNodeStats> = { 40: { rows: 500, segments: 3, growing: false } };
    const t = advanceSliceTiming(EMPTY_SLICE_TIMING, withRows, s, 800);
    expect(t.activeMs[6]).toBe(800);
  });
});

describe('summarizeSlices', () => {
  // A stand-in for buildRealPlanTree's output — each slice_id key gets
  // one dummy PlanNode. summarizeSlices only needs the id side of the
  // Map<PlanNode, number> to enumerate ids in sorted order.
  function makeSliceIds(ids: number[]): Map<PlanNode, number> {
    const m = new Map<PlanNode, number>();
    for (const id of ids) {
      m.set({ 'Node Type': `dummy-${id}`, Plans: [] } as PlanNode, id);
    }
    return m;
  }

  it('caps a running slice below 100% even when it was active the entire wall clock', () => {
    // 100% is reserved for the ✓ done state — a running slice credited
    // every poll can't hit it, otherwise the number and the (missing) ✓
    // badge disagree. This is the "slice 3 still running but shows 100%"
    // bug from the demo query.
    const ids = makeSliceIds([1, 2]);
    const out = summarizeSlices(ids, { 1: 60_000, 2: 60_000 }, 60_000);
    expect(out).toHaveLength(2);
    expect(out[0].pct).toBe(99);
    expect(out[1].pct).toBe(99);
    expect(out[0].completed).toBe(false);
  });

  it('gives running slice pct = activeMs / runTimeMs * 100 (capped at 99)', () => {
    const ids = makeSliceIds([3, 4]);
    const out = summarizeSlices(ids, { 3: 90_000, 4: 12_000 }, 100_000);
    expect(out[0]).toMatchObject({ id: 3, activeMs: 90_000, pct: 90 });
    expect(out[1]).toMatchObject({ id: 4, activeMs: 12_000, pct: 12 });
  });

  it('handles a slice with no observed activity as 0%', () => {
    const ids = makeSliceIds([5, 6]);
    const out = summarizeSlices(ids, { 5: 30_000 }, 50_000);
    // Slice 6 never accumulated any activeMs
    expect(out.find(s => s.id === 6)?.pct).toBe(0);
    expect(out.find(s => s.id === 6)?.activeMs).toBe(0);
  });

  it('threads completedSlices into SliceSummary.completed', () => {
    const ids = makeSliceIds([1, 2, 3]);
    const out = summarizeSlices(ids, {}, 10_000, new Set([2]));
    expect(out.find(s => s.id === 1)?.completed).toBe(false);
    expect(out.find(s => s.id === 2)?.completed).toBe(true);
    expect(out.find(s => s.id === 3)?.completed).toBe(false);
  });

  it('floors a completed slice at 100% even if observed activity was less', () => {
    // Regression: a slice whose gang tore down a poll or two before the
    // query officially ended would lose its sticky credit for the final
    // interval(s) and show "98% ✓ done" — the badge and the number
    // disagreed. Same rule as the node detail panel: completed = ≥100%.
    const ids = makeSliceIds([4]);
    const out = summarizeSlices(ids, { 4: 26_400 }, 27_000, new Set([4]));
    expect(out[0].pct).toBe(100);
    expect(out[0].completed).toBe(true);
  });

  it('preserves >100% for completed slices that over-credited (sticky held on)', () => {
    // If sticky rule kept crediting a slice past the query's own runtime
    // (rare but possible when a Motion's slot lingered after the last
    // poll), don't clamp — the overshoot is real signal about how long
    // the slice's gang stayed alive vs the total wall clock.
    const ids = makeSliceIds([5]);
    const out = summarizeSlices(ids, { 5: 30_000 }, 25_000, new Set([5]));
    expect(out[0].pct).toBe(120);
  });

  it('still clamps to 99% for non-completed slices even when activeMs exceeds runTime', () => {
    // A slice not marked completed can never hit or exceed 100%: 100 is
    // the visual signal for done, and a running slice must never usurp
    // it — even if its accumulated activeMs momentarily overshoots
    // runTimeMs (poll rounding, sticky rule holding on one tick too long).
    const ids = makeSliceIds([6]);
    const out = summarizeSlices(ids, { 6: 30_000 }, 25_000);
    expect(out[0].pct).toBe(99);
  });
});

describe('computeCompletedSlices', () => {
  // Build a sliceIds map where each slice has one node with a chosen state.
  function build(entries: Array<{ nid: number; sliceId: number; state: NodeCompletionState }>) {
    const sliceIds = new Map<PlanNode, number>();
    const states: Record<number, NodeCompletionState> = {};
    for (const { nid, sliceId, state } of entries) {
      sliceIds.set({ 'Node Type': `n-${nid}`, Nid: nid, Plans: [] } as PlanNode, sliceId);
      states[nid] = state;
    }
    return { sliceIds, states };
  }

  it('marks slice as completed when any node is state=completed', () => {
    const { sliceIds, states } = build([
      { nid: 10, sliceId: 3, state: 'active' },
      { nid: 20, sliceId: 4, state: 'completed' },
      { nid: 30, sliceId: 5, state: 'idle' },
    ]);
    const done = computeCompletedSlices(sliceIds, states);
    expect(done.has(3)).toBe(false); // still running
    expect(done.has(4)).toBe(true);  // topology says done
    expect(done.has(5)).toBe(false); // no evidence either way
  });

  it('returns empty set when sliceIds is null', () => {
    expect(computeCompletedSlices(null, {})).toEqual(new Set());
  });

  it('skips slice nodes with no Nid (parsePlan path, EXPLAIN JSON)', () => {
    const sliceIds = new Map<PlanNode, number>();
    sliceIds.set({ 'Node Type': 'x', Plans: [] } as PlanNode, 1); // no Nid
    const done = computeCompletedSlices(sliceIds, { 999: 'completed' });
    expect(done.size).toBe(0);
  });
});
