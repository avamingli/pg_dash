import type { Recording } from '@/lib/replayEngine';

/**
 * A saved recording's index entry — everything the /replay library list
 * renders, without the frames.
 *
 * Kept in its own object store precisely so listing the library doesn't
 * have to read (and deserialize) every recording's frame array: a long
 * capture on a wide cluster is megabytes, and the list only ever needs
 * these ~8 fields.
 */
export interface RecordingMeta {
  /** The file name it was loaded from — see saveRecording for why that's the key. */
  id: string;
  fileName: string;
  /** Epoch ms this copy was taken. */
  savedAt: number;
  /** The SQL that was watched, verbatim from the recording (may be ''). */
  query: string;
  /** ISO timestamp of the original capture, verbatim (may be ''). */
  startedAt: string;
  frameCount: number;
  /** Recorded wall time: last frame's tsMs minus the first's. */
  durationMs: number;
  segments?: number;
  mode?: string;
}

const DB_NAME = 'pg_dash';
const DB_VERSION = 1;
const META_STORE = 'recording_meta';
const DATA_STORE = 'recording_data';

/**
 * True when this browser can hold a library at all. Private-mode Firefox
 * and any non-browser host (SSR, a bare jsdom test) have no indexedDB;
 * the replay page degrades to load-and-play rather than erroring.
 */
export function libraryAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!libraryAvailable()) {
    return Promise.reject(new Error('This browser has no IndexedDB, so recordings can\'t be kept.'));
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE, { keyPath: 'id' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('Could not open the recording library.'));
      // A second tab holding an older DB version blocks the upgrade
      // indefinitely; failing loudly beats a request that never settles.
      open.onblocked = () => reject(new Error('Another pg_dash tab is holding the recording library open — close it and retry.'));
    });
    // Don't cache a failed open: a later call should get to try again.
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Recording library request failed.'));
  });
}

/** Resolves once the writes are actually committed, not merely queued. */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Recording library write failed.'));
  });
}

function metaOf(fileName: string, recording: Recording, savedAt: number): RecordingMeta {
  const frames = recording.frames;
  return {
    id: fileName,
    fileName,
    savedAt,
    query: recording.query,
    startedAt: recording.startedAt,
    frameCount: frames.length,
    durationMs: frames.length > 0 ? frames[frames.length - 1].tsMs - frames[0].tsMs : 0,
    segments: recording.clusterInfo?.num_segments,
    mode: recording.clusterInfo?.mode,
  };
}

/**
 * Keep a copy of a recording so it can be replayed again later without
 * the original file.
 *
 * A *copy*, not a link: the browser never learns where a picked file
 * lives on disk, so there's nothing to point at. That's no loss here —
 * a recording is immutable once written, so a copy can't drift from the
 * original, and it keeps working after the JSON is moved, deleted, or
 * left on another machine.
 *
 * The file name is the key, so re-loading the same file updates its
 * entry instead of stacking near-identical rows. Two different captures
 * that happen to share a name collide, which the timestamped
 * `plan-snapshot-<ISO>.json` names the Watch panel writes make unlikely.
 */
export async function saveRecording(fileName: string, recording: Recording): Promise<RecordingMeta> {
  const meta = metaOf(fileName, recording, Date.now());
  const db = await openDb();
  // One transaction over both stores: a meta row whose data row failed
  // to write would show in the list and then refuse to play.
  const tx = db.transaction([META_STORE, DATA_STORE], 'readwrite');
  tx.objectStore(META_STORE).put(meta);
  tx.objectStore(DATA_STORE).put({ id: meta.id, recording });
  await committed(tx);
  return meta;
}

/** Every saved recording's index entry, newest copy first. */
export async function listRecordings(): Promise<RecordingMeta[]> {
  const db = await openDb();
  const tx = db.transaction(META_STORE, 'readonly');
  const all = await request<RecordingMeta[]>(tx.objectStore(META_STORE).getAll());
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

/** The full recording behind a library entry, or null if it's gone. */
export async function loadRecording(id: string): Promise<Recording | null> {
  const db = await openDb();
  const tx = db.transaction(DATA_STORE, 'readonly');
  const row = await request<{ id: string; recording: Recording } | undefined>(tx.objectStore(DATA_STORE).get(id));
  return row?.recording ?? null;
}

/**
 * Drop our copy of a recording. The JSON file it was loaded from is
 * never touched — we only ever had a copy of it.
 */
export async function deleteRecording(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META_STORE, DATA_STORE], 'readwrite');
  tx.objectStore(META_STORE).delete(id);
  tx.objectStore(DATA_STORE).delete(id);
  await committed(tx);
}
