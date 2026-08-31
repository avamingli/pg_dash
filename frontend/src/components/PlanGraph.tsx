import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Table2, GitMerge, Sigma, Share2, ArrowUpDown, Filter, Layers, Box,
  ZoomIn, ZoomOut, Maximize2, RotateCcw, Expand, Minimize2, X,
} from 'lucide-react';
import {
  type PlanNode, type LiveNodeStats,
  nodeLabel, sliceLabel, rowEstimateRatio, getTotalTime, formatMs, estimateCompletionPct,
} from '@/lib/planTree';

// GPCC-style node-and-arrow plan diagram: leaves at the bottom, root at the
// top, arrows pointing up (the direction data actually flows) — a
// deliberately different visual language from PlanViewer's indented tree,
// aimed at "see every node's state at a glance" rather than "drill down
// one branch at a time".

const NODE_W = 176;
const NODE_H = 60;
const H_GAP = 28;
const V_GAP = 46;
const PAD = 24;

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

function nodeIcon(label: string) {
  if (label.includes('Scan')) return Table2;
  if (label.includes('Join') || label.includes('Nested Loop')) return GitMerge;
  if (label.includes('Aggregate')) return Sigma;
  if (label.includes('Motion')) return Share2;
  if (label.includes('Sort')) return ArrowUpDown;
  if (label.includes('Append') || label.includes('Sequence')) return Layers;
  if (label.includes('Limit') || label.includes('Unique') || label.includes('SetOp')) return Filter;
  return Box;
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
  /** Query has ended — switches the live green fill/pulse to a calmer "done" look. */
  finished?: boolean;
  /** Viewport height available for the graph; defaults to a fixed size for the Watch panel's fixed-width sidebar. Ignored in fullscreen mode. */
  maxHeight?: number;
}

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
// A pointer that hasn't moved past this many px is still a click (opens the
// node's detail panel), not a pan — otherwise a hand tremor while clicking
// a node would fall through as a 1px drag instead.
const PAN_CLICK_THRESHOLD = 4;

export default function PlanGraph({ root, rootTime, nodeIds, liveNodes, finished, maxHeight = 460 }: PlanGraphProps) {
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
          </defs>
          {allNodes.flatMap(ln => ln.children.map((child, i) => {
            const x1 = px(child.x), y1 = py(child.depth);
            const x2 = px(ln.x), y2 = py(ln.depth) + NODE_H;
            const midY = (y1 + y2) / 2;
            return (
              <path
                key={`${ln.node.Nid ?? ln.x}-${i}`}
                d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                fill="none"
                stroke="#52525b"
                strokeWidth={1.5}
                markerEnd="url(#pg-arrow)"
              />
            );
          }))}
        </svg>

        {allNodes.map((ln, i) => {
          const node = ln.node;
          const label = nodeLabel(node);
          const Icon = nodeIcon(label);
          const nid = node.Nid ?? nodeIds?.get(node);
          const live = nid != null ? liveNodes?.[nid] : undefined;
          const estRows = node['Plan Rows'];
          const pct = estimateCompletionPct(live, estRows, !!finished);
          const ratio = rowEstimateRatio(node);
          const isSelected = selected === node;
          const relation = node['Relation Name'];
          const slice = sliceLabel(node);

          const borderColor = isSelected
            ? 'border-blue-500'
            : ratio > 10
              ? 'border-red-500/50'
              : live != null
                ? finished ? 'border-blue-600/50' : 'border-emerald-600/60'
                : 'border-zinc-700';

          // Liquid-fill progress, rising from the bottom — the closest
          // honest equivalent to GPCC's wave decoration we can draw from
          // real data: a known % fills that far; an active node whose %
          // isn't computable yet gets an indeterminate shimmer instead of a
          // fabricated height. Both layers stay mounted the whole time
          // (never conditionally unmounted) and cross-fade via opacity —
          // swapping which div renders would swap DOM nodes, which skips
          // any CSS transition entirely, which is exactly why the
          // running(green)->finished(blue) switch used to look like a hard
          // jump instead of the smooth 500ms color/height change below.
          const fillPct = pct != null ? Math.min(100, Math.max(4, pct)) : null;
          const showShimmer = fillPct == null && !finished;

          return (
            <button
              key={nid ?? i}
              onClick={() => setSelected(node)}
              className={`absolute rounded-md border ${borderColor} bg-zinc-900 text-left shadow-sm hover:border-blue-400 transition-colors duration-500 overflow-hidden`}
              style={{ left: px(ln.x) - NODE_W / 2, top: py(ln.depth), width: NODE_W, height: NODE_H }}
            >
              {live != null && (
                <>
                  <div
                    className="absolute bottom-0 left-0 right-0 h-full pg-shimmer transition-opacity duration-500"
                    style={{ opacity: showShimmer ? 1 : 0 }}
                  />
                  <div
                    className={`absolute bottom-0 left-0 right-0 transition-all duration-500 ${finished ? 'bg-blue-500/25' : 'bg-emerald-500/25'}`}
                    style={{ height: `${fillPct ?? 4}%`, opacity: showShimmer ? 0 : 1 }}
                  />
                </>
              )}

              <div className="relative flex items-center gap-1.5 px-2 pt-1.5">
                <Icon size={12} className="text-zinc-400 shrink-0" />
                <span className="text-[11px] font-semibold text-zinc-100 truncate">{label}</span>
              </div>
              <div className="relative px-2 text-[10px] text-zinc-500 truncate">
                {relation ? `on ${relation}` : slice ?? ' '}
              </div>
              <div className={`relative px-2 text-[10px] font-mono flex items-center gap-1 transition-colors duration-500 ${finished ? 'text-blue-300' : 'text-emerald-300'}`}>
                {live != null && (
                  <span className={`w-1 h-1 rounded-full bg-emerald-400 inline-block shrink-0 transition-opacity duration-500 ${finished ? 'opacity-0' : 'opacity-100 animate-pulse'}`} />
                )}
                {live != null ? `${live.rows.toLocaleString()} rows${pct != null ? ` ~${pct}%` : ''}` : ' '}
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
      <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-zinc-400">
        {selected['Relation Name'] && (
          <div className="col-span-2">Relation: <span className="text-zinc-200 font-mono">{selected['Relation Name']}</span></div>
        )}
        <div>Estimated Rows: <span className="text-zinc-200 font-mono">{selected['Plan Rows']?.toLocaleString() ?? '—'}</span></div>
        <div>
          Estimated Completion:{' '}
          <span className="text-zinc-200 font-mono">
            {selNid != null && estimateCompletionPct(selLive, selected['Plan Rows'], !!finished) != null
              ? `${estimateCompletionPct(selLive, selected['Plan Rows'], !!finished)}%`
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
        <div className="w-full h-full max-w-[1800px] bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col p-4 overflow-hidden">
          <div className="flex items-center justify-between">
            {toolbar}
            <button onClick={() => setIsFullscreen(false)} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 mb-2" title="Close (Esc)">
              <X size={16} />
            </button>
          </div>
          {canvas}
          <div className="overflow-y-auto shrink-0 max-h-[35%]">{detail}</div>
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div className="p-4">
      {toolbar}
      {canvas}
      {detail}
    </div>
  );
}
