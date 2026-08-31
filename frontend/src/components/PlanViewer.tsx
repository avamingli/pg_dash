import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { QueryProgressPlanNode } from '@/types/metrics';
import {
  type PlanNode, type LiveNodeStats,
  assignNodeIds, buildRealPlanTree, parsePlan, parseOptimizer,
  getTotalTime, getRootTotalTime, rowEstimateRatio, nodeColor, formatMs,
  nodeLabel, sliceLabel, estimateCompletionPct,
} from '@/lib/planTree';
import PlanGraph from '@/components/PlanGraph';

export type { PlanNode, LiveNodeStats };

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
  /** Query has ended — passed through to the Graph view's fill/pulse styling. */
  finished?: boolean;
  /** Passed through to the Graph view's scroll container height. */
  graphMaxHeight?: number;
}

// ── Components ──

function PlanNodeView({ node, depth, rootTime, nodeIds, liveNodes, finished }: {
  node: PlanNode;
  depth: number;
  rootTime: number;
  nodeIds?: Map<PlanNode, number>;
  liveNodes?: Record<number, LiveNodeStats>;
  finished?: boolean;
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
  const completionPct = estimateCompletionPct(live, estRows, !!finished);

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
            <PlanNodeView key={i} node={child} depth={depth + 1} rootTime={rootTime} nodeIds={nodeIds} liveNodes={liveNodes} finished={finished} />
          ))}
        </div>
      )}
    </div>
  );
}

type ViewMode = 'graph' | 'tree' | 'raw';

export default function PlanViewer({ plan, liveNodes, realPlan, finished, graphMaxHeight }: PlanViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
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
    <div className="space-y-0">
      <div className="flex items-center justify-between px-4 pt-4">
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
          {viewMode !== 'raw' && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Estimate error ({'>'}10x)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" /> Hot path ({'>'}50% time)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> Seq Scan ({'>'}10K rows)
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(['graph', 'tree', 'raw'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-2 py-1 rounded transition-colors ${viewMode === mode ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {mode === 'graph' ? 'Graph' : mode === 'tree' ? 'Tree' : 'Raw JSON'}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'raw' ? (
        <pre className="m-4 bg-zinc-900 border border-zinc-700 rounded p-3 text-xs text-zinc-300 whitespace-pre-wrap max-h-[400px] overflow-auto font-mono">
          {typeof plan === 'string' ? plan : JSON.stringify(plan, null, 2)}
        </pre>
      ) : viewMode === 'graph' ? (
        <PlanGraph root={root} rootTime={rootTime} nodeIds={nodeIds} liveNodes={liveNodes} finished={finished} maxHeight={graphMaxHeight} />
      ) : (
        <div className="p-4">
          <PlanNodeView node={root} depth={0} rootTime={rootTime} nodeIds={nodeIds} liveNodes={liveNodes} finished={finished} />
        </div>
      )}
    </div>
  );
}
