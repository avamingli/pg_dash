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
export function buildRealPlanTree(rows: QueryProgressPlanNode[], segments?: number): PlanNode | null {
  if (!rows || rows.length === 0) return null;

  const byNid = new Map<number, QueryProgressPlanNode>();
  for (const row of rows) {
    if (!byNid.has(row.nid) || row.segid === -1) byNid.set(row.nid, row);
  }

  const nodes = new Map<number, PlanNode>();
  for (const [nid, row] of byNid) {
    // motion_senders/motion_receivers come from whpg_plan_tree, but the
    // shipping version leaves them null on every Motion. Synthesize them
    // from GPDB's own fan-in/fan-out convention when we have a segment
    // count to fill in: Gather = N→1, Broadcast/Redistribute/Explicit = N→N.
    // Non-motion nodes never get counts.
    let senders = row.motion_senders ?? undefined;
    let receivers = row.motion_receivers ?? undefined;
    if (senders == null && receivers == null && segments != null && segments > 0) {
      switch (row.node_type) {
        case 'Gather Motion':          senders = segments; receivers = 1; break;
        case 'Broadcast Motion':
        case 'Redistribute Motion':
        case 'Explicit Motion':        senders = segments; receivers = segments; break;
      }
    }

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
      'Senders': senders,
      'Receivers': receivers,
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

  // Bake slice ids straight onto the tree so downstream (nodeLabel/sliceLabel,
  // PlanViewer's slice pill, PlanGraph's per-node stripe, SliceSummaryPanel's
  // legend) can all read one canonical field instead of re-threading a
  // separate Map<PlanNode,number> everywhere.
  if (root) {
    const sliceMap = computeSliceIds(root);
    for (const [node, sid] of sliceMap) node['Slice'] = sid;
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
  // rows === 0 with any number of segments reporting is our "recycled
  // placeholder" pattern (see aggregateByNode) — a leaf that finished so
  // quickly its worker slots recycled and only the coord dispatcher's
  // empty row remains. Reporting 0% for that reads as "stuck at 0%" even
  // when the node clearly completed (its parent Motion already has rows).
  // Null here means "no measurement" and lets the UI render "—" instead.
  if (live == null || !estRows || live.segments <= 0 || live.rows === 0) return null;
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

// ── Slice grouping & timing (Watch panel's left-side summary) ──

/**
 * Assigns each node a 1-indexed slice id, mirroring how GPDB's own EXPLAIN
 * labels a Motion node with the slice number of the data feeding *into* it
 * (e.g. "Redistribute Motion 3:3 (slice2; segments: 3)"): the root's home
 * slice is 1, and each Motion node encountered while walking down starts a
 * fresh slice for itself and everything below it. Verified against a live
 * WarehousePG EXPLAIN's own slice numbers for a two-slice plan (a root
 * Gather Motion = slice1, a Redistribute Motion further down = slice2).
 * Motion detection is the "Motion" substring in Node Type, which both
 * EXPLAIN JSON and the real whpg_plan_tree capture already use as the
 * label (e.g. "Gather Motion", "Redistribute Motion") — no NodeTag needed.
 */
export function computeSliceIds(root: PlanNode): Map<PlanNode, number> {
  const ids = new Map<PlanNode, number>();
  let counter = 0;
  function visit(node: PlanNode, currentSlice: number) {
    const slice = (currentSlice === 0 || node['Node Type']?.includes('Motion'))
      ? ++counter
      : currentSlice;
    ids.set(node, slice);
    (node.Plans ?? []).forEach(c => visit(c, slice));
  }
  visit(root, 0);
  return ids;
}

/** Flattens a per-node slice-id map down to per-nid, to match against live per-node stats (keyed by nid, not by node object). */
export function sliceIdsByNid(root: PlanNode, sliceIds: Map<PlanNode, number>): Map<number, number> {
  const out = new Map<number, number>();
  function visit(node: PlanNode) {
    if (node.Nid != null) out.set(node.Nid, sliceIds.get(node) ?? 1);
    (node.Plans ?? []).forEach(visit);
  }
  visit(root);
  return out;
}

export interface SliceTiming {
  /** Accumulated wall-clock ms each slice has been "active" — see advanceSliceTiming. */
  activeMs: Record<number, number>;
  /** Each nid's row count as of the last poll — advanceSliceTiming's own bookkeeping, not for display. */
  rawRows: Record<number, number>;
}

export const EMPTY_SLICE_TIMING: SliceTiming = { activeMs: {}, rawRows: {} };

/**
 * No per-node timing is captured anywhere (see whpg_plan_tree's own
 * motion_senders/motion_receivers comment — this project doesn't have real
 * per-slice CPU/wall time any more than it has real segment counts), so
 * "how long has this slice been running" is approximated the same way the
 * rest of this Watch feature approximates progress: by observing it from
 * outside, one poll at a time. A slice counts as active for an interval
 * as long as at least one of its nodes still has a shmem entry — even a
 * zero-row placeholder left by a recycled leaf's coord dispatcher. The
 * interval's wall-clock length gets added to that slice's total.
 *
 * The credit rule is deliberately *presence*, not *rows produced*:
 *
 *   - Motion/Hash nodes flatline at their final row count the instant
 *     their phase completes, but their shmem row stays until the whole
 *     slice's gang tears down — matches the reality that the slice is
 *     still alive downstream.
 *   - Fast dim-table leaves recycle their worker slots almost immediately;
 *     the only shmem entry left is a {segid=-1, rows=0} placeholder from
 *     the coord dispatcher. Presence still counts them, so slices whose
 *     leaves we only ever saw in that recycled state (slices 4/5/7 in a
 *     typical star-join over a lineitem fact table) still get credit for
 *     the wall time they were alive.
 *   - Pure hoarders (Sort / top-of-plan Aggregate / top-of-plan Limit)
 *     also register — their coord entries are present throughout, even
 *     though they emit nothing until the very end. That's honest: the
 *     slice's process *is* running, it's just accumulating.
 *
 * rawRows is kept as bookkeeping for callers that still want per-nid
 * delta information but isn't consulted by the active-slice decision.
 */
export function advanceSliceTiming(
  prev: SliceTiming,
  freshByNode: Record<number, LiveNodeStats>,
  nidToSlice: Map<number, number>,
  dtMs: number,
): SliceTiming {
  const activeSlices = new Set<number>();
  for (const nidStr of Object.keys(freshByNode)) {
    const sliceId = nidToSlice.get(Number(nidStr));
    if (sliceId != null) activeSlices.add(sliceId);
  }
  const activeMs = { ...prev.activeMs };
  for (const sid of activeSlices) activeMs[sid] = (activeMs[sid] ?? 0) + dtMs;

  const rawRows: Record<number, number> = {};
  for (const [nidStr, stats] of Object.entries(freshByNode)) rawRows[Number(nidStr)] = stats.rows;

  return { activeMs, rawRows };
}

export interface SliceSummary {
  id: number;
  label: string;
  activeMs: number;
  /**
   * Share of the sum of every slice's own activeMs — deliberately not a
   * share of the query's total wall-clock duration, since slices run
   * concurrently (each as its own gang-member process) and can add up to
   * more or less than that.
   */
  pct: number;
}

export function summarizeSlices(sliceIds: Map<PlanNode, number>, activeMs: Record<number, number>): SliceSummary[] {
  const ids = [...new Set(sliceIds.values())].sort((a, b) => a - b);
  const total = ids.reduce((sum, id) => sum + (activeMs[id] ?? 0), 0);
  return ids.map(id => ({
    id,
    label: `Slice ${id}`,
    activeMs: activeMs[id] ?? 0,
    pct: total > 0 ? ((activeMs[id] ?? 0) / total) * 100 : 0,
  }));
}

/** "Run Time"-style h/m/s formatting for a whole query — unlike formatMs's us/ms/s scale for one node's own time. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
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

// Canonical per-slice color, keyed on slice id (not on ordinal position in a
// list) so the same slice reads the same color everywhere it appears — in
// the tree, in the graph card's left stripe, and in SliceSummaryPanel's
// legend. Repeats every 8 slices, which is fine visually because at that
// depth the tree structure already tells them apart.
export const SLICE_COLORS = [
  '#3b82f6', // blue-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#a855f7', // purple-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#84cc16', // lime-500
];

export function sliceColor(sliceId: number | null | undefined): string | null {
  if (sliceId == null || sliceId < 1) return null;
  return SLICE_COLORS[(sliceId - 1) % SLICE_COLORS.length];
}

// Per-node completion inferred from the plan tree's own topology plus
// whatever gp_instrument_shmem_detail currently shows.
//
// Why this exists: the plugin recycles a node's per-segment Instrumentation
// slots the instant that operator finishes (ExecEndNode), so any fast leaf
// — a SeqScan on a dim table, its parent Hash, the Motion above it — is
// left in shmem as a bare coordinator-dispatcher row with segid=-1 and
// rows=0 while the query is still running elsewhere. Reading that at face
// value made slices 4/5/6/7 render as "0 progress everywhere" long after
// their gangs had done their job, even though the boundary Motion above
// them was still visibly moving rows.
//
// Rescue: data flows *up* the tree. If any ancestor of node N has rows > 0
// in shmem, then N must have produced (or at minimum executed and returned
// zero) — otherwise nothing would be available for that ancestor to hold.
// So a node with no shmem rows of its own but a live ancestor is
// 'completed'. A node with rows > 0 is 'active'. A node with neither its
// own rows nor a live ancestor is 'idle' — either genuinely not started
// yet, or a top-of-plan hoarder (Sort/Aggregate/Limit) still buffering.
export type NodeCompletionState = 'active' | 'completed' | 'idle';

export function computeNodeCompletionStates(
  root: PlanNode | null,
  liveNodes: Record<number, LiveNodeStats> | undefined,
): Record<number, NodeCompletionState> {
  const result: Record<number, NodeCompletionState> = {};
  if (!root) return result;
  function walk(node: PlanNode, ancestorHasRows: boolean) {
    const nid = node.Nid;
    const live = nid != null ? liveNodes?.[nid] : undefined;
    const hasRows = live != null && live.rows > 0;
    if (nid != null) {
      result[nid] = hasRows ? 'active' : ancestorHasRows ? 'completed' : 'idle';
    }
    (node.Plans ?? []).forEach(c => walk(c, ancestorHasRows || hasRows));
  }
  walk(root, false);
  return result;
}
