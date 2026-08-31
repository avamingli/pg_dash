import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { QueryProgressPlanNode } from '@/types/metrics';

// ── Types ──

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Schema'?: string;
  'Alias'?: string;
  'Startup Cost'?: number;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  'Plan Width'?: number;
  'Actual Startup Time'?: number;
  'Actual Total Time'?: number;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  'Temp Read Blocks'?: number;
  'Temp Written Blocks'?: number;
  'Output'?: string[];
  'Filter'?: string;
  'Join Filter'?: string;
  'Index Cond'?: string;
  'Sort Key'?: string[];
  'Sort Method'?: string;
  'Hash Cond'?: string;
  'Workers Planned'?: number;
  'Workers Launched'?: number;
  'Partial Mode'?: string;
  'Strategy'?: string;
  'Operation'?: string;
  'Parallel Aware'?: boolean;
  'Slice'?: number;
  'Segments'?: number;
  'Senders'?: number;
  'Receivers'?: number;
  /**
   * Only set when this tree was built from the real WHPG plan-shmem
   * capture (buildRealPlanTree), not from parsing EXPLAIN JSON — the true
   * plan_node_id, no assignNodeIds guessing needed. See PlanNodeView's nid
   * lookup, which prefers this over the assignNodeIds-derived Map.
   */
  Nid?: number;
  Plans?: PlanNode[];
  [key: string]: unknown;
}

export interface LiveNodeStats {
  rows: number;
  segments: number;
}

interface PlanViewerProps {
  plan: unknown;
  /**
   * Live per-node progress, keyed by plan_node_id. plan_node_id isn't part
   * of EXPLAIN's JSON output, so it's not something this component can read
   * off a node directly — the caller must pre-compute it with assignNodeIds
   * (exported below) applied to the same parsed plan. That function handles
   * both PostgreSQL's planner (setrefs.c: plain pre-order, parent before
   * children) and GPORCA's translator, which numbers one specific shape of
   * join differently — see assignNodeIds' own comment. Verified against
   * live clusters for both; may still drift for subplans/CTEs.
   *
   * Unused (nid comes straight off each node instead) when realPlan is
   * provided and non-empty.
   */
  liveNodes?: Record<number, LiveNodeStats>;
  /**
   * WHPG's real plan-shmem capture, when the connected server has it
   * (Capabilities.RealPlanShmem) — the true tree the kernel captured at
   * query start, not a reconstruction from a fresh EXPLAIN. Takes priority
   * over `plan` for tree structure when present and non-empty; `plan` is
   * still used for the Optimizer badge and the "Raw JSON" toggle.
   */
  realPlan?: QueryProgressPlanNode[];
}

const INDEX_NLJ_INNER_TYPES = new Set([
  'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan',
]);

/**
 * Assigns each node in a parsed EXPLAIN plan tree a sequential id matching
 * how GPDB assigns plan_node_id, so live per-node stats keyed by that id can
 * be matched back to a tree node.
 *
 * PostgreSQL's planner (setrefs.c) always numbers a node before recursing
 * into lefttree then righttree — plain pre-order, outer child before inner.
 * GPORCA's translator (CTranslatorDXLToPlStmt::TranslateDXLNLJoin) does too,
 * *except* for a plain (non-index) Nested Loop Join: it numbers the INNER
 * (right) child before the OUTER (left) one — the function's own comment:
 * "left child may include a PartitionSelector with references to right
 * child's columns, we need to translate right child first". An index NLJ's
 * inner side (an Index/Bitmap scan re-driven by each outer row's value, so
 * it's never cached) keeps the normal order — TranslateDXLHashJoin, for
 * comparison, never reorders at all. Confirmed empirically against a live
 * WarehousePG cluster: without this special case, live row counts for any
 * ORCA broadcast/partition-wise Nested Loop land on the wrong node.
 */
export function assignNodeIds(root: PlanNode, isORCA: boolean): Map<PlanNode, number> {
  const ids = new Map<PlanNode, number>();
  let next = 0;
  function visit(node: PlanNode) {
    ids.set(node, next++);
    const children = node.Plans ?? [];
    const isNonIndexNLJ =
      isORCA &&
      node['Node Type'] === 'Nested Loop' &&
      children.length === 2 &&
      !INDEX_NLJ_INNER_TYPES.has(children[1]['Node Type']);
    if (isNonIndexNLJ) {
      visit(children[1]); // inner first
      visit(children[0]); // outer second
    } else {
      children.forEach(visit);
    }
  }
  visit(root);
  return ids;
}

/**
 * Builds a PlanNode tree straight from WHPG's real plan-shmem capture
 * (query_metrics.gp_plan_shmem_detail, one row per segment per node) —
 * the actual plan_node_id/parent/label the kernel captured when the query
 * started, not a guess reconstructed from a fresh EXPLAIN. Field names on
 * the resulting PlanNode deliberately match what parsePlan produces from
 * EXPLAIN JSON, so nodeLabel/nodeColor/PlanNodeView don't need to know
 * which source they're rendering.
 *
 * Rows arrive once per segment, but the structure itself (nid/parent_nid/
 * node_type/...) is identical across every segment that ran below the
 * same slice — the QD's own rows are the only ones that also cover the
 * QD-only nodes above the top Motion, so they're preferred wherever a nid
 * appears on both.
 */
export function buildRealPlanTree(rows: QueryProgressPlanNode[]): PlanNode | null {
  if (!rows || rows.length === 0) return null;

  const byNid = new Map<number, QueryProgressPlanNode>();
  for (const row of rows) {
    if (!byNid.has(row.nid) || row.segid === -1) byNid.set(row.nid, row);
  }

  const nodes = new Map<number, PlanNode>();
  for (const [nid, row] of byNid) {
    nodes.set(nid, {
      'Node Type': row.node_type,
      'Relation Name': row.relname ?? undefined,
      'Plan Rows': row.plan_rows,
      'Startup Cost': row.startup_cost,
      'Total Cost': row.total_cost,
      'Plan Width': row.plan_width,
      'Strategy': row.strategy ?? undefined,
      'Partial Mode': row.partial_mode ?? undefined,
      'Operation': row.operation ?? undefined,
      'Parallel Aware': row.parallel_aware,
      'Senders': row.motion_senders ?? undefined,
      'Receivers': row.motion_receivers ?? undefined,
      Nid: nid,
      Plans: [],
    });
  }

  let root: PlanNode | null = null;
  for (const [nid, row] of byNid) {
    const node = nodes.get(nid)!;
    if (row.parent_nid < 0 || !nodes.has(row.parent_nid)) {
      root = node; // parent_nid is -1 for the true root on every capturing process
    } else {
      nodes.get(row.parent_nid)!.Plans!.push(node);
    }
  }
  return root;
}

// ── Helpers ──

function parsePlan(raw: unknown): PlanNode | null {
  try {
    // EXPLAIN FORMAT JSON returns [{ "Plan": {...} }]
    let data = raw;
    if (typeof data === 'string') data = JSON.parse(data);
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      if (first.Plan) return first.Plan as PlanNode;
      return first as PlanNode;
    }
    if (typeof data === 'object' && data !== null && 'Plan' in data) {
      return (data as Record<string, unknown>).Plan as PlanNode;
    }
    return data as PlanNode;
  } catch {
    return null;
  }
}

// EXPLAIN's top-level "Optimizer" property — "GPORCA" or "Postgres-based
// planner" — sits alongside "Plan", not inside it, so this mirrors
// parsePlan's own unwrapping instead of reading it off the returned node.
function parseOptimizer(raw: unknown): string | undefined {
  try {
    let data = raw;
    if (typeof data === 'string') data = JSON.parse(data);
    if (Array.isArray(data) && data.length > 0) data = data[0];
    if (typeof data === 'object' && data !== null && 'Optimizer' in data) {
      return (data as Record<string, unknown>).Optimizer as string;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function getTotalTime(node: PlanNode): number {
  return (node['Actual Total Time'] ?? 0) * (node['Actual Loops'] ?? 1);
}

function getRootTotalTime(root: PlanNode): number {
  return getTotalTime(root);
}

function rowEstimateRatio(node: PlanNode): number {
  const planned = node['Plan Rows'] ?? 0;
  const actual = node['Actual Rows'] ?? 0;
  if (planned === 0) return actual > 0 ? 999 : 1;
  return actual / planned;
}

function nodeColor(node: PlanNode, rootTime: number): string {
  const ratio = rowEstimateRatio(node);
  const nodeTime = getTotalTime(node);
  const timePct = rootTime > 0 ? nodeTime / rootTime : 0;

  // Red: massive estimate error (actual > 10x planned)
  if (ratio > 10) return 'border-red-500/60 bg-red-500/5';
  // Orange: this node takes > 50% of total time
  if (timePct > 0.5) return 'border-orange-500/60 bg-orange-500/5';
  // Yellow: sequential scan on table with > 10K rows
  if (node['Node Type']?.includes('Seq Scan') && (node['Actual Rows'] ?? 0) > 10000) {
    return 'border-yellow-500/60 bg-yellow-500/5';
  }
  return 'border-zinc-700 bg-zinc-900/50';
}

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(3)}s`;
}

// Mirrors EXPLAIN's own TEXT-format node label so the tree view reads the
// same way "Finalize Aggregate" / "Gather Motion 3:1" would in a terminal —
// JSON format never bakes this into "Node Type" itself, it's spread across
// separate properties (Partial Mode, Senders, Receivers) that TEXT format
// combines for you.
function nodeLabel(node: PlanNode): string {
  let label = node['Node Type'];

  // explain.c's JSON output always writes "Aggregate"/"SetOp" as Node Type
  // regardless of strategy — sname, not the strategy-specific pname TEXT
  // format actually prints — and puts the real distinction in a separate
  // "Strategy" property instead. Same reasoning as Partial Mode/Motion
  // below: JSON spreads across properties what TEXT combines into one name.
  if (label === 'Aggregate') {
    if (node['Strategy'] === 'Sorted') label = 'GroupAggregate';
    else if (node['Strategy'] === 'Hashed') label = 'HashAggregate';
    else if (node['Strategy'] === 'Mixed') label = 'MixedAggregate';
    if (node['Partial Mode'] && node['Partial Mode'] !== 'Simple') {
      label = `${node['Partial Mode']} ${label}`;
    }
  } else if (label === 'SetOp' && node['Strategy'] === 'Hashed') {
    label = 'HashSetOp';
  } else if (label === 'ModifyTable' && node['Operation']) {
    // explain.c's TEXT pname for a ModifyTable is the operation itself
    // ("Insert"/"Update"/"Delete"), not "ModifyTable" — sname (JSON's
    // "Node Type") stays generic and puts the real value in "Operation".
    label = node['Operation'];
  } else if ((label === 'Foreign Scan' || label === 'Dynamic Foreign Scan') && node['Operation'] && node['Operation'] !== 'Select') {
    label = `${label.replace('Scan', node['Operation'])}`;
  }

  if (node['Parallel Aware']) {
    label = `Parallel ${label}`;
  }
  if (node['Senders'] != null && node['Receivers'] != null) {
    label = `${label} ${node['Senders']}:${node['Receivers']}`;
  }
  return label;
}

// EXPLAIN TEXT shows "(slice1; segments: 3)" after a node whenever it's not
// slice 0 (the coordinator-only slice) — same condition here.
function sliceLabel(node: PlanNode): string | null {
  if (node['Slice'] == null || node['Slice'] === 0) return null;
  const segments = node['Segments'] != null ? `; segments: ${node['Segments']}` : '';
  return `slice${node['Slice']}${segments}`;
}

// ── Components ──

function PlanNodeView({ node, depth, rootTime, nodeIds, liveNodes }: {
  node: PlanNode;
  depth: number;
  rootTime: number;
  nodeIds?: Map<PlanNode, number>;
  liveNodes?: Record<number, LiveNodeStats>;
}) {
  // Default every node expanded — this is a monitoring view where the
  // point is seeing every node's live progress at a glance, not a deeply
  // nested EXPLAIN browser where collapsing saves space; a real join
  // query's interesting nodes (joins, scans) usually sit past depth 3
  // anyway, and re-expanding them by hand on every fresh Watch was exactly
  // the complaint.
  const [open, setOpen] = useState(true);
  const hasChildren = node.Plans && node.Plans.length > 0;
  const actualTime = getTotalTime(node);
  const timePct = rootTime > 0 ? (actualTime / rootTime * 100) : 0;
  const ratio = rowEstimateRatio(node);
  const color = nodeColor(node, rootTime);
  const nid = node.Nid ?? nodeIds?.get(node);
  const live = nid != null ? liveNodes?.[nid] : undefined;
  const estRows = node['Plan Rows'];
  // Plan Rows is GPDB's per-segment estimate for a distributed node, but
  // live.rows is summed across every segment reporting for this node — divide
  // back down to a per-segment average before comparing, or the ratio comes
  // out inflated by roughly the segment count regardless of how good the
  // optimizer's estimate actually is.
  const completionPct = live != null && estRows && live.segments > 0
    ? Math.min(999, Math.round((live.rows / live.segments / estRows) * 100))
    : null;

  const relation = node['Relation Name']
    ? `${node['Schema'] ? node['Schema'] + '.' : ''}${node['Relation Name']}${node['Alias'] && node['Alias'] !== node['Relation Name'] ? ` (${node['Alias']})` : ''}`
    : '';

  return (
    <div className="relative" style={{ marginLeft: depth > 0 ? 20 : 0 }}>
      {/* Connector line */}
      {depth > 0 && (
        <div className="absolute left-[-12px] top-0 bottom-0 w-px bg-zinc-700" />
      )}
      {depth > 0 && (
        <div className="absolute left-[-12px] top-[16px] w-[12px] h-px bg-zinc-700" />
      )}

      <div className={`rounded border ${color} mb-1`}>
        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
          onClick={() => setOpen(!open)}
        >
          {hasChildren ? (
            open ? <ChevronDown size={14} className="text-zinc-500 shrink-0" /> : <ChevronRight size={14} className="text-zinc-500 shrink-0" />
          ) : (
            <span className="w-[14px] shrink-0" />
          )}

          <span className="font-mono text-xs text-blue-400 font-semibold">{nodeLabel(node)}</span>
          {relation && <span className="text-xs text-zinc-400">on {relation}</span>}
          {sliceLabel(node) && (
            <span className="text-[10px] text-zinc-600 font-mono">({sliceLabel(node)})</span>
          )}

          <div className="ml-auto flex items-center gap-3 text-xs">
            {/* Time */}
            {node['Actual Total Time'] != null && (
              <span className={`font-mono ${timePct > 50 ? 'text-orange-400 font-bold' : 'text-zinc-400'}`}>
                {formatMs(actualTime)} ({timePct.toFixed(1)}%)
              </span>
            )}

            {/* Rows: actual vs planned */}
            {node['Actual Rows'] != null && (
              <span className={`font-mono ${ratio > 10 ? 'text-red-400 font-bold' : ratio > 3 ? 'text-yellow-400' : 'text-zinc-500'}`}>
                {node['Actual Rows']?.toLocaleString()} rows
                {node['Plan Rows'] != null && (
                  <span className="text-zinc-600"> / est {node['Plan Rows']?.toLocaleString()}</span>
                )}
              </span>
            )}

            {/* Loops */}
            {(node['Actual Loops'] ?? 1) > 1 && (
              <span className="text-zinc-600">x{node['Actual Loops']}</span>
            )}

            {/* Live progress (query still running — no Actual Rows/Time yet) */}
            {live != null && (
              <span className="flex items-center gap-1.5 font-mono text-emerald-400" title={`${live.segments} segment(s) reporting`}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                {live.rows.toLocaleString()} rows
                {completionPct != null && (
                  <span className="text-emerald-500/70">~{completionPct}%</span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Details (when expanded) */}
        {open && (
          <div className="px-3 pb-2 text-xs space-y-1 border-t border-zinc-800/50 pt-1.5">
            {/* Buffers */}
            {(node['Shared Hit Blocks'] || node['Shared Read Blocks']) && (
              <div className="flex gap-4 text-zinc-500">
                <span>Shared Hit: <span className="text-zinc-300">{node['Shared Hit Blocks']?.toLocaleString()}</span></span>
                <span>Read: <span className="text-zinc-300">{node['Shared Read Blocks']?.toLocaleString()}</span></span>
                {node['Temp Written Blocks'] ? (
                  <span>Temp Write: <span className="text-yellow-400">{node['Temp Written Blocks']?.toLocaleString()}</span></span>
                ) : null}
              </div>
            )}

            {/* Filter / Conditions */}
            {node['Filter'] && (
              <div className="text-zinc-500">Filter: <span className="text-zinc-300 font-mono">{node['Filter']}</span></div>
            )}
            {node['Index Cond'] && (
              <div className="text-zinc-500">Index Cond: <span className="text-zinc-300 font-mono">{node['Index Cond']}</span></div>
            )}
            {node['Hash Cond'] && (
              <div className="text-zinc-500">Hash Cond: <span className="text-zinc-300 font-mono">{node['Hash Cond']}</span></div>
            )}
            {node['Join Filter'] && (
              <div className="text-zinc-500">Join Filter: <span className="text-zinc-300 font-mono">{node['Join Filter']}</span></div>
            )}
            {node['Sort Key'] && (
              <div className="text-zinc-500">Sort Key: <span className="text-zinc-300 font-mono">{node['Sort Key'].join(', ')}</span>
                {node['Sort Method'] && <span className="ml-2 text-zinc-400">({node['Sort Method']})</span>}
              </div>
            )}
            {node['Workers Planned'] != null && (
              <div className="text-zinc-500">
                Workers: <span className="text-zinc-300">{node['Workers Launched'] ?? 0} / {node['Workers Planned']} planned</span>
              </div>
            )}

            {/* Cost */}
            <div className="flex gap-4 text-zinc-600">
              <span>Cost: {node['Startup Cost']?.toFixed(2)}..{node['Total Cost']?.toFixed(2)}</span>
              <span>Width: {node['Plan Width']}</span>
            </div>
          </div>
        )}
      </div>

      {/* Children */}
      {open && hasChildren && (
        <div className="relative">
          {node.Plans!.map((child, i) => (
            <PlanNodeView key={i} node={child} depth={depth + 1} rootTime={rootTime} nodeIds={nodeIds} liveNodes={liveNodes} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function PlanViewer({ plan, liveNodes, realPlan }: PlanViewerProps) {
  const [showRaw, setShowRaw] = useState(false);
  const usingRealPlan = !!realPlan && realPlan.length > 0;
  const root = usingRealPlan ? buildRealPlanTree(realPlan!) : parsePlan(plan);
  const isORCA = parseOptimizer(plan) === 'GPORCA';
  const nodeIds = !usingRealPlan && root ? assignNodeIds(root, isORCA) : undefined;

  if (!root) {
    return (
      <div className="p-4">
        <p className="text-xs text-zinc-500 mb-2">Could not parse execution plan. Raw output:</p>
        <pre className="bg-zinc-900 border border-zinc-700 rounded p-3 text-xs text-zinc-300 whitespace-pre-wrap max-h-[400px] overflow-auto font-mono">
          {typeof plan === 'string' ? plan : JSON.stringify(plan, null, 2)}
        </pre>
      </div>
    );
  }

  const rootTime = getRootTotalTime(root);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span>Total Time: <span className="text-white font-mono">{formatMs(rootTime)}</span></span>
          {usingRealPlan && (
            <span
              className="flex items-center gap-1.5 text-emerald-400"
              title="Structure captured by WHPG's GpCapturePlanShmem at query start — not reconstructed from a fresh EXPLAIN"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              real plan
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Estimate error ({'>'}10x)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" /> Hot path ({'>'}50% time)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> Seq Scan ({'>'}10K rows)
          </span>
        </div>
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="text-xs text-zinc-500 hover:text-white transition-colors"
        >
          {showRaw ? 'Tree View' : 'Raw JSON'}
        </button>
      </div>

      {showRaw ? (
        <pre className="bg-zinc-900 border border-zinc-700 rounded p-3 text-xs text-zinc-300 whitespace-pre-wrap max-h-[400px] overflow-auto font-mono">
          {typeof plan === 'string' ? plan : JSON.stringify(plan, null, 2)}
        </pre>
      ) : (
        <PlanNodeView node={root} depth={0} rootTime={rootTime} nodeIds={nodeIds} liveNodes={liveNodes} />
      )}
    </div>
  );
}
