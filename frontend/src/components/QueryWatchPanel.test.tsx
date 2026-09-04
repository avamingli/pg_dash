import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import fourJoin from '../../../docs/samples/four-join.json';
import { parseRecording, replayRecording, type Recording } from '@/lib/replayEngine';
import QueryWatchPanel from './QueryWatchPanel';

// The view is covered elsewhere; this file is about the recording the
// live driver writes, so the plan player is a stub.
vi.mock('@/components/PlanPlayer', () => ({ default: () => <div data-testid="plan-player" /> }));
vi.mock('@/contexts/metrics', () => ({
  useMetrics: () => ({ clusterInfo: { num_segments: 3, mode: 'cloudberry' } }),
}));
const getQueryProgress = vi.fn();
vi.mock('@/lib/api', () => ({ api: { getQueryProgress: (...a: unknown[]) => getQueryProgress(...a) } }));

const sample = parseRecording(fourJoin);
const POLL_MS = 800;

/**
 * Serve `n` of the sample's frames in order, then 404 like a backend whose
 * pid has gone. Starts at frame 1: the sample's frame 0 is the synthetic
 * "plan captured, no rows yet" poll, which the live panel reads as the
 * query having ended (empty nodes) — fine for the replay engine, which
 * waits for rows first, but not what a live backend hands out first.
 */
function serveFrames(n: number) {
  let i = 1;
  const end = 1 + n;
  getQueryProgress.mockImplementation(() =>
    i < end ? Promise.resolve(sample.frames[i++].progress) : Promise.reject(new Error('no active backend with that pid')),
  );
}

/** Intercept the Blob the Save button hands to an <a download>. */
function captureDownload(): () => Promise<Recording> {
  let blob: Blob | null = null;
  vi.stubGlobal('URL', Object.assign(Object.create(URL), {
    createObjectURL: (b: Blob) => { blob = b; return 'blob:test'; },
    revokeObjectURL: () => {},
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  return async () => {
    if (!blob) throw new Error('nothing was downloaded');
    return parseRecording(JSON.parse(await blob.text()));
  };
}

/** Let the poll the panel fires on mount settle, without firing another. */
async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
/** Advance to the next interval tick and let that poll settle. */
async function poll() {
  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
}

// Plain fake timers: with shouldAdvanceTime the interval would also tick
// on real time during awaits, and the count of polls — which is what
// these tests are about — would depend on how fast the machine is.
beforeEach(() => { vi.useFakeTimers(); getQueryProgress.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('QueryWatchPanel recording', () => {
  it('writes the 404 that ends a watched query into the recording as a terminal frame', async () => {
    serveFrames(4);
    const download = captureDownload();
    render(<QueryWatchPanel pid={4242} sql={sample.query} onClose={() => {}} />);
    await settle(); // the mount poll takes the first frame — panel is live, Record appears

    fireEvent.click(screen.getByTitle(/^Start recording/));
    await poll(); await poll(); await poll(); // three frames with rows
    await poll(); // the 404: query finished, recording auto-stops

    fireEvent.click(screen.getByTitle(/^Download/));
    const rec = await download();

    // Three live frames plus the ending we synthesised for the 404.
    expect(rec.frames).toHaveLength(4);
    expect(rec.frames[3].progress.nodes).toEqual([]);
    expect(rec.frames[3].progress.pid).toBe(4242);
    expect(rec.frames[3].progress.sess_id).toBe(rec.frames[2].progress.sess_id);
    expect(rec.frames[3].tsMs).toBeGreaterThan(rec.frames[2].tsMs);

    // And a replay of it actually ends, instead of running out of frames
    // with every slice still "running".
    const states = replayRecording(rec, 3);
    expect(states[states.length - 2].finished).toBe(false);
    expect(states[states.length - 1].finished).toBe(true);
  });

  it('does not invent an ending for a recording that never saw a frame', async () => {
    // Record armed, then the very first poll after it 404s: nothing was
    // captured, so there is nothing to end — and no Save to offer.
    serveFrames(1);
    render(<QueryWatchPanel pid={4242} sql={sample.query} onClose={() => {}} />);
    await settle(); // mount poll takes the only frame
    fireEvent.click(screen.getByTitle(/^Start recording/));
    await poll(); // 404 — recording never received a frame
    expect(screen.queryByTitle(/^Download/)).not.toBeInTheDocument();
  });
});
