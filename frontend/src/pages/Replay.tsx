import { useState, type ChangeEvent, type DragEvent } from 'react';
import { AlertTriangle, Film, Upload } from 'lucide-react';
import ReplayPanel from '@/components/ReplayPanel';
import { parseRecording, type Recording } from '@/lib/replayEngine';

interface Loaded {
  recording: Recording;
  /** Name of the file it came from — also the mount key, so re-loading restarts playback. */
  fileName: string;
}

/**
 * Offline playback of a Watch-panel recording. The Watch panel's ⏺
 * Record button writes a JSON file of every /progress response; drop
 * that file here and it plays back through the same pipeline, on any
 * pg_dash instance, with no live database and no MPP cluster involved —
 * which is the point (demos, README GIFs, bug repros).
 */
export default function Replay() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const loadFile = async (file: File) => {
    try {
      const recording = parseRecording(JSON.parse(await file.text()));
      setLoaded({ recording, fileName: file.name });
      setError(null);
    } catch (e) {
      // Both failure modes land here and both are worth showing
      // verbatim: a JSON syntax error (truncated download) and a schema
      // rejection (wrong file, future version) read very differently.
      setLoaded(null);
      setError(e instanceof Error ? e.message : String(e));
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

      {loaded ? (
        <>
          <div className="h-[calc(100vh-16rem)] min-h-[28rem]">
            {/* Keyed on the file: loading a different recording mounts a
                fresh panel rather than leaving the old playback cursor
                pointing into new frames. */}
            <ReplayPanel key={loaded.fileName} recording={loaded.recording} />
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
    </div>
  );
}
