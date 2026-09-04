import { useCallback, useEffect, useState, type ChangeEvent, type DragEvent } from 'react';
import { AlertTriangle, Film, GripVertical, Play, Trash2, Upload, X } from 'lucide-react';
import ReplayPanel from '@/components/ReplayPanel';
import ConfirmDialog from '@/components/ConfirmDialog';
import { parseRecording, type Recording } from '@/lib/replayEngine';
import { formatDuration } from '@/lib/utils';
import {
  deleteRecordings, libraryAvailable, listRecordings, loadRecording, reorderRecordings, saveRecording,
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
 * back to the file. The list below the player is that library: play an
 * entry, drag entries into the order you want, tick several and remove
 * them together. Removing deletes only our copy — see recordingLibrary
 * for why it's a copy and not a link to the file.
 */
export default function Replay() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileOver, setFileOver] = useState(false);
  const [library, setLibrary] = useState<RecordingMeta[]>([]);
  // Library trouble is reported separately from a bad file: playback
  // still works, only the "keep it for later" half is broken.
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  /** Entries the confirm dialog is asking about; null when it's closed. */
  const [pendingDelete, setPendingDelete] = useState<RecordingMeta[] | null>(null);
  /** The library row being dragged, while a reorder is in progress. */
  const [dragId, setDragId] = useState<string | null>(null);

  const refreshLibrary = useCallback(async () => {
    if (!libraryAvailable()) return;
    try {
      const list = await listRecordings();
      setLibrary(list);
      // A selection can't outlive its rows (removed here or in another tab).
      setSelected(prev => new Set([...prev].filter(id => list.some(m => m.id === id))));
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

  const playSaved = async (meta: RecordingMeta) => {
    try {
      const recording = await loadRecording(meta.id);
      if (!recording) {
        // The meta row outlived its data row — the only way that happens
        // is storage eviction, so drop the dangling entry too.
        await deleteRecordings([meta.id]);
        await refreshLibrary();
        setLibraryError(`“${meta.fileName}” is no longer in the library — its data was evicted by the browser.`);
        return;
      }
      play(recording, meta.fileName);
    } catch (e) {
      setLibraryError(e instanceof Error ? e.message : String(e));
    }
  };

  const confirmDelete = async () => {
    const doomed = pendingDelete ?? [];
    setPendingDelete(null);
    try {
      await deleteRecordings(doomed.map(m => m.id));
      await refreshLibrary();
    } catch (e) {
      setLibraryError(e instanceof Error ? e.message : String(e));
    }
  };
  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  const toggleSelected = (id: string, on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };
  const allSelected = library.length > 0 && library.every(m => selected.has(m.id));
  const selectedMetas = library.filter(m => selected.has(m.id));

  // Reordering: the row under the pointer swaps places with the dragged
  // one as it moves, so the list shows the new order live; the order is
  // written to the library once on drop.
  const onRowDragStart = (e: DragEvent<HTMLLIElement>, id: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id); // Firefox won't start a drag without payload
    setDragId(id);
  };
  const onRowDragOver = (e: DragEvent<HTMLLIElement>, overId: string) => {
    if (!dragId) return;
    e.preventDefault();
    if (dragId === overId) return;
    setLibrary(prev => {
      const from = prev.findIndex(m => m.id === dragId);
      const to = prev.findIndex(m => m.id === overId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };
  const onRowDragEnd = async () => {
    if (!dragId) return;
    setDragId(null);
    try {
      await reorderRecordings(library.map(m => m.id));
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
  // Only a file from outside the page lights the drop zone up — a library
  // row being dragged past it is not a recording to load.
  const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setFileOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Plan Replay</h1>
        <div className="flex items-center gap-4 text-sm text-zinc-400">
          <label className="flex items-center gap-1.5 hover:text-white cursor-pointer">
            <Upload size={14} /> {loaded ? 'Load another recording' : 'Load recording'}
            <input type="file" accept="application/json,.json" className="hidden" onChange={onPick} aria-label="Load recording" />
          </label>
          {loaded && (
            <button
              type="button"
              onClick={() => setLoaded(null)}
              className="flex items-center gap-1.5 hover:text-white"
              title="Close the player and go back to the drop zone"
            >
              <X size={14} /> Close replay
            </button>
          )}
        </div>
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
          onDragOver={e => { if (isFileDrag(e)) { e.preventDefault(); setFileOver(true); } }}
          onDragLeave={() => setFileOver(false)}
          onDrop={onDrop}
          className={`rounded-lg border border-dashed px-6 py-16 text-center transition-colors ${
            fileOver ? 'border-blue-500 bg-blue-500/5' : 'border-zinc-700 bg-zinc-900/40'
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h2 className="text-sm font-semibold text-zinc-300">Saved recordings</h2>
            <label className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={e => setSelected(e.target.checked ? new Set(library.map(m => m.id)) : new Set())}
                aria-label="Select all recordings"
              />
              Select all
            </label>
            {selectedMetas.length > 0 && (
              <span className="flex items-center gap-3 text-xs">
                <span className="text-zinc-400">{selectedMetas.length} selected</span>
                <button
                  type="button"
                  onClick={() => setPendingDelete(selectedMetas)}
                  className="flex items-center gap-1 text-red-400 hover:text-red-300"
                >
                  <Trash2 size={12} /> Remove selected
                </button>
              </span>
            )}
            <p className="ml-auto text-xs text-zinc-500">
              Kept in this browser. Drag to reorder. Removing deletes our copy, not the file you loaded.
            </p>
          </div>
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/40">
            {library.map(meta => (
              <li
                key={meta.id}
                draggable
                onDragStart={e => onRowDragStart(e, meta.id)}
                onDragOver={e => onRowDragOver(e, meta.id)}
                onDrop={e => e.preventDefault()}
                onDragEnd={() => void onRowDragEnd()}
                className={`flex items-center gap-3 px-3 py-2 text-xs ${
                  dragId === meta.id ? 'opacity-40' : ''
                } ${selected.has(meta.id) ? 'bg-blue-500/5' : ''}`}
              >
                <GripVertical size={14} className="shrink-0 cursor-grab text-zinc-600" aria-hidden />
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(meta.id)}
                    onChange={e => toggleSelected(meta.id, e.target.checked)}
                    aria-label={`Select ${meta.fileName}`}
                  />
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
                </label>
                <button
                  type="button"
                  onClick={() => void playSaved(meta)}
                  aria-label={`Play ${meta.fileName}`}
                  title="Play"
                  className="shrink-0 rounded p-1 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-400"
                >
                  <Play size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete([meta])}
                  aria-label={`Remove ${meta.fileName} from the library`}
                  title="Remove from library"
                  className="shrink-0 rounded p-1 text-zinc-600 hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={
          pendingDelete?.length === 1
            ? `Remove “${pendingDelete[0].fileName}” from the library?`
            : `Remove ${pendingDelete?.length ?? 0} recordings from the library?`
        }
        confirmLabel="Remove"
        onConfirm={() => void confirmDelete()}
        onCancel={cancelDelete}
      >
        {pendingDelete && pendingDelete.length > 1 && (
          <ul className="mb-2 max-h-40 overflow-y-auto font-mono text-zinc-300">
            {pendingDelete.map(m => <li key={m.id} className="truncate">{m.fileName}</li>)}
          </ul>
        )}
        Only our copy is deleted. The file it was loaded from stays where it is.
      </ConfirmDialog>
    </div>
  );
}
