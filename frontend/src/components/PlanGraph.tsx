import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Table2, GitMerge, Sigma, Share2, ArrowUpDown, Box, ListPlus,
  ZoomIn, ZoomOut, Maximize2, RotateCcw, Expand, Minimize2, X, Sun, Moon,
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
// The rising tint behind a card's text — the second, area-based encoding
// of the same progress the strip shows. Alpha at zoom 1 is low enough
// that text contrast is untouched (zinc-100 on zinc-900 + 14% emerald is
// still ~14:1; zinc-900 on white + 10% is ~15:1). It climbs as the view
// zooms out, because a 6px strip stops registering below ~0.7 while a
// half-green card reads at any size — and at those zooms the text is
// unreadable anyway, so there is nothing left for a stronger tint to
// compete with. Light canvas runs lower: emerald shows more on white.
const TINT_ALPHA_DARK = { near: 0.14, far: 0.42 };
const TINT_ALPHA_LIGHT = { near: 0.10, far: 0.32 };
// The tint's surface while a node is active is a GPCC-style wave: two
// SVG layers sliding at different speeds. Height of the wave box; the
// path inside crests ~10px peak-to-trough, which is what makes it read
// as water at card size rather than a polite ripple. It is painted in
// the tint's own colour and alpha — the 8f062db wave that covered text
// did so with a 0.65-alpha crest and a glowing surface line, not with
// the wave itself. Motion carries "alive"; contrast stays out of it.
const WAVE_H = 16;
// The surface is not the body's colour. Water reads as water because its
// surface differs from its depth: on the dark canvas the wave is a
// lighter emerald (400) than the emerald-500 body, on the light canvas a
// darker one (600) — in each case the direction that moves *away* from
// the canvas, since a tint pulled toward the background is what was
// making the wave vanish. Alpha is the body's times WAVE_ALPHA_MULT,
// capped so the far-zoom end doesn't go opaque.
const WAVE_RGB_DARK = '52,211,153';
const WAVE_RGB_LIGHT = '5,150,105';
const WAVE_ALPHA_MULT = 3;
const WAVE_ALPHA_MAX = 0.6;
// Right-shift applied to Append/MergeAppend/Sequence stacked children so
// they visually indent from their parent, matching EXPLAIN-text style
// (`Append / -> Seq Scan p1 / -> Seq Scan p2`). Also the gap width the
// horizontal tick lines from the trunk into each child's left edge.
const STACK_INDENT_PX = 40;

interface LayoutNode {
  node: PlanNode;
  x: number; // leaf-order units, not pixels
  depth: number;
  children: LayoutNode[];
  /** True when this node is a stacked child under an Append-family
   * parent (see shouldStackChildren). Rendering shifts these cards
   * right by STACK_INDENT_PX and connects them to the parent with a
   * tree-view trunk + tick instead of the normal Bezier edge. */
  stacked?: boolean;
}

// Node types whose children we prefer to stack vertically (EXPLAIN-text-
// style list) instead of fanning out horizontally as normal tree
// branches. Applies only when every child is a leaf — otherwise the
// grandchildren would need their own leaf columns anyway and stacking
// the parents on top of each other creates overlap. Partition scans
// and UNION ALLs are the common triggers.
const LIST_LIKE_NODE_TYPES = new Set(['Append', 'MergeAppend', 'Sequence']);
function shouldStackChildren(node: PlanNode): boolean {
  if (!LIST_LIKE_NODE_TYPES.has(node['Node Type'] ?? '')) return false;
  const kids = node.Plans ?? [];
  if (kids.length < 2) return false;
  return kids.every(c => !c.Plans || c.Plans.length === 0);
}

function layoutTree(root: PlanNode): { layout: LayoutNode; leafCount: number; maxDepth: number } {
  let leafCounter = 0;
  let maxDepth = 0;
  function visit(node: PlanNode, depth: number): LayoutNode {
    if (shouldStackChildren(node)) {
      // Append-family with all-leaf children: give the parent one leaf
      // column, then stack every child at that same x, incrementing
      // depth by 1 each. Reads like EXPLAIN's "-> Append / -> Seq Scan
      // p1 / -> Seq Scan p2 / ..." indented list, one row per child.
      const parentX = leafCounter++;
      const children: LayoutNode[] = (node.Plans ?? []).map((c, i) => ({
        node: c,
        x: parentX,
        depth: depth + 1 + i,
        children: [],
        stacked: true,
      }));
      maxDepth = Math.max(maxDepth, depth + (node.Plans?.length ?? 0));
      return { node, x: parentX, depth, children };
    }
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
    // Append concatenates rows from multiple inputs into one list —
    // ListPlus (a list with a + at the bottom) reads that literally.
    // Layers (three stacked planes) worked semantically but at small
    // sizes looks too much like a database-cylinder glyph.
    case 'Append': return ListPlus;
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

/** Tint alpha for the current zoom: `near` at 1× and above, `far` at ZOOM_MIN, linear between. */
function tintAlpha(zoom: number, lightCanvas: boolean): number {
  const { near, far } = lightCanvas ? TINT_ALPHA_LIGHT : TINT_ALPHA_DARK;
  const t = Math.min(1, Math.max(0, (1 - zoom) / (1 - ZOOM_MIN)));
  return near + (far - near) * t;
}
// Minimap in the canvas's bottom-right corner. Shows the full plan tree
// scaled down + a rectangle over the currently-visible area; clicking
// jumps the pan to center on that spot. Useful once the plan is big
// enough to need scrolling around, invisible when the whole plan fits
// on screen.
const MINIMAP_W = 140;
const MINIMAP_H = 96;
const MINIMAP_PAD = 6;
// A pointer that hasn't moved past this many px is still a click (opens the
// node's detail panel), not a pan — otherwise a hand tremor while clicking
// a node would fall through as a 1px drag instead.
const PAN_CLICK_THRESHOLD = 4;

export default function PlanGraph({
  root, rootTime, nodeIds, liveNodes, nodeStates, finished, maxHeight = 460,
  sliceSummaries, runTimeMs, estProgressPct,
}: PlanGraphProps) {
  // Toggle between the app's normal dark canvas and a light one meant
  // for screenshots / thumbnails / video demos where the plan tree
  // needs to read clearly at low zoom. Scoped to this graph panel only
  // — the surrounding Watch panel / sidebar stay dark. Preference is
  // persisted to localStorage so a picked mode survives page reloads
  // (private-window / disabled-storage throws, hence the try/catch).
  const [lightCanvas, setLightCanvas] = useState<boolean>(() => {
    try { return localStorage.getItem('pg_dash.plangraph.lightCanvas') === '1'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('pg_dash.plangraph.lightCanvas', lightCanvas ? '1' : '0'); }
    catch { /* private window / storage disabled — silently ignore */ }
  }, [lightCanvas]);
  const t = lightCanvas ? {
    canvas: 'bg-zinc-50',
    card: 'bg-white',
    cardBorderDefault: 'border-zinc-300',
    textLabel: 'text-zinc-900',
    textRelation: 'text-zinc-600',
    textRows: 'text-emerald-700',
    edgeStroke: '#94a3b8',
    trunkStroke: '#94a3b8',
  } : {
    canvas: 'bg-zinc-950',
    card: 'bg-zinc-900',
    cardBorderDefault: 'border-zinc-700',
    textLabel: 'text-zinc-100',
    textRelation: 'text-zinc-400',
    textRows: 'text-emerald-300',
    edgeStroke: '#52525b',
    trunkStroke: '#52525b',
  };
  const [selected, setSelected] = useState<PlanNode | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  // Auto-close the node detail panel on any mousedown outside it: clicking
  // another node (switch selection), a toolbar button (zoom/fit/etc), a
  // slice pill (isolate slice), a spot on the graph background, or any
  // other UI beyond this component. Using mousedown so the close fires
  // *before* click — a card's onClick can then re-set selection in the
  // same gesture, giving a natural "click through to switch" behavior.
  useEffect(() => {
    if (!selected) return;
    const handler = (e: MouseEvent) => {
      const el = detailRef.current;
      if (el && !el.contains(e.target as Node)) setSelected(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selected]);
  // Click a slice pill (on a card or in the SliceSummaryPanel) to isolate
  // that slice — nodes not in it fade out, edges too, making the shape
  // and reach of one slice's gang instantly visible. Null = no filter.
  const [highlightSlice, setHighlightSlice] = useState<number | null>(null);
  const toggleHighlight = (sid: number) => setHighlightSlice(prev => prev === sid ? null : sid);
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
  // Live viewport size, tracked via ResizeObserver — fullscreen / window
  // resize / sidebar collapse all change it, and the minimap needs it to
  // draw the "you're looking at this part" rectangle in the right place.
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setViewportSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFullscreen]);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  const { layout, leafCount, maxDepth } = useMemo(() => layoutTree(root), [root]);
  const allNodes = useMemo(() => flatten(layout), [layout]);

  // Water level for a node that is consuming but has no measurable
  // progress of its own (a Partial HashAgg pulling from a live Hash Join
  // reports rows=0 until it emits). Such a node cannot be further along
  // than its inputs, so its surface sits at the slowest input's level —
  // completed inputs count as 100, unmeasured ones are skipped, and a
  // node whose inputs are all unmeasured gets null (surface at the
  // bottom, "alive, nothing to go on yet"). Without this the unknown case
  // drew its surface near the top of the card, which read as "almost
  // done" over a child that was plainly still running.
  const inputBoundPct = useMemo(() => {
    const out = new Map<LayoutNode, number | null>();
    const visit = (ln: LayoutNode): number | null => {
      const nid = ln.node.Nid ?? nodeIds?.get(ln.node);
      const live = nid != null ? liveNodes?.[nid] : undefined;
      const state = nid != null ? nodeStates?.[nid] : undefined;
      const kids = ln.children.map(visit);
      let own: number | null = finished || state === 'completed'
        ? 100
        : estimateCompletionPct(live, ln.node['Plan Rows'], !!finished);
      if (own == null) {
        const known = kids.filter((p): p is number => p != null);
        own = known.length > 0 ? Math.min(...known) : null;
      }
      out.set(ln, own);
      return own;
    };
    visit(layout);
    return out;
  }, [layout, nodeIds, liveNodes, nodeStates, finished]);

  // Add STACK_INDENT_PX to the canvas width when any stacked child exists —
  // those cards render shifted right and would otherwise clip off the
  // rightmost column.
  const hasStackedChild = useMemo(() => allNodes.some(ln => ln.stacked), [allNodes]);
  const width = leafCount * (NODE_W + H_GAP) - H_GAP + PAD * 2 + (hasStackedChild ? STACK_INDENT_PX : 0);
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

  // Opening fullscreen changes how much room the viewport actually has,
  // so re-fit once the DOM has the new (much larger) size. useLayout-
  // Effect (not useEffect) so the fit lands *before* the browser paints
  // the new container size — otherwise the first frame shows the tree
  // at the old zoom/pan inside the new large viewport (an obvious
  // "jump" as it snaps to the correct fit one frame later).
  useLayoutEffect(() => {
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
    // A click on empty canvas (pointer down + up with no meaningful drag,
    // and not landing on a node card or slice pill) clears any active
    // slice isolation. Card buttons and the sN pill are role='button', so
    // this ignores them; a plain click on the viewport background is what
    // makes it back here.
    const wasClick = panRef.current != null && !panRef.current.moved;
    if (wasClick && highlightSlice != null) {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('button, [role="button"]')) {
        setHighlightSlice(null);
      }
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
      <button
        onClick={() => setLightCanvas(v => !v)}
        className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
        title={lightCanvas ? 'Dark canvas' : 'Light canvas (better for screenshots / low zoom)'}
      >
        {lightCanvas ? <Moon size={13} /> : <Sun size={13} />}
      </button>
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
      className={`relative overflow-hidden rounded border border-zinc-800 ${t.canvas} select-none ${isFullscreen ? 'flex-1 min-h-0' : ''} ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
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
          {/* Tree-view style trunk + tick lines for Append-family stacked
              children. Vertical trunk drops from the parent's bottom-left
              area down past every stacked child; a short horizontal tick
              connects the trunk to each child's shifted left edge. Reads
              like EXPLAIN's `-> Seq Scan p1 / -> Seq Scan p2` indented
              list. Rendered before the normal edges so the Bezier arrows
              overlay on top where they cross. */}
          {allNodes.flatMap(ln => {
            if (!shouldStackChildren(ln.node) || ln.children.length === 0) return [];
            const trunkX = px(ln.x) - NODE_W / 2 + STACK_INDENT_PX / 2;
            const trunkTop = py(ln.depth) + NODE_H;
            const lastChild = ln.children[ln.children.length - 1];
            const trunkBottom = py(lastChild.depth) + NODE_H / 2;
            return [
              <line
                key={`trunk-${ln.node.Nid ?? ln.x}-${ln.depth}`}
                x1={trunkX} y1={trunkTop} x2={trunkX} y2={trunkBottom}
                stroke={t.trunkStroke} strokeWidth={1.5} strokeLinecap="round"
              />,
              ...ln.children.map((c, i) => {
                const tickY = py(c.depth) + NODE_H / 2;
                const tickX2 = px(c.x) - NODE_W / 2 + STACK_INDENT_PX;
                // Animate the tick with the same marching-ants pattern
                // regular edges use, so a still-producing partition scan
                // reads as "data flowing up from this branch". Done
                // children stay a plain static line — matches the "solid
                // gray = quiet" convention elsewhere.
                const childNid = c.node.Nid ?? nodeIds?.get(c.node);
                const childLive = childNid != null ? liveNodes?.[childNid] : undefined;
                const flowing = !finished && childLive?.growing === true;
                const childSlice = c.node['Slice'];
                const parentSlice = ln.node['Slice'];
                const tickDimmed = highlightSlice != null
                  && parentSlice !== highlightSlice
                  && childSlice !== highlightSlice;
                // Draw from child's edge → trunk, not the other way, so
                // the marching-ants dashes (stroke-dashoffset animates
                // negative, i.e. toward x2) flow right→left — matching
                // "data streaming from this child up into Append".
                return (
                  <line
                    key={`tick-${ln.node.Nid ?? ln.x}-${i}`}
                    x1={tickX2} y1={tickY} x2={trunkX} y2={tickY}
                    stroke={flowing ? '#10b981' : t.edgeStroke}
                    strokeWidth={flowing ? 2 : 1.5}
                    strokeLinecap="round"
                    className={flowing ? 'pg-edge-flow' : undefined}
                    style={{ opacity: tickDimmed ? 0.35 : 1, transition: 'opacity 200ms' }}
                  />
                );
              }),
            ];
          })}
          {allNodes.flatMap(ln => ln.children.map((child, i) => {
            const childLeftShift = child.stacked ? STACK_INDENT_PX : 0;
            const x1 = px(child.x) + childLeftShift, y1 = py(child.depth);
            const x2 = px(ln.x), y2 = py(ln.depth) + NODE_H;
            const midY = (y1 + y2) / 2;
            // Stacked-list children (see shouldStackChildren in layoutTree)
            // get the trunk + tick treatment drawn separately above, so
            // skip the regular Bezier here. A normal single-child chain
            // (Sort → Aggregate, Motion → its subtree) also has
            // child.x === ln.x but must keep its edge — hence the parent
            // check, not just an x-equality one.
            if (shouldStackChildren(ln.node)) return null;
            // Data flows child -> parent (arrows point up, per this
            // component's own convention) — so an edge reads as "actively
            // moving" when its *child* end is a live, still-running node,
            // a marching-ants dash plus an emerald arrowhead instead of
            // the plain static gray line.
            const childNid = child.node.Nid ?? nodeIds?.get(child.node);
            const childLive = childNid != null ? liveNodes?.[childNid] : undefined;
            // Edge animates only when the child is currently producing
            // tuples on the latest poll — the raw `growing` bit, not
            // the classifier's 'active' state. 'active' now covers both
            // producers and hoarder-consumers whose subtree is growing,
            // but a consumer hasn't emitted anything yet so its outgoing
            // edge shouldn't read as "data flowing up" here.
            const flowing = !finished && childLive?.growing === true;
            // Dim edges that don't touch the highlighted slice.
            // An edge "belongs" to a slice iff either endpoint is in it —
            // that keeps the slice-boundary edges (Motion → its parent
            // slice's consumer) fully visible when either side is picked.
            const parentSlice = ln.node['Slice'];
            const childSlice = child.node['Slice'];
            const edgeDimmed = highlightSlice != null
              && parentSlice !== highlightSlice
              && childSlice !== highlightSlice;
            return (
              <path
                key={`${ln.node.Nid ?? ln.x}-${i}`}
                d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                fill="none"
                stroke={flowing ? '#10b981' : t.edgeStroke}
                strokeWidth={flowing ? 2 : 1.5}
                strokeLinecap="round"
                className={flowing ? 'pg-edge-flow' : undefined}
                markerEnd={flowing ? 'url(#pg-arrow-active)' : 'url(#pg-arrow)'}
                style={{ opacity: edgeDimmed ? 0.35 : 1, transition: 'opacity 200ms' }}
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

          // The same progress, encoded twice: the 6px strip below for a
          // precise read up close, and a rising tint behind the text for
          // an at-a-glance read at any zoom. The tint is a background
          // colour, not a decoration — no crest line, no bubbles, no
          // text-shadow — which is what separates it from the liquid fill
          // 4421d3a removed for covering text. State maps onto it as:
          //   active, pct known   — tint to pct%, full alpha, wave surface
          //   active, pct unknown — tint to the slowest input's level
          //                         (inputBoundPct) at 0.45×, wave surface;
          //                         with no measured input at all the
          //                         wave laps at the bottom ("alive, but
          //                         nothing to go on yet")
          //   completed           — full-height at 0.65×, flat, still
          //   idle                — none
          // Active is the brightest of the three on purpose: zoomed out,
          // the thing worth spotting is the frontier where work is
          // happening now, and a field of equally solid finished cards
          // would bury it.
          const alpha = tintAlpha(zoom, lightCanvas);
          const tintAlphaFor = state === 'completed' ? alpha * 0.65 : showShimmer ? alpha * 0.45 : alpha;
          const boundPct = showShimmer ? (inputBoundPct.get(ln) ?? 0) : null;
          const tintPct = state === 'completed' ? 100 : state === 'active' ? (boundPct ?? greenFillPct) : 0;
          const tintRgba = (a: number) => `rgba(16,185,129,${a})`;
          const waveRgba = (a: number) => `rgba(${lightCanvas ? WAVE_RGB_LIGHT : WAVE_RGB_DARK},${Math.min(WAVE_ALPHA_MAX, a)})`;
          // The wave layers run well above the body's alpha (and in the
          // surface colour, see WAVE_RGB_*) — at the body's own alpha the
          // motion didn't register on either canvas. At 1× dark this is
          // ~0.42 for the back layer; zinc-100 over it still clears 5:1.
          const waveAlpha = tintAlphaFor * WAVE_ALPHA_MULT;
          // Where the wave box sits: its vertical middle is the surface.
          const waveBottom = `calc(${tintPct}% - ${WAVE_H / 2}px)`;
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

          const cardDimmed = highlightSlice != null && sliceId !== highlightSlice;
          const cardHighlighted = highlightSlice != null && sliceId === highlightSlice;
          // When a slice is isolated, keep non-members visible but muted
          // (~half opacity) so the tree structure and edges stay
          // legible — the earlier 0.22 read as "almost invisible", which
          // hid everything the user still wanted as context. Members of
          // the highlighted slice get an outer ring in their own slice
          // color as a positive contrast on top of the negative dimming.
          let effectiveBoxShadow = boxShadow;
          if (cardHighlighted && sliceHex) {
            const ring = `0 0 0 2px ${sliceHex}, 0 0 12px 2px ${sliceHex}66`;
            effectiveBoxShadow = boxShadow ? `${ring}, ${boxShadow}` : ring;
          }
          return (
            <button
              key={nid ?? i}
              onClick={() => setSelected(node)}
              className={`absolute rounded-lg border ${borderColor} ${t.card} text-left transition-[opacity,box-shadow,border-color] duration-200 overflow-hidden ${isSelected ? 'shadow-sm' : ''} hover:border-blue-400`}
              style={{
                left: px(ln.x) - NODE_W / 2 + (ln.stacked ? STACK_INDENT_PX : 0),
                top: py(ln.depth), width: NODE_W, height: NODE_H,
                boxShadow: effectiveBoxShadow,
                opacity: cardDimmed ? 0.5 : 1,
              }}
            >
              {/* Rising tint — first children so everything else paints
                  over them. Starts right of the slice stripe (left-1.5 =
                  its width). The body is flat colour; while active, its
                  top edge is the two wave layers below, whose bottoms meet
                  the body top so the liquid is one continuous shape. Wave
                  SVGs are 2× the card width with two identical periods, so
                  translateX(-50%) is exactly one period — a seamless loop.
                  Back and front slide at different speeds with opposite
                  crest polarity: each layer's peak shows through the
                  other's trough, and that parallax is what reads as
                  moving water. Where they overlap the alpha roughly
                  doubles, giving a soft brighter band at the surface —
                  soft, because both layers are the tint's own colour. */}
              {tintPct > 0 && (
                <div
                  className="absolute left-1.5 right-0 bottom-0 transition-[height] duration-500"
                  style={{
                    height: state === 'active' ? `calc(${tintPct}% - ${WAVE_H / 2}px)` : `${tintPct}%`,
                    backgroundColor: tintRgba(tintAlphaFor),
                  }}
                  aria-hidden="true"
                />
              )}
              {state === 'active' && (
                <>
                  <svg
                    aria-hidden="true"
                    className="absolute left-1.5 pg-wave-back pointer-events-none transition-[bottom] duration-500"
                    preserveAspectRatio="none"
                    viewBox="0 0 200 20"
                    style={{ bottom: waveBottom, width: 'calc((100% - 6px) * 2)', height: WAVE_H }}
                  >
                    <path d="M0,10 Q25,-2 50,10 T100,10 T150,10 T200,10 V20 H0 Z" fill={waveRgba(waveAlpha)} />
                  </svg>
                  <svg
                    aria-hidden="true"
                    className="absolute left-1.5 pg-wave-front pointer-events-none transition-[bottom] duration-500"
                    preserveAspectRatio="none"
                    viewBox="0 0 200 20"
                    style={{ bottom: waveBottom, width: 'calc((100% - 6px) * 2)', height: WAVE_H }}
                  >
                    <path d="M0,10 Q25,22 50,10 T100,10 T150,10 T200,10 V20 H0 Z" fill={waveRgba(waveAlpha * 0.75)} />
                  </svg>
                </>
              )}
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
                  "still working" cue. The tint above is the same number
                  at card scale, for when this strip is too small to see.
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
                  role="button"
                  tabIndex={0}
                  className="absolute top-1 right-1.5 text-[9px] font-mono font-semibold px-1 rounded cursor-pointer hover:brightness-125"
                  style={{ color: sliceHex, backgroundColor: `${sliceHex}22`, border: `1px solid ${sliceHex}55` }}
                  title={highlightSlice === sliceId ? `slice ${sliceId} — click to clear` : `slice ${sliceId} — click to isolate`}
                  onClick={(e) => { e.stopPropagation(); toggleHighlight(sliceId); }}
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
                className={`relative text-[11px] font-semibold ${t.textLabel} leading-snug break-words line-clamp-2 pl-7 pr-8 pt-1.5`}
                title={label}
              >
                {label}
              </div>
              <div
                className={`relative pl-7 pr-2 text-[10px] ${t.textRelation} truncate`}
                title={relation || undefined}
              >
                {relation ? `on ${relation}` : ' '}
              </div>
              <div className={`relative pl-7 pr-2 text-[10px] font-mono flex items-center gap-1 ${t.textRows}`}>
                {state === 'active' && (
                  <span className="w-1 h-1 rounded-full bg-emerald-400 inline-block shrink-0 animate-pulse" />
                )}
                {state === 'active'
                  // "active" now covers two cases: a producer growing its
                  // own rows, and a hoarder consumer whose subtree is
                  // growing (Partial HashAgg pulling from a live HashJoin
                  // below). Only the former has a measurable count to
                  // show; the latter reads as "consuming" so it doesn't
                  // render as blank or "0 rows".
                  ? (live && live.rows > 0
                      ? `${live.rows.toLocaleString()} rows${pct != null ? ` ~${pct}%` : ''}`
                      : 'consuming')
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
      {(() => {
        // Minimap. Only render once we know the viewport size AND the
        // content actually overflows or is a candidate for panning; on a
        // tiny plan that fits fully it just clutters. Threshold: content
        // bigger than viewport in either axis by at least 20 px.
        if (viewportSize.w <= 0 || viewportSize.h <= 0) return null;
        const contentOverflows = width > viewportSize.w + 20 || height > viewportSize.h + 20;
        if (!contentOverflows) return null;

        const scale = Math.min(
          (MINIMAP_W - MINIMAP_PAD * 2) / width,
          (MINIMAP_H - MINIMAP_PAD * 2) / height,
        );
        const mx = (cx: number) => MINIMAP_PAD + cx * scale;
        const my = (cy: number) => MINIMAP_PAD + cy * scale;
        // Visible content region right now
        const vpX = -pan.x / zoom;
        const vpY = -pan.y / zoom;
        const vpW = viewportSize.w / zoom;
        const vpH = viewportSize.h / zoom;

        const handleJump = (e: import('react').MouseEvent<SVGSVGElement>) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickMx = e.clientX - rect.left - MINIMAP_PAD;
          const clickMy = e.clientY - rect.top - MINIMAP_PAD;
          const cx = clickMx / scale;
          const cy = clickMy / scale;
          setPan({ x: viewportSize.w / 2 - cx * zoom, y: viewportSize.h / 2 - cy * zoom });
        };

        return (
          <div
            className={`absolute bottom-2 right-2 rounded border ${lightCanvas ? 'border-zinc-300 bg-white/95' : 'border-zinc-700 bg-zinc-900/95'} overflow-hidden shadow-lg`}
            style={{ width: MINIMAP_W, height: MINIMAP_H }}
            // Stop pan / click-outside handlers on the viewport from
            // firing when the user interacts with the minimap.
            onPointerDown={e => e.stopPropagation()}
            onPointerMove={e => e.stopPropagation()}
            onPointerUp={e => e.stopPropagation()}
          >
            <svg
              width={MINIMAP_W}
              height={MINIMAP_H}
              onClick={handleJump}
              style={{ cursor: 'pointer' }}
            >
              {allNodes.map((ln, i) => {
                const cardLeft = px(ln.x) - NODE_W / 2 + (ln.stacked ? STACK_INDENT_PX : 0);
                const cardTop = py(ln.depth);
                const hex = sliceColor(ln.node['Slice']) ?? (lightCanvas ? '#94a3b8' : '#71717a');
                return (
                  <rect
                    key={i}
                    x={mx(cardLeft)} y={my(cardTop)}
                    width={NODE_W * scale} height={NODE_H * scale}
                    fill={hex} opacity={0.75} rx={1}
                  />
                );
              })}
              <rect
                x={mx(vpX)} y={my(vpY)}
                width={vpW * scale} height={vpH * scale}
                fill="none"
                stroke={lightCanvas ? '#0f172a' : '#f4f4f5'}
                strokeWidth={1.5}
              />
            </svg>
          </div>
        );
      })()}
    </div>
  );

  const detail = selected && (
    <div ref={detailRef} className="mt-3 rounded border border-zinc-800 bg-zinc-900 p-3 text-xs">
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
    <SliceSummaryPanel
      slices={sliceSummaries}
      runTimeMs={runTimeMs ?? 0}
      estProgressPct={estProgressPct ?? null}
      highlightSlice={highlightSlice}
      onToggleHighlight={toggleHighlight}
    />
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
