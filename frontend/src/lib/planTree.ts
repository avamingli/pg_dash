import type { QueryProgressPlanNode } from '@/types/metrics';

// Shared plan-tree types/parsing/labeling logic, used by both PlanViewer
// (indented tree) and PlanGraph (GPCC-style node diagram) — split out so
// the two view components don't import from each other.

export interface PlanNode {
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
   * plan_node_id, no assignNodeIds guessing needed. Consumers should prefer
   * this over an assignNodeIds-derived Map when present.
   */
  Nid?: number;
  Plans?: PlanNode[];
  [key: string]: unknown;
}

export interface LiveNodeStats {
  rows: number;
  segments: number;
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
 * Builds a PlanNode tree straight from the whpg_plan_tree extension's
 * capture (plan_tree.plan_tree_detail, one row per segment per node) —
 * the actual plan_node_id/parent/label the kernel captured when the query
 * started, not a guess reconstructed from a fresh EXPLAIN. Field names on
 * the resulting PlanNode deliberately match what parsePlan produces from
 * EXPLAIN JSON, so nodeLabel/nodeColor/consumers don't need to know which
 * source they're rendering.
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

export function parsePlan(raw: unknown): PlanNode | null {
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
export function parseOptimizer(raw: unknown): string | undefined {
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

export function getTotalTime(node: PlanNode): number {
  return (node['Actual Total Time'] ?? 0) * (node['Actual Loops'] ?? 1);
}

export function getRootTotalTime(root: PlanNode): number {
  return getTotalTime(root);
}

/**
 * A node's "estimated completion" — live actual rows vs. the optimizer's
 * per-segment estimate. Once the whole query has finished, a node can't
 * still be "80% done": an estimate that was simply too high should read as
 * done (100%), not stuck below it forever just because the row count never
 * caught up to a bad estimate. A node whose actual rows exceeded the
 * estimate legitimately reads over 100% either way — 999 is only a display
 * ceiling so a wildly wrong estimate doesn't render some absurd number.
 */
export function estimateCompletionPct(
  live: LiveNodeStats | undefined,
  estRows: number | undefined,
  finished: boolean,
): number | null {
  if (live == null || !estRows || live.segments <= 0) return null;
  const capped = Math.min(999, Math.round((live.rows / live.segments / estRows) * 100));
  return finished ? Math.max(100, capped) : capped;
}

export function rowEstimateRatio(node: PlanNode): number {
  const planned = node['Plan Rows'] ?? 0;
  const actual = node['Actual Rows'] ?? 0;
  if (planned === 0) return actual > 0 ? 999 : 1;
  return actual / planned;
}

export function nodeColor(node: PlanNode, rootTime: number): string {
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

export function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(3)}s`;
}

// Mirrors EXPLAIN's own TEXT-format node label so a label reads the same
// way "Finalize Aggregate" / "Gather Motion 3:1" would in a terminal —
// JSON format never bakes this into "Node Type" itself, it's spread across
// separate properties (Partial Mode, Senders, Receivers) that TEXT format
// combines for you.
export function nodeLabel(node: PlanNode): string {
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
export function sliceLabel(node: PlanNode): string | null {
  if (node['Slice'] == null || node['Slice'] === 0) return null;
  const segments = node['Segments'] != null ? `; segments: ${node['Segments']}` : '';
  return `slice${node['Slice']}${segments}`;
}
