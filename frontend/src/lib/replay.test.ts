import { describe, expect, it } from 'vitest';
import fourJoin from '../../../docs/samples/four-join.json';
import { parseRecording, replayRecording, ReplayError, type Recording } from './replayEngine';
import type { NodeCompletionState } from './planTree';

// The primary fixture: a 15-frame, ~12.6s recording of a 4-way join on a
// 3-segment cluster (docs/samples/README.md has the full story). Imported
// straight from docs/samples — the same bytes the replay page loads, so a
// sample that stops round-tripping fails here rather than in a demo. It
// goes through parseRecording like any uploaded file would, which is also
// what turns the untyped JSON into a Recording.
function loadFixture(): Recording {
  return parseRecording(fourJoin);
}

const SEGMENTS = 3;
const RANK: Record<NodeCompletionState, number> = { idle: 0, active: 1, completed: 2 };

describe('parseRecording', () => {
  it('accepts the shipped v1 sample', () => {
    const rec = loadFixture();
    expect(rec.version).toBe(1);
    expect(rec.frames).toHaveLength(15);
    expect(rec.clusterInfo).toEqual({ num_segments: 3, mode: 'cloudberry' });
    expect(rec.query).toContain('FROM nations n');
  });

  it('rejects a recording from a future schema version', () => {
    expect(() => parseRecording({ version: 2, frames: [] })).toThrow(ReplayError);
    expect(() => parseRecording({ version: 2, frames: [] })).toThrow(/version 2/);
  });

  it('rejects junk that is not a recording at all', () => {
    expect(() => parseRecording(null)).toThrow(ReplayError);
    expect(() => parseRecording({ version: 1 })).toThrow(/frames/);
    expect(() => parseRecording({ version: 1, frames: [] })).toThrow(/no frames/);
    expect(() => parseRecording({ version: 1, frames: [{ tsMs: 0 }] })).toThrow(/Frame 0 is malformed/);
  });
});

describe('replayRecording — four-join sample', () => {
  const states = replayRecording(loadFixture(), SEGMENTS);
  const last = states[states.length - 1];

  it('produces one state per frame, in recording order', () => {
    expect(states).toHaveLength(15);
    expect(states.map(s => s.frameIndex)).toEqual([...Array(15).keys()]);
    expect(states.map(s => s.tsMs)).toEqual([...Array(15).keys()].map(i => i * 900));
  });

  it('reads the plan off the first frame even though it carries no instrument rows', () => {
    // The sample's frame 0 is the "plan captured, shmem still empty" first
    // poll. Live, an empty `nodes` means the query ended — but that can
    // only be true after we have seen rows, so the replay must not end
    // here (and must still pick up the plan tree).
    const first = states[0];
    expect(first.finished).toBe(false);
    expect(first.realPlan).toBeDefined();
    expect(first.liveNodes).toEqual({});
    expect(first.rootMeta).toEqual({ nid: 1, estRows: 20 });
    expect(first.sliceIds && new Set(first.sliceIds.values())).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it('infers the two never-observed dim slices as done (Rule B)', () => {
    // s4 (nations) and s6 (products) finish between polls: no frame ever
    // catches one of their nodes with rows > 0, so they never enter
    // seenActive and their activeMs stays 0 — but their plan parents
    // complete, which is what Rule B keys on.
    expect([...last.sliceTiming.seenActive].sort()).toEqual([1, 2, 3, 5]);
    expect(last.currentlyCompleted.has(4)).toBe(true);
    expect(last.currentlyCompleted.has(6)).toBe(true);
    expect(last.completedFrozenMs[4]).toBe(0);
    expect(last.completedFrozenMs[6]).toBe(0);
  });

  it('completes the fact-scan slices mid-run and freezes their activeMs there (Rule A)', () => {
    const doneAt = (sid: number) => states.findIndex(s => s.currentlyCompleted.has(sid));
    expect(doneAt(3)).toBe(6);   // orders scan winds down around 5.4s
    expect(doneAt(5)).toBe(9);   // lineitem scan runs longer, ~8.1s
    // Frozen at the activeMs the slice had when it first read done — not
    // the wall clock, which keeps climbing to the end of the recording.
    expect(last.completedFrozenMs[3]).toBe(4500);
    expect(last.completedFrozenMs[5]).toBe(7200);
    expect(last.sliceTiming.activeMs[3]).toBe(11700);
    expect(last.sliceTiming.activeMs[5]).toBe(11700);
  });

  it('never marks the coord slice done without a finished signal', () => {
    // s1 is the Gather receiver: nothing above it can ever be observed
    // holding its rows, so only the query actually ending would complete
    // it. The sample was stopped while the query still ran.
    expect(states.every(s => !s.currentlyCompleted.has(1))).toBe(true);
    expect(last.finished).toBe(false);
    expect([...last.currentlyCompleted].sort()).toEqual([2, 3, 4, 5, 6]);
  });

  it('accumulates slice active time from the frames own timestamps', () => {
    // dt comes from tsMs deltas, so the numbers are the recorded wall
    // clock regardless of how fast playback runs. s2 spans the whole
    // recording; s1 only lights up once the Gather starts receiving.
    expect(last.sliceTiming.activeMs).toEqual({ 1: 3600, 2: 12600, 3: 11700, 5: 11700 });
    expect(last.runTimeMs).toBe(12600);
  });

  it('tracks memory and the root row count through to the last frame', () => {
    expect(states[1].memoryMb).toBe(144);
    expect(states[11].memoryMb).toBe(744);  // peak, before the decay tail
    expect(last.memoryMb).toBe(264);
    expect(last.liveNodes[1]).toEqual({ rows: 20, segments: 3, growing: true });
  });

  it('keeps rows and node states monotonic across every frame', () => {
    for (let i = 1; i < states.length; i++) {
      for (const [nidStr, stats] of Object.entries(states[i - 1].liveNodes)) {
        expect(states[i].liveNodes[Number(nidStr)].rows).toBeGreaterThanOrEqual(stats.rows);
      }
      for (const [nidStr, state] of Object.entries(states[i - 1].nodeStates)) {
        expect(RANK[states[i].nodeStates[Number(nidStr)]]).toBeGreaterThanOrEqual(RANK[state]);
      }
    }
  });

  it('marks finished only when a frame with rows is followed by an empty one', () => {
    const rec = loadFixture();
    const terminal = replayRecording({
      ...rec,
      frames: [...rec.frames, { tsMs: 13500, progress: { ...rec.frames[0].progress, nodes: [] } }],
    }, SEGMENTS);
    expect(terminal).toHaveLength(16);
    expect(terminal[14].finished).toBe(false);
    expect(terminal[15].finished).toBe(true);
    // The terminal frame carries no new rows — the last real snapshot is
    // what stays on screen, exactly as the live panel freezes it.
    expect(terminal[15].liveNodes).toEqual(terminal[14].liveNodes);
    expect(terminal[15].sliceTiming.activeMs).toEqual(terminal[14].sliceTiming.activeMs);
  });

  it('survives a serialize/deserialize round-trip unchanged', () => {
    // Guards the file format itself: what the Watch panel writes out and
    // what the replay page reads back must fold to the same state.
    const rebuilt = replayRecording(parseRecording(JSON.parse(JSON.stringify(loadFixture()))), SEGMENTS);
    const shape = (s: (typeof states)[number]) => ({
      liveNodes: s.liveNodes,
      activeMs: s.sliceTiming.activeMs,
      seenActive: [...s.sliceTiming.seenActive].sort(),
      done: [...s.currentlyCompleted].sort(),
      frozen: s.completedFrozenMs,
      nodeStates: s.nodeStates,
      memoryMb: s.memoryMb,
      finished: s.finished,
      runTimeMs: s.runTimeMs,
    });
    expect(rebuilt.map(shape)).toEqual(states.map(shape));
  });
});
