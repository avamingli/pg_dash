# Live Plan Snapshot Record & Replay

Handoff doc for **Phase 2 (replay)** of the Watch-panel snapshot feature. Phase 1 (record + download) is shipped; this doc has everything a fresh session needs to build Phase 2 without spelunking the whole codebase.

> **Status: Phase 2 shipped.** The five steps under "Suggested implementation order" are done — `PlanPlayer` (extracted view), `lib/replayEngine.ts` (`parseRecording` + `replayRecording`), `ReplayPanel` (play / pause / restart / 0.5-4x / scrub), and the `/replay` page with file-picker + drag-drop. Tests: `frontend/src/lib/replay.test.ts` (fixture end-to-end + round-trip), `ReplayPanel.test.tsx`, `pages/Replay.test.tsx`.
>
> Three things landed differently from the design below, each for a reason recorded at the code:
> - `aggregateByNode` / `mergeLiveNodes` moved out of `QueryWatchPanel.tsx` into **`frontend/src/lib/planAggregate.ts`** — both drivers need them and a component file can't export non-components without breaking Fast Refresh. `planTree.ts` is untouched, as planned.
> - Playback speed changes only the **wait between frames**, never `dtMs`: the engine folds slice timing from the frames' own `tsMs`, so the figures at frame N are identical at 1x and 4x. (The design suggested dividing `dtMs`, which would make 4x report different slice times than the run it recorded.)
> - `finished` is never synthesized at the end of the frame list — only a frame with empty `nodes` *after* a frame with rows ends a replay. A recording stopped by hand genuinely doesn't know how its query ended, and claiming otherwise flips every slice to done via the finished→all-done fallback.
>
> Still deferred: the sample gallery, sharing, editing, side-by-side compare.

> **Follow-up shipped: the recording library.** Anything loaded on /replay is now kept in the browser (IndexedDB, `frontend/src/lib/recordingLibrary.ts`) and listed under the player, so a run can be re-analysed later without the file. Three things worth knowing:
>
> - It stores a **copy, not a link**. A picked `File` carries no path, so there is nothing durable to point at — only the File System Access API can hand back a re-openable handle, and that is Chromium-only. No loss either way: a recording is immutable once written, so a copy can't drift from the original, and it survives the JSON being moved, deleted, or left on another machine.
> - Metadata and frames live in **two object stores** (`recording_meta`, `recording_data`), written in one transaction. Listing the library reads only the small rows; a long capture's frames are never deserialized to render a list.
> - The **file name is the key**, so re-loading the same file updates its entry instead of stacking near-duplicates. Removing an entry deletes our copy and nothing else — the file it came from was never ours to touch — which is why the list says so and every removal goes through a confirm dialog.
> - The list is a **small library UI**, not just a list: an explicit ▶ Play per row (clicking a row selects it), checkboxes with a Select-all and a batch Remove, and drag-to-reorder whose order is persisted as an optional `position` on the meta row (entries without one sort newest-first, where they always were). A ✕ Close replay in the page header returns to the drop zone without touching the library.
>
> Sharing is still deferred, and the shape above is what a server-side library would replace: swap the four `recordingLibrary` functions for REST calls and the page itself doesn't change.

## Why this exists

Live visual plan progression is only visible while a query is running against a real MPP cluster. That makes it awkward for demos, README GIFs, LinkedIn posts, and bug repros — the moment you want to show is gone by the time you can screenshot it.

Snapshot record & replay lets any pg_dash instance replay a captured run without needing a live database — feed a JSON file back into the exact same aggregation pipeline the live view uses, and everything (progress bars, slice colors, done inference, Motion animations) plays back identically.

## Phase 1: what's already shipped

Commit `8a9f928` (Watch panel: capture /progress polls to a downloadable JSON recording).

**UI**: three buttons in the Watch panel header, right of the "live" badge:

- **⏺ Record** — appears when the query is running and not currently recording
- **⏹ Recording · N frames** — active during recording, click to stop
- **💾 Save** — appears after a recording exists, downloads it

**Auto-stop**: recording stops automatically when the query finishes (backend returns 404 → `finished=true`), so the ⏺ button is never left "hot" indefinitely.

**File shape** — one `.json` per recording, named `plan-snapshot-<ISO-timestamp>.json`:

```ts
interface Recording {
  version: 1;
  query: string;                  // the SQL that was watched
  startedAt: string;              // ISO timestamp of recording start
  clusterInfo: {                  // enough to reproduce Motion N:M labels
    num_segments?: number;
    mode?: string;                // 'cloudberry' | 'greenplum' | 'postgresql'
  };
  frames: RecordedFrame[];
}
interface RecordedFrame {
  tsMs: number;                   // ms offset from recording start
  progress: QueryProgress;        // raw /api/queries/{pid}/progress response
}
```

**Key implementation choices** (all in `frontend/src/components/QueryWatchPanel.tsx` ~lines 13-200):

- Frames are captured **before** any aggregation — `progress` is the exact wire response. This is critical for replay: feeding the same shape into the same aggregation pipeline reproduces the exact same UI, no drift.
- `recordingRef` is a ref (not state) so the poll callback's `useCallback` deps stay stable — starting/stopping recording doesn't tear down and re-arm the interval, which would lose frames across the seam.
- Blob → object URL → `<a download>` click for the save path; no external dep.

## The aggregation pipeline (what replay needs to feed)

Live path today:

```
POST /api/queries/{pid}/progress (every 800ms)
     ↓ QueryProgress { plan, nodes, sess_id, mem_mb, has_finished, ... }
QueryWatchPanel.poll() at ~line 250
     ├─ setRealPlan(progress.plan)                    ← first poll only
     ├─ aggregateByNode(progress.nodes)               ← sum ntuples+tuplecount per nid, across segments
     ├─ setLiveNodes(mergeLiveNodes(prev, fresh))     ← merge with growing bit
     ├─ setSliceTiming(advanceSliceTiming(...))       ← per-slice active ms + seenActive sticky
     └─ setMemoryMb / setLastPollAt / etc.
```

All the derived state that drives the UI is computed from those state updates:

- `root = buildRealPlanTree(realPlan, segmentsCount)` — a `useMemo` in `QueryWatchPanel.tsx`
- `nodeStates = computeNodeCompletionStates(root, liveNodes, priorNodeStatesRef.current)` — monotonic per-node states (**mutates the ref**, see gotcha below)
- `currentlyCompleted = computeCompletedSlices(sliceIds, nodeStates, parentNidBySlice)` — slice done set
- `sliceSummaries` — the sidebar rows
- `PlanGraph` — the visualization

**Replay just needs to drive the state updates in the correct order at the correct times.** The rest of the pipeline is reused as-is.

## Sticky/monotonic state — the biggest gotcha

Several pieces of state are intentionally **monotonic across polls** and must be preserved in the same order for replay to match live:

| State | Location | Behavior |
|---|---|---|
| `priorNodeStatesRef` | `QueryWatchPanel.tsx` useRef | Max-rank fold of prior node states (idle<active<completed). **Mutated inside a `useMemo`** — replay must run frames sequentially, can't skip. |
| `liveNodes.rows` | via `mergeLiveNodes` | `Math.max(existing, stats)` — rows never decrease. |
| `liveNodes.growing` | via `mergeLiveNodes` | `stats.rows > existing.rows` — depends on previous frame. |
| `sliceTiming.activeMs` | `advanceSliceTiming` | Accumulated per-slice. dt is the poll interval. |
| `sliceTiming.seenActive` | `advanceSliceTiming` | Sticky "this slice was ever observed producing" — never removed. |
| `completedFrozenMs` | `QueryWatchPanel.tsx` useState | Snapshot of activeMs at first-done for each slice. First-seen wins. |

**Implication for replay**: no random-access seeking. To scrub to frame N, replay must apply frames 0…N in order. This is fine for our use case (recordings are tens of frames, not thousands) — but don't try to build a scrubber that jumps arbitrarily without re-running from the start.

Simplest scrubber: keep the whole state history in an array (one entry per frame after processing), and drop back to index N to seek. Memory is negligible (100 frames × ~10KB state each ≈ 1MB).

## Phase 2: scope

**In scope:**

1. Replay engine: given a `Recording`, drive the QueryWatchPanel's state updates as if the frames were coming from live polls.
2. Upload UI: a file picker (drag-drop optional but nice) to load a `.json` recording.
3. Playback controls: ▶ / ⏸ / ⏮ (restart) / speed multiplier (0.5×, 1×, 2×, 4×) / scrub bar.
4. A place in the app to launch it — see "UI integration" below.

**Out of scope for Phase 2** (defer to later):

- Sample *gallery UI* (a picker of built-in recordings on the /replay page). Note: sample recordings themselves already exist as fixtures — see "Test fixtures" below — Phase 2 just needs to consume them, not gallery-render them.
- Sharing (upload to a server, share links)
- Editing recordings (trim, annotate)
- Comparing two recordings side-by-side

## Test fixtures

Canned `Recording` JSONs live in [`docs/samples/`](./samples/) with a paired `.mjs` generator each. See [`docs/samples/README.md`](./samples/README.md) for the table of what's available.

Today: **`docs/samples/four-join.json`** — 15 frames, ~12.6 s, 7 slices, exercises Rule B (fast dim slices s4/s6 never observed) + Rule A (fact-scan slices s3/s5 finish mid-run) + coord-slice-never-completes-without-finished-signal. This is the primary fixture Phase 2 should build against — if the replay engine plays it back and the sidebar/graph match what the "sanity-check" script prints, the pipeline round-trip is proven.

Load it in `ReplayPanel` with a plain `fetch('/samples/four-join.json')` during dev (put the samples dir behind a static route, or copy to `frontend/public/samples/`), or import directly in tests with `import fixture from '../../../docs/samples/four-join.json'`.

Add a Vitest case that runs the fixture end-to-end and asserts on final slice-done membership + activeMs (see the sanity-check numbers in the samples README for expected values).

## Design decisions to make

### 1. Where does the replay UI live?

**Recommend: a new page `/replay`** in the sidebar (or nested under an existing group). Reasons:

- Watch panel today needs a `pid` (live query). Reusing it forces awkward stub props.
- A dedicated page can host the file picker, playback controls, and full-screen graph without competing for space.
- Keeps the Watch panel's live poll logic clean.

Alternative: overlay on the Watch panel using a "load recording" button. Simpler surface but muddies two concerns.

### 2. Component factoring

The Watch panel currently owns both the polling loop and the rendering. Split into:

- **`PlanPlayer`** (new) — pure presentational: takes `{ realPlan, liveNodes, sliceTiming, sliceIds, parentNidBySlice, nodeStates, currentlyCompleted, memoryMb, finished, runTimeMs }` and renders the exact same UI (sidebar + graph). No polling.
- **`QueryWatchPanel`** — live driver: polls, updates state, renders `<PlanPlayer {...state} />`.
- **`ReplayPanel`** — replay driver: loads a `Recording`, walks frames, updates state at the recorded cadence (or accelerated), renders `<PlanPlayer {...state} />`.

This extraction is the single biggest refactor Phase 2 needs. Keep the aggregation pipeline (`aggregateByNode`, `mergeLiveNodes`, `advanceSliceTiming`) in `planTree.ts` where it already lives — both drivers call it the same way.

### 3. Playback timing model

Frames have `tsMs` (ms since recording start). Two ways to drive:

- **Real-time**: `setTimeout(nextFrame, frame.tsMs - prev.tsMs)`. Matches the original wall-clock feel.
- **Frame-stepped**: fire frames as fast as possible × speed multiplier. Better for demos (skip idle stretches).

**Recommend both**, controlled by the speed slider. 1× = real-time; other speeds = accelerated frame-stepped with `dtMs = (frame.tsMs - prev.tsMs) / speedMultiplier`, passed into `advanceSliceTiming` unchanged so slice-timing math still adds up.

### 4. Seek / scrub

Because the pipeline is monotonic (see gotcha table), seeking to frame N requires replaying frames 0…N. Simple approach: **cache post-frame state in an array**, index into it on scrub. Rebuilding from scratch takes ≪ 1s even for a long recording — but caching avoids the flicker.

## Suggested implementation order

Each step is a stopping point with a working demo.

1. **Extract `PlanPlayer`** from `QueryWatchPanel`. Pure props-in, no side effects. `QueryWatchPanel` renders `<PlanPlayer />`. Live behavior unchanged. Commit here. (~1-2 hours; the risk is missing a state var — grep for every setter in `QueryWatchPanel` and make sure the corresponding value is either derived or a prop of `PlanPlayer`.)

2. **Build `ReplayPanel` scaffold** — takes a `Recording`, renders `<PlanPlayer />` with the FINAL frame's state (walk all frames sequentially through the pipeline, feed the last result). No playback yet — just proves the pipeline round-trips correctly. Commit.

3. **Add playback loop** — ▶ / ⏸ / current-frame index, driven by a `requestAnimationFrame` or `setTimeout` loop that steps through frames at real-time. Commit.

4. **Add speed + scrub bar**. Cache per-frame state array for fast scrubbing. Commit.

5. **Route + file upload UI** — a `/replay` page with a file input, "Load recording" state, and the `ReplayPanel` mounted when a file is loaded. Commit.

## Test strategy

`planTree.test.ts` already covers the aggregation math. For replay-specific tests, add a new file:

- `replay.test.ts` — feed a canned `Recording` through the pipeline, assert the final `nodeStates`/`sliceTiming` match hand-computed expectations. Guards against pipeline drift.
- Round-trip test: capture a synthetic frame series → serialize → deserialize → replay → assert state matches. Guards the file format.

For the UI side, the existing Vitest + React Testing Library setup is enough; test file loading (with a mocked File) and playback controls.

## Files that will change

**Extract**:
- `frontend/src/components/QueryWatchPanel.tsx` — most of its render body moves to `PlanPlayer`.

**New**:
- `frontend/src/components/PlanPlayer.tsx`
- `frontend/src/components/ReplayPanel.tsx`
- `frontend/src/pages/Replay.tsx`
- `frontend/src/lib/replayEngine.ts` (or inline in `ReplayPanel` if small enough)
- `frontend/src/lib/replay.test.ts`

**Small edits**:
- `frontend/src/pages/Sidebar` (add nav entry) — location depends on where the sidebar registers routes.
- `frontend/src/App.tsx` (or wherever routes are declared) — add `/replay` route.

**Don't change**:
- `frontend/src/lib/planTree.ts` — the aggregation pipeline is stable; replay uses it as-is.
- Backend — this is entirely a frontend feature, replay reads local files.

## Related code — quick jumps

Use `grep` (or your editor's symbol search) rather than line numbers — line numbers drift; symbol names are stable.

- Recording types (`RecordedFrame`, `Recording`) — `frontend/src/components/QueryWatchPanel.tsx`, search `interface RecordedFrame`.
- Recording UI (⏺ / ⏹ / 💾 buttons + `startRecording`/`stopRecording`/`downloadRecording`) — same file, search `startRecording =`.
- Poll loop — same file, search `const poll = useCallback`.
- `aggregateByNode` / `mergeLiveNodes` (per-poll aggregation) — same file, top-level functions.
- `advanceSliceTiming` (per-slice active ms, sticky `seenActive`) — `frontend/src/lib/planTree.ts`, exported.
- `computeNodeCompletionStates` (per-node state, monotonic max-rank fold with `priorStates`) — same file, exported. **Mutates the caller's `priorStates` state — see gotcha table.**
- `computeCompletedSlices` (per-slice done, Rules A+B) — same file, exported.
- `computeParentNidBySlice` (needed by Rule B) — same file, exported.
- Sidebar rows — `frontend/src/components/SliceSummaryPanel.tsx`.
- Graph — `frontend/src/components/PlanGraph.tsx`.
- Type definitions consumed by the wire format — `frontend/src/types/metrics.ts`, search `interface QueryProgress` / `QueryProgressNode` / `QueryProgressPlanNode`.

Tests for the pipeline pieces — `frontend/src/lib/planTree.test.ts`. Phase 2's new tests should live in `frontend/src/lib/replay.test.ts` next to them.

## Open questions to resolve during implementation

- Should the replay page also show the raw SQL and cluster metadata from the recording? (Recommend: yes, small header above the graph.)
- Should we validate recordings on load (schema version check)? (Recommend: yes, at least check `version === 1` and reject with a friendly error otherwise.)
- Does the sample-gallery deferral survive Phase 2 review, or should we bundle at least one demo recording with the app? (Recommend: bundle one after Phase 2 lands so the /replay page has something on first visit; a follow-up commit.)
