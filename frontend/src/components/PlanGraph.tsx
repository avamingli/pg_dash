import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Table2, GitMerge, Sigma, Share2, ArrowUpDown, Layers, Box,
  ZoomIn, ZoomOut, Maximize2, RotateCcw, Expand, Minimize2, X,
  ScanSearch, FileSearch, Grid2x2, Rows3, Rows4, Crosshair, Dice5, FunctionSquare,
  List, Bookmark, RefreshCcw, Layers2, Globe, Hash, Repeat2, ListOrdered, Combine,
  AppWindow, Boxes, Fingerprint, Scissors, Users, Save, BookmarkCheck, SquareStack,
  Layers3, Calculator, FilePlus2, FilePen, FileX2, Lock, Merge, Shuffle, RadioTower,
  Route,
} from 'lucide-react';
import {
  type PlanNode, type LiveNodeStats, type SliceSummary, type NodeCompletionState,
  nodeLabel, rowEstimateRatio, getTotalTime, formatMs, estimateCompletionPct, sliceColor,
} from '@/lib/planTree';
import SliceSummaryPanel from '@/components/SliceSummaryPanel';

// GPCC-style node-and-arrow plan diagram: leaves at the bottom, root at the
// top, arrows pointing up (the direction data actually flows) — a
// deliberately different visual language from PlanViewer's indented tree,
// aimed at "see every node's state at a glance" rather than "drill down
// one branch at a time".

// Card size is fixed so the layout engine (leaf-column grid) stays simple.
// Icon and slice pill sit as absolute corner badges (top-left / top-right)
// instead of stealing width from the label row, so the label can wrap up
// to 2 lines while the card stays compact.
const NODE_W = 192;
const NODE_H = 68;
const H_GAP = 28;
const V_GAP = 46;
const PAD = 24;
// Height of the bottom progress strip. Bigger than a classic Chrome-tab
// hairline so it actually registers at this card size, but still thin
// enough to stay in its own zone under the text stack.
const PROGRESS_H = 6;

interface LayoutNode {
  node: PlanNode;
  x: number; // leaf-order units, not pixels
  depth: number;
  children: LayoutNode[];
}

function layoutTree(root: PlanNode): { layout: LayoutNode; leafCount: number; maxDepth: number } {
  let leafCounter = 0;
  let maxDepth = 0;
  function visit(node: PlanNode, depth: number): LayoutNode {
    maxDepth = Math.max(maxDepth, depth);
    const children = (node.Plans ?? []).map(c => visit(c, depth + 1));
    const x = children.length === 0
      ? leafCounter++
      : children.reduce((sum, c) => sum + c.x, 0) / children.length;
    return { node, x, depth, children };
  }
  const layout = visit(root, 0);
  return { layout, leafCount: Math.max(leafCounter, 1), maxDepth };
}

// One icon per real plan node kind, not a generic "Scan"/"Join"/"Motion"
// bucket — picked so the shape itself hints at what the node actually does:
// Shuffle for a Redistribute Motion (rows get reshuffled across segments),
// RadioTower for Broadcast (one sender, every segment tuned in), Hash for
// a Hash Join, Fingerprint for Unique, Scissors for Limit, and so on.
// Matches against the raw "Node Type" (plus Strategy/Operation for the few
// node kinds EXPLAIN JSON only disambiguates that way), not nodeLabel()'s
// already-decorated string (which has "Parallel "/" N:M" mixed in).
function nodeIcon(node: PlanNode) {
  const type = node['Node Type'];
  switch (type) {
    // GPDB Motion — each kind gets a shape that actually suggests its job.
    case 'Gather Motion': return Merge;
    case 'Redistribute Motion': return Shuffle;
    case 'Broadcast Motion': return RadioTower;
    case 'Explicit Motion': return Route;

    // Joins
    case 'Hash Join': return Hash;
    case 'Merge Join': return GitMerge;
    case 'Nested Loop': return Repeat2;

    // Aggregation / grouping
    case 'Aggregate':
      if (node['Strategy'] === 'Sorted') return ListOrdered;
      if (node['Strategy'] === 'Mixed') return Combine;
      return Sigma; // Hashed, or strategy not captured
    case 'WindowAgg': return AppWindow;
    case 'Group': return Boxes;

    // Sort / dedup / limit / set ops
    case 'Sort': return ArrowUpDown;
    case 'Unique': return Fingerprint;
    case 'Limit': return Scissors;
    case 'SetOp': return Rows3;

    // Parallel workers (plain PostgreSQL parallelism, not a GPDB Motion)
    case 'Gather':
    case 'Gather Merge': return Users;

    // Caching
    case 'Materialize': return Save;
    case 'Memoize': return BookmarkCheck;

    // Combining sibling subplans
    case 'Append': return Layers;
    case 'MergeAppend': return SquareStack;
    case 'Sequence': return Layers3;

    // Result / row-modifying
    case 'Result': return Calculator;
    case 'ModifyTable':
      if (node['Operation'] === 'Insert') return FilePlus2;
      if (node['Operation'] === 'Delete') return FileX2;
      return FilePen; // Update, or operation not captured
    case 'LockRows': return Lock;

    // Scans
    case 'Index Only Scan':
    case 'Dynamic Index Only Scan': return FileSearch;
    case 'Index Scan':
    case 'Dynamic Index Scan': return ScanSearch;
    case 'Bitmap Index Scan': return Rows4;
    case 'Bitmap Heap Scan':
    case 'Dynamic Bitmap Heap Scan': return Grid2x2;
    case 'Tid Scan':
    case 'Tid Range Scan': return Crosshair;
    case 'Sample Scan': return Dice5;
    case 'Function Scan':
    case 'Table Function Scan': return FunctionSquare;
    case 'Values Scan': return List;
    case 'CTE Scan': return Bookmark;
    case 'WorkTable Scan': return RefreshCcw;
    case 'Subquery Scan': return Layers2;
    case 'Foreign Scan':
    case 'Dynamic Foreign Scan': return Globe;

    default:
      // Safety net for node kinds not explicitly listed above (a future PG
      // version's new node type, or a variant this switch missed) — still
      // groups sensibly by name instead of falling straight to a blank box.
      if (type?.includes('Bitmap')) return Grid2x2;
      if (type?.includes('Index')) return ScanSearch;
      if (type?.includes('Scan')) return Table2;
      if (type?.includes('Motion')) return Share2;
      if (type?.includes('Join')) return GitMerge;
      return Box;
  }
}

// Icon badge color by node *category* — a second, independent visual
// channel from the box border color (which signals live/error/hot-path
// status): this one answers "what kind of node is this" at a glance,
// e.g. every Motion reads amber regardless of which one it is, every scan
// reads sky-blue, etc.
function nodeCategoryClass(node: PlanNode): string {
  const type = node['Node Type'] ?? '';
  if (type.includes('Motion')) return 'bg-amber-500/15 text-amber-400';
  if (type === 'Gather' || type === 'Gather Merge') return 'bg-amber-500/15 text-amber-400';
  if (type.includes('Join') || type === 'Nested Loop') return 'bg-violet-500/15 text-violet-400';
  if (type === 'Aggregate' || type === 'WindowAgg' || type === 'Group') return 'bg-pink-500/15 text-pink-400';
  if (['Sort', 'Unique', 'Limit', 'SetOp'].includes(type)) return 'bg-teal-500/15 text-teal-400';
  if (type === 'Materialize' || type === 'Memoize') return 'bg-indigo-500/15 text-indigo-400';
  if (type === 'ModifyTable' || type === 'LockRows') return 'bg-rose-500/15 text-rose-400';
  if (type.includes('Scan')) return 'bg-sky-500/15 text-sky-400';
  return 'bg-zinc-700/40 text-zinc-400';
}

function flatten(ln: LayoutNode, out: LayoutNode[] = []): LayoutNode[] {
  out.push(ln);
  ln.children.forEach(c => flatten(c, out));
  return out;
}

interface PlanGraphProps {
  root: PlanNode;
  rootTime: number;
  nodeIds?: Map<PlanNode, number>;
  liveNodes?: Record<number, LiveNodeStats>;
  /**
   * Per-nid state ('active' | 'completed' | 'idle'), inferred by
   * computeNodeCompletionStates from the tree topology + liveNodes. Used
   * to distinguish nodes still producing rows from nodes whose shmem
   * slots recycled but whose ancestors are visibly holding data (so they
   * clearly executed) — see that helper's own doc for the reasoning.
   */
  nodeStates?: Record<number, NodeCompletionState>;
  /** Query has ended — switches the live green fill/pulse to a calmer "done" look. */
  finished?: boolean;
  /** Viewport height available for the graph; defaults to a fixed size for the Watch panel's fixed-width sidebar. Ignored in fullscreen mode. */
  maxHeight?: number;
  /**
   * The Watch panel's slice/timing summary, rendered inside this
   * component (not as a sibling in the caller) so it stays visible in
   * fullscreen too — fullscreen renders via a portal straight into
   * document.body, which anything sitting outside PlanGraph in the DOM
   * tree simply isn't part of.
   */
  sliceSummaries?: SliceSummary[];
  runTimeMs?: number;
  estProgressPct?: number | null;
}

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
// A pointer that hasn't moved past this many px is still a click (opens the
// node's detail panel), not a pan — otherwise a hand tremor while clicking
// a node would fall through as a 1px drag instead.
const PAN_CLICK_THRESHOLD = 4;

export default function PlanGraph({
  root, rootTime, nodeIds, liveNodes, nodeStates, finished, maxHeight = 460,
  sliceSummaries, runTimeMs, estProgressPct,
}: PlanGraphProps) {
  const [selected, setSelected] = useState<PlanNode | null>(null);
  const [zoom, setZoom] = useState(1);
  // Pan offset in pixels, applied via `translate()` on the content layer —
  // deliberately not scrollLeft/scrollTop. A scroll-based pan can only ever
  // reveal overflow that already exists, so an axis where the tree already
  // fits (no overflow) can't be panned at all no matter how the drag math
  // is written. A free transform has no such floor: it can slide the
  // content in any direction regardless of whether it currently overflows.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  const { layout, leafCount, maxDepth } = useMemo(() => layoutTree(root), [root]);
  const allNodes = useMemo(() => flatten(layout), [layout]);

  const width = leafCount * (NODE_W + H_GAP) - H_GAP + PAD * 2;
  const height = (maxDepth + 1) * (NODE_H + V_GAP) - V_GAP + PAD * 2;

  const px = (x: number) => PAD + x * (NODE_W + H_GAP) + NODE_W / 2;
  const py = (depth: number) => PAD + depth * (NODE_H + V_GAP);

  const selNid = selected?.Nid ?? (selected ? nodeIds?.get(selected) : undefined);
  const selLive = selNid != null ? liveNodes?.[selNid] : undefined;
  // Same state/fill math as each card runs — reused in the detail panel
  // so its progress row reads the exact same value as the card the user
  // just clicked, with no drift or independent calculation.
  const selRawState: NodeCompletionState = selNid != null
    ? (nodeStates?.[selNid] ?? 'idle')
    : (selLive != null && selLive.rows > 0 ? 'active' : 'idle');
  const selState: NodeCompletionState = finished ? 'completed' : selRawState;
  const selPct = estimateCompletionPct(selLive, selected?.['Plan Rows'], !!finished);
  const selFillPct = selState === 'completed'
    ? 100
    : selState === 'active'
      ? (selPct != null ? Math.min(100, Math.max(4, selPct)) : null)
      : null;

  // Centers the tree in whatever the viewport's current size is, for a
  // given zoom level — shared by "fit" (fit's own computed scale) and
  // "reset zoom" (back to 100%), so both land on a sensibly-centered view
  // instead of leaving pan wherever a previous drag left it.
  const centerPan = useCallback((scale: number) => {
    const el = viewportRef.current;
    if (!el) return;
    setPan({
      x: (el.clientWidth - width * scale) / 2,
      y: (el.clientHeight - height * scale) / 2,
    });
  }, [width, height]);

  // "Fit" scales the whole tree down (never up past 100%) so it's fully
  // visible without needing to pan around — the common "fit to view"
  // affordance most diagram/graph tools have, for exactly the "plan
  // doesn't fit" case.
  const fit = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const scale = Math.max(ZOOM_MIN, Math.min(1, (el.clientWidth - 16) / width, (el.clientHeight - 16) / height));
    setZoom(scale);
    centerPan(scale);
  }, [width, height, centerPan]);

  // Opening fullscreen changes how much room the viewport actually has, so
  // re-fit once the DOM has the new (much larger) size instead of leaving
  // whatever zoom the small sidebar view happened to be at.
  useEffect(() => {
    if (isFullscreen) fit();
  }, [isFullscreen, fit]);

  // Standard modal etiquette: Escape closes it, and the page behind it
  // shouldn't scroll while it's open.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen]);

  // Drag-to-pan: click-drag anywhere on the canvas background slides the
  // content layer via `pan` — free movement in any direction, not bounded
  // by whatever currently overflows, the same interaction draw.io/Miro/
  // most graph tools use once a diagram is too big to see all at once
  // (zoom alone can't fix that without making node text illegible).
  // Starting from a node button is left alone so its own click still
  // works normally.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const el = viewportRef.current;
    if (!el) return;
    panRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > PAN_CLICK_THRESHOLD) {
      drag.moved = true;
      setIsPanning(true);
    }
    if (drag.moved) {
      setPan({ x: drag.panX + dx, y: drag.panY + dy });
    }
  };
  const endPan = (e: PointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (el && panRef.current?.pointerId === e.pointerId) {
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    }
    panRef.current = null;
    setIsPanning(false);
  };

  const toolbar = (
    <div className="flex items-center gap-1 mb-2">
      <button onClick={() => setZoom(z => Math.max(ZOOM_MIN, z - 0.1))} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200" title="Zoom out">
        <ZoomOut size={13} />
      </button>
      <span className="text-[11px] text-zinc-500 font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
      <button onClick={() => setZoom(z => Math.min(ZOOM_MAX, z + 0.1))} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200" title="Zoom in">
        <ZoomIn size={13} />
      </button>
      <button onClick={fit} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200" title="Fit to view">
        <Maximize2 size={13} />
      </button>
      <button onClick={() => { setZoom(1); centerPan(1); }} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200" title="Reset zoom">
        <RotateCcw size={13} />
      </button>
      <span className="w-px h-4 bg-zinc-800 mx-1" />
      <button onClick={() => setIsFullscreen(v => !v)} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200" title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Open in fullscreen'}>
        {isFullscreen ? <Minimize2 size={13} /> : <Expand size={13} />}
      </button>
    </div>
  );

  const canvas = (
    <div
      ref={viewportRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      className={`relative overflow-hidden rounded border border-zinc-800 bg-zinc-950 select-none ${isFullscreen ? 'flex-1 min-h-0' : ''} ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{ height: isFullscreen ? undefined : maxHeight }}
    >
      {/* Content lives at its natural (unzoomed) size and is moved/scaled
          purely via transform — absolutely positioned so it never
          contributes to this container's own layout size, and free to
          pan in any direction regardless of whether it currently
          overflows in that axis (see the `pan` state comment above). */}
      <div className="absolute top-0 left-0 origin-top-left" style={{ width, height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg className="absolute inset-0" width={width} height={height}>
          <defs>
            <marker id="pg-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#52525b" />
            </marker>
            <marker id="pg-arrow-active" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#10b981" />
            </marker>
          </defs>
          {allNodes.flatMap(ln => ln.children.map((child, i) => {
            const x1 = px(child.x), y1 = py(child.depth);
            const x2 = px(ln.x), y2 = py(ln.depth) + NODE_H;
            const midY = (y1 + y2) / 2;
            // Data flows child -> parent (arrows point up, per this
            // component's own convention) — so an edge reads as "actively
            // moving" when its *child* end is a live, still-running node,
            // a marching-ants dash plus an emerald arrowhead instead of
            // the plain static gray line.
            const childNid = child.node.Nid ?? nodeIds?.get(child.node);
            const childLive = childNid != null ? liveNodes?.[childNid] : undefined;
            // Edge animates only when the child is currently producing —
            // 'completed' children have already handed their rows off, so
            // painting a marching-ants arrow over them reads as "still
            // flowing" when the tuple stream is long done.
            const childState = childNid != null ? nodeStates?.[childNid] : undefined;
            const flowing = childState === 'active' && childLive != null && !finished;
            return (
              <path
                key={`${ln.node.Nid ?? ln.x}-${i}`}
                d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                fill="none"
                stroke={flowing ? '#10b981' : '#52525b'}
                strokeWidth={flowing ? 2 : 1.5}
                strokeLinecap="round"
                className={flowing ? 'pg-edge-flow' : undefined}
                markerEnd={flowing ? 'url(#pg-arrow-active)' : 'url(#pg-arrow)'}
              />
            );
          }))}
        </svg>

        {allNodes.map((ln, i) => {
          const node = ln.node;
          const label = nodeLabel(node);
          const Icon = nodeIcon(node);
          const categoryClass = nodeCategoryClass(node);
          const nid = node.Nid ?? nodeIds?.get(node);
          const live = nid != null ? liveNodes?.[nid] : undefined;
          const estRows = node['Plan Rows'];
          const pct = estimateCompletionPct(live, estRows, !!finished);
          const ratio = rowEstimateRatio(node);
          const isSelected = selected === node;
          const relation = node['Relation Name'];
          const sliceId = node['Slice'];
          const sliceHex = sliceColor(sliceId);

          const borderColor = isSelected
            ? 'border-blue-500'
            : ratio > 10
              ? 'border-red-500/50'
              : live != null
                ? finished ? 'border-blue-600/50' : 'border-emerald-600/60'
                : 'border-zinc-700';

          // Liquid-fill state — one visual family (green = produced data)
          // where fill *height* carries the "how done" signal:
          //   state='active' — currently reporting rows > 0 in shmem;
          //     green fill at pct% (or shimmer if we can't %-ize), pulsing
          //     green dot so it reads as *currently producing*.
          //   state='completed' — inferred done (rows=0 of own but an
          //     ancestor is holding rows, so data must have flowed
          //     through); green fill at 100%. No dot, no shimmer.
          //   state='idle' — no rows anywhere in this subtree's path
          //     upward; either genuinely not started or a top-of-plan
          //     hoarder still buffering. Empty.
          //   finished (whole query done) — collapses every node to
          //     'completed'. Green 100% everywhere instead of a jarring
          //     blue overlay: the terminal state reads as "everything
          //     filled up", continuous with the run's own visual story.
          const rawState: NodeCompletionState = nid != null
            ? (nodeStates?.[nid] ?? 'idle')
            : (live != null && live.rows > 0 ? 'active' : 'idle');
          const state: NodeCompletionState = finished ? 'completed' : rawState;
          const fillPct = pct != null ? Math.min(100, Math.max(4, pct)) : null;
          const greenFillPct = state === 'completed' ? 100 : (state === 'active' ? (fillPct ?? 4) : 0);
          const showShimmer = state === 'active' && fillPct == null;
          // Glow is reserved for "healthy and actively running" — an
          // estimate-error or selected node already has its own strong
          // border color to carry attention, a second glowing halo on top
          // would just compete with it instead of adding information.
          const isRunning = state === 'active' && ratio <= 10;

          // Running glow — an outer emerald halo. The slice-color left
          // stripe used to live in the same boxShadow but was too subtle
          // (a 3px inset never really registered next to the node's own
          // colored border); it's now a real div (below), which we can
          // widen freely without competing with anything else.
          const boxShadow = isRunning
            ? '0 0 0 1px rgba(16,185,129,0.25), 0 0 16px 2px rgba(16,185,129,0.35)'
            : undefined;

          return (
            <button
              key={nid ?? i}
              onClick={() => setSelected(node)}
              className={`absolute rounded-lg border ${borderColor} bg-zinc-900 text-left transition-colors duration-500 overflow-hidden ${isSelected ? 'shadow-sm' : ''} hover:border-blue-400`}
              style={{
                left: px(ln.x) - NODE_W / 2, top: py(ln.depth), width: NODE_W, height: NODE_H,
                boxShadow,
              }}
            >
              {sliceHex && (
                <div
                  className="absolute left-0 top-0 bottom-0 w-1.5"
                  style={{ backgroundColor: sliceHex }}
                  aria-hidden="true"
                />
              )}
              {isRunning && <div className="absolute inset-0 rounded-lg pg-glow" style={{ boxShadow: '0 0 20px 4px rgba(16,185,129,0.45)' }} />}

              {/* Progress strip along the bottom edge of the card.
                  Chrome/YouTube/Airflow convention: keep the progress bar
                  in a thin dedicated zone so it never overlaps text or
                  competes with the label stack for attention. Shimmer
                  runs across the filled portion while active, giving the
                  "still working" cue without needing waves on the body.
                  For shimmer-only state (rows>0 but no plan estimate),
                  the base track is filled full-width with a moving stripe
                  pattern — same "unknown but active" language as before. */}
              {(state === 'active' || state === 'completed') && (
                <div
                  className="absolute left-1.5 right-0 bottom-0 overflow-hidden bg-zinc-800/70"
                  style={{ height: PROGRESS_H }}
                  aria-hidden="true"
                >
                  {showShimmer ? (
                    <div className="absolute inset-0 pg-shimmer" />
                  ) : (
                    <>
                      <div
                        className="absolute inset-y-0 left-0 bg-emerald-500 transition-[width] duration-500"
                        style={{ width: `${greenFillPct}%` }}
                      />
                      {state === 'active' && (
                        <div
                          className="absolute inset-y-0 left-0 overflow-hidden"
                          style={{ width: `${greenFillPct}%` }}
                        >
                          <div className="absolute inset-0 pg-progress-shimmer" />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Corner badges: icon top-left, slice pill top-right.
                  Absolute so they don't eat into the label row's width —
                  lets the label wrap up to 2 lines using the full body
                  span (pl-7 pr-8 clears both corners). */}
              <span
                className={`absolute top-1 left-2.5 p-0.5 rounded ${categoryClass}`}
                title={label}
              >
                <Icon size={11} />
              </span>
              {sliceId != null && sliceHex && (
                <span
                  className="absolute top-1 right-1.5 text-[9px] font-mono font-semibold px-1 rounded"
                  style={{ color: sliceHex, backgroundColor: `${sliceHex}22`, border: `1px solid ${sliceHex}55` }}
                  title={`slice ${sliceId}`}
                >
                  s{sliceId}
                </span>
              )}

              {/* Body — label wraps up to 2 lines (line-clamp-2), relation
                  stays single-line truncate (long qualified names would
                  otherwise blow the card height). Both keep a title
                  tooltip so full text is one hover away. Progress is
                  confined to the bottom strip, so text needs no
                  drop-shadow to fight a moving background. */}
              <div
                className="relative text-[11px] font-semibold text-zinc-100 leading-snug break-words line-clamp-2 pl-7 pr-8 pt-1.5"
                title={label}
              >
                {label}
              </div>
              <div
                className="relative pl-7 pr-2 text-[10px] text-zinc-400 truncate"
                title={relation || undefined}
              >
                {relation ? `on ${relation}` : ' '}
              </div>
              <div className="relative pl-7 pr-2 text-[10px] font-mono flex items-center gap-1 text-emerald-300">
                {state === 'active' && (
                  <span className="w-1 h-1 rounded-full bg-emerald-400 inline-block shrink-0 animate-pulse" />
                )}
                {state === 'active' && live
                  ? `${live.rows.toLocaleString()} rows${pct != null ? ` ~${pct}%` : ''}`
                  : state === 'completed'
                    // Fast leaves recycled before we ever measured them, so
                    // we don't have real "N rows" to show — surface the
                    // planner estimate as the best available proxy, marked
                    // with ≈ to make its approximate nature explicit.
                    ? (node['Plan Rows'] != null ? `≈ ${node['Plan Rows'].toLocaleString()} rows` : '100%')
                    : ' '}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  const detail = selected && (
    <div className="mt-3 rounded border border-zinc-800 bg-zinc-900 p-3 text-xs">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-zinc-200">{nodeLabel(selected)}</span>
        <button onClick={() => setSelected(null)} className="text-zinc-500 hover:text-zinc-300">×</button>
      </div>

      {/* Same progress bar as the card, blown up 2× so it's actually
          legible in the detail panel. Percentage/state text sits inline
          on the right, matching the card's own text row. */}
      {(selState === 'active' || selState === 'completed') && (
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1 h-2.5 overflow-hidden rounded bg-zinc-800/70">
            {selFillPct == null ? (
              <div className="absolute inset-0 pg-shimmer" />
            ) : (
              <>
                <div
                  className="absolute inset-y-0 left-0 bg-emerald-500 transition-[width] duration-500"
                  style={{ width: `${selFillPct}%` }}
                />
                {selState === 'active' && (
                  <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${selFillPct}%` }}>
                    <div className="absolute inset-0 pg-progress-shimmer" />
                  </div>
                )}
              </>
            )}
          </div>
          <span className="text-[11px] font-mono text-emerald-300 shrink-0 tabular-nums">
            {selState === 'completed'
              // A completed node is completed regardless of what its
              // observed rows/estimate ratio came out to — floor the %
              // at 100 so we never contradict the full progress bar
              // right next to us with a "51%" number. If actual > est
              // (overshoot), show the real overshoot value — it's
              // useful signal about a bad planner estimate.
              ? (selPct != null
                  ? `${Math.max(100, selPct)}%`
                  : selected['Plan Rows'] != null
                    ? `≈ ${selected['Plan Rows'].toLocaleString()} rows`
                    : '100%')
              : selPct != null
                ? `${selPct}%`
                : selLive != null
                  ? `${selLive.rows.toLocaleString()} rows`
                  : 'active'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-zinc-400">
        {selected['Relation Name'] && (
          <div className="col-span-2">Relation: <span className="text-zinc-200 font-mono">{selected['Relation Name']}</span></div>
        )}
        <div>Estimated Rows: <span className="text-zinc-200 font-mono">{selected['Plan Rows']?.toLocaleString() ?? '—'}</span></div>
        <div>
          Estimated Completion:{' '}
          <span className="text-zinc-200 font-mono">
            {selState === 'completed'
              // Match the progress bar's semantics: a done node reads as
              // ≥100%, not whatever the observed-vs-estimate ratio was.
              ? (selPct != null ? `${Math.max(100, selPct)}%` : '100%')
              : selPct != null
                ? `${selPct}%`
                : '—'}
          </span>
        </div>
        <div>Live Rows (all segments): <span className="text-zinc-200 font-mono">{selLive?.rows.toLocaleString() ?? '—'}</span></div>
        <div>Segments Reporting: <span className="text-zinc-200 font-mono">{selLive?.segments ?? '—'}</span></div>
        <div>Cost: <span className="text-zinc-200 font-mono">{selected['Startup Cost']?.toFixed(2)}..{selected['Total Cost']?.toFixed(2)}</span></div>
        <div>Width: <span className="text-zinc-200 font-mono">{selected['Plan Width'] ?? '—'}</span></div>
        {selected['Actual Total Time'] != null && (
          <div>Total Time: <span className="text-zinc-200 font-mono">{formatMs(getTotalTime(selected))} ({((getTotalTime(selected) / rootTime) * 100 || 0).toFixed(1)}%)</span></div>
        )}
        {selected['Filter'] && (
          <div className="col-span-2">Filter: <span className="text-zinc-200 font-mono">{selected['Filter']}</span></div>
        )}
        {selected['Hash Cond'] && (
          <div className="col-span-2">Hash Cond: <span className="text-zinc-200 font-mono">{selected['Hash Cond']}</span></div>
        )}
        {selected['Join Filter'] && (
          <div className="col-span-2">Join Filter: <span className="text-zinc-200 font-mono">{selected['Join Filter']}</span></div>
        )}
      </div>
    </div>
  );

  const sidePanel = sliceSummaries && sliceSummaries.length > 0 && (
    <SliceSummaryPanel slices={sliceSummaries} runTimeMs={runTimeMs ?? 0} estProgressPct={estProgressPct ?? null} />
  );

  if (isFullscreen) {
    // Rendered via a portal straight into document.body — not just nested
    // deeper in the Watch panel's own tree. The Watch panel's slide-in
    // wrapper is an `animate-in` element, which sets a `transform` (even
    // once settled at its resting value, the property is still present,
    // not the CSS keyword `none`); per spec that makes it the containing
    // block for any `position: fixed` descendant. Nesting the fullscreen
    // overlay inside that tree would size/position `inset-0` against that
    // small panel instead of the real viewport — the overlay would open at
    // basically the same size as the sidebar, which is exactly why zoom and
    // drag-to-pan looked like they'd stopped doing anything: there was
    // barely any extra room to see the difference in.
    return createPortal(
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
        <div className="w-full h-full max-w-[1800px] bg-zinc-950 border border-zinc-800 rounded-lg flex p-4 overflow-hidden">
          {sidePanel}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between">
              {toolbar}
              <button onClick={() => setIsFullscreen(false)} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 mb-2" title="Close (Esc)">
                <X size={16} />
              </button>
            </div>
            {canvas}
            <div className="overflow-y-auto shrink-0 max-h-[35%]">{detail}</div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div className="p-4 flex gap-3">
      {sidePanel}
      <div className="flex-1 min-w-0">
        {toolbar}
        {canvas}
        {detail}
      </div>
    </div>
  );
}
