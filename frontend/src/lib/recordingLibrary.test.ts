import { describe, it, expect, beforeEach } from 'vitest';
import fourJoin from '../../../docs/samples/four-join.json';
import { parseRecording, type Recording } from '@/lib/replayEngine';
import {
  deleteRecording, libraryAvailable, listRecordings, loadRecording, saveRecording,
} from '@/lib/recordingLibrary';

const sample = parseRecording(fourJoin);

function synthetic(overrides: Partial<Recording> = {}): Recording {
  return {
    version: 1,
    query: 'select 1',
    startedAt: '2026-09-01T00:00:00.000Z',
    clusterInfo: { num_segments: 3, mode: 'cloudberry' },
    // The library never looks inside a frame beyond its tsMs, so two
    // empty polls are enough to exercise the metadata it derives.
    frames: [
      { tsMs: 0, progress: { pid: 42, sess_id: 7, nodes: [] } },
      { tsMs: 2500, progress: { pid: 42, sess_id: 7, nodes: [] } },
    ],
    ...overrides,
  };
}

async function clearLibrary() {
  for (const meta of await listRecordings()) await deleteRecording(meta.id);
}

beforeEach(clearLibrary);

describe('recordingLibrary', () => {
  it('is available under the test environment', () => {
    expect(libraryAvailable()).toBe(true);
  });

  it('starts empty', async () => {
    expect(await listRecordings()).toEqual([]);
  });

  it('saves a recording and plays it back byte-identically', async () => {
    await saveRecording('four-join.json', sample);
    expect(await loadRecording('four-join.json')).toEqual(sample);
  });

  it('indexes what the list needs without reading the frames', async () => {
    const meta = await saveRecording('run.json', synthetic());
    expect(meta).toMatchObject({
      id: 'run.json',
      fileName: 'run.json',
      query: 'select 1',
      startedAt: '2026-09-01T00:00:00.000Z',
      frameCount: 2,
      durationMs: 2500, // last frame's tsMs minus the first's
      segments: 3,
      mode: 'cloudberry',
    });
    expect(meta).not.toHaveProperty('frames');
    expect(await listRecordings()).toEqual([meta]);
  });

  it('lists the newest copy first', async () => {
    await saveRecording('older.json', synthetic());
    await saveRecording('newer.json', synthetic());
    // Both saves can land in the same millisecond; assert on the field
    // the order is derived from rather than on wall-clock luck.
    const [first, second] = await listRecordings();
    expect(first.savedAt).toBeGreaterThanOrEqual(second.savedAt);
    expect(new Set([first.fileName, second.fileName])).toEqual(new Set(['older.json', 'newer.json']));
  });

  it('replaces an entry when the same file is loaded again, rather than stacking duplicates', async () => {
    await saveRecording('run.json', synthetic({ query: 'select 1' }));
    await saveRecording('run.json', synthetic({ query: 'select 2' }));
    const all = await listRecordings();
    expect(all).toHaveLength(1);
    expect(all[0].query).toBe('select 2');
    expect((await loadRecording('run.json'))?.query).toBe('select 2');
  });

  it('deletes both the index entry and the frames', async () => {
    await saveRecording('run.json', synthetic());
    await deleteRecording('run.json');
    expect(await listRecordings()).toEqual([]);
    expect(await loadRecording('run.json')).toBeNull();
  });

  it('leaves other recordings alone when one is deleted', async () => {
    await saveRecording('keep.json', synthetic({ query: 'keep' }));
    await saveRecording('drop.json', synthetic({ query: 'drop' }));
    await deleteRecording('drop.json');
    expect((await listRecordings()).map(m => m.fileName)).toEqual(['keep.json']);
    expect((await loadRecording('keep.json'))?.query).toBe('keep');
  });

  it('reports a miss rather than throwing for an id that was never saved', async () => {
    expect(await loadRecording('nope.json')).toBeNull();
  });
});
