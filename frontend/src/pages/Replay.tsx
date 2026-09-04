import { useCallback, useEffect, useState, type ChangeEvent, type DragEvent } from 'react';
import { AlertTriangle, Film, Trash2, Upload } from 'lucide-react';
import ReplayPanel from '@/components/ReplayPanel';
import { parseRecording, type Recording } from '@/lib/replayEngine';
import { formatDuration } from '@/lib/utils';
import {
  deleteRecording, libraryAvailable, listRecordings, loadRecording, saveRecording,
  type RecordingMeta,
} from '@/lib/recordingLibrary';

interface Loaded {
  recording: Recording;
  /** Name of the file it came from — shown under the player. */
  fileName: string;
  /** Bumped on every load so re-loading the same recording remounts the panel. */
  seq: number;
}

/**
 * Offline playback of a Watch-panel recording. The Watch panel's ⏺
 * Record button writes a JSON file of every /progress response; drop
 * that file here and it plays back through the same pipeline, on any
 * pg_dash instance, with no live database and no MPP cluster involved —
 * which is the point (demos, README GIFs, bug repros).
 *
 * Anything loaded is also kept in the browser's recording library
 * (IndexedDB) so the same run can be re-analysed later without going
 * back to the file. Removing a library entry deletes only our copy —
 * see recordingLibrary for why it's a copy and not a link to the file.
 */
export default function Replay() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [library, setLibrary] = useState<RecordingMeta[]>([]);
  // Library trouble is reported separately from a bad file: playback
  // still works, only the "keep it for later" half is broken.
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refreshLibrary = useCallback(async () => {
    if (!libraryAvailable()) return;
    try {
      setLibrary(await listRecordings());
      setLibraryError(null);
    } catch (e) {
      setLibraryError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // set-state-in-effect can't see that every setState in refreshLibrary
  // is behind an await on the IndexedDB round-trip — none of them run
  // synchronously in the effect body, so there are no cascading renders
  // to avoid here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshLibrary(); }, [refreshLibrary]);

  const play = (recording: Recording, fileName: string) => {
    setLoaded(prev => ({ recording, fileName, seq: (prev?.seq ?? 0) + 1 }));
    setError(null);
  };

  const loadFile = async (file: File) => {
    let recording: Recording;
    try {
      recording = parseRecording(JSON.parse(await file.text()));
    } catch (e) {
      // Both failure modes land here and both are worth showing
      // verbatim: a JSON syntax error (truncated download) and a schema
      // rejection (wrong file, future version) read very differently.
      setLoaded(null);
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    play(recording, file.name);
    // Saving is a side errand: a full quota or a blocked upgrade must
    // not stop the recording that just parsed from playing.
    if (!libraryAvailable()) return;
    try {
      await saveRecording(file.name, recording);
      setLibraryError(null);
      await refreshLibrary();
    } catch (e) {
      setLibraryError(e instanceof Error ? e.message : String(e));
    }
  };

  const openSaved = async (meta: RecordingMeta) => {
    try {
      const recording = await loadRecording(meta.id);
      if (!recording) {
        // The meta row outlived its data row — the only way that happens
        // is storage eviction, so drop the dangling entry too.
        await deleteRecording(meta.id);
        await refreshLibrary();
        setLibraryError(`“${meta.fileName}” is no longer in the library — its data was evicted by the browser.`);
        return;
      }
      play(recording, meta.fileName);
    } catch (e) {
      setLibraryError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeSaved = async (meta: RecordingMeta) => {
    setConfirmDelete(null);
    try {
      await deleteRecording(meta.id);
      await refreshLibrary();
    } catch (e) {
      setLibraryError(e instanceof Error ? e.message : String(e));
    }
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice re-loads it (and
    // restarts playback) instead of silently doing nothing.
    e.target.value = '';
    if (file) void loadFile(file);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Plan Replay</h1>
        <label className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white cursor-pointer">
          <Upload size={14} /> {loaded ? 'Load another recording' : 'Load recording'}
          <input type="file" accept="application/json,.json" className="hidden" onChange={onPick} aria-label="Load recording" />
        </label>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>Couldn't read that recording — {error}</span>
        </div>
      )}

      {libraryError && (
        <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>Recording library — {libraryError}</span>
        </div>
      )}

      {loaded ? (
        <>
          <div className="h-[calc(100vh-16rem)] min-h-[28rem]">
            {/* Keyed on the load, not just the file: a fresh panel mounts
                for every load — including re-opening the one already
                playing — rather than leaving the old playback cursor
                pointing into new frames. */}
            <ReplayPanel key={`${loaded.fileName}#${loaded.seq}`} recording={loaded.recording} />
          </div>
          <p className="text-xs text-zinc-500">Replaying <span className="font-mono text-zinc-400">{loaded.fileName}</span></p>
        </>
      ) : (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded-lg border border-dashed px-6 py-16 text-center transition-colors ${
            dragging ? 'border-blue-500 bg-blue-500/5' : 'border-zinc-700 bg-zinc-900/40'
          }`}
        >
          <Film size={28} className="mx-auto mb-3 text-zinc-600" />
          <p className="text-sm text-zinc-300">Drop a plan-snapshot JSON here, or use “Load recording”.</p>
          <p className="mx-auto mt-2 max-w-lg text-xs text-zinc-500">
            Recordings come from the Watch panel's ⏺ Record button (Activity Monitor or SQL Editor, while a
            query runs) and its 💾 Save. Playback needs no database connection — the file carries the plan,
            every polled snapshot and the cluster shape it ran on.
          </p>
        </div>
      )}

      {library.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-zinc-300">Saved recordings</h2>
            <p className="text-xs text-zinc-500">Kept in this browser. Removing one deletes our copy, not the file you loaded.</p>
          </div>
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/40">
            {library.map(meta => (
              <li key={meta.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                <button
                  type="button"
                  onClick={() => void openSaved(meta)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-white"
                >
                  <Film size={14} className="shrink-0 text-zinc-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-zinc-300">{meta.fileName}</span>
                    {meta.query && <span className="block truncate text-zinc-600">{meta.query}</span>}
                  </span>
                  <span className="shrink-0 text-zinc-500">
                    {meta.frameCount} frames · {formatDuration(meta.durationMs)}
                    {meta.segments !== undefined && ` · ${meta.segments} seg`}
                  </span>
                  <span className="hidden shrink-0 text-zinc-600 sm:inline">saved {new Date(meta.savedAt).toLocaleString()}</span>
                </button>
                {confirmDelete === meta.id ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <button type="button" onClick={() => void removeSaved(meta)} className="text-red-400 hover:text-red-300">
                      Remove
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(null)} className="text-zinc-500 hover:text-zinc-300">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(meta.id)}
                    aria-label={`Remove ${meta.fileName} from the library`}
                    className="shrink-0 text-zinc-600 hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
