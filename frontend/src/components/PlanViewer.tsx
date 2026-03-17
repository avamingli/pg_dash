import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

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
  Plans?: PlanNode[];
  [key: string]: unknown;
}

interface PlanViewerProps {
  plan: unknown;
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

// ── Components ──

function PlanNodeView({ node, depth, rootTime }: { node: PlanNode; depth: number; rootTime: number }) {
  const [open, setOpen] = useState(depth < 3);
  const hasChildren = node.Plans && node.Plans.length > 0;
  const actualTime = getTotalTime(node);
  const timePct = rootTime > 0 ? (actualTime / rootTime * 100) : 0;
  const ratio = rowEstimateRatio(node);
  const color = nodeColor(node, rootTime);

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

          <span className="font-mono text-xs text-blue-400 font-semibold">{node['Node Type']}</span>
          {relation && <span className="text-xs text-zinc-400">on {relation}</span>}

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
            <PlanNodeView key={i} node={child} depth={depth + 1} rootTime={rootTime} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function PlanViewer({ plan }: PlanViewerProps) {
  const [showRaw, setShowRaw] = useState(false);
  const root = parsePlan(plan);

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
        <PlanNodeView node={root} depth={0} rootTime={rootTime} />
      )}
    </div>
  );
}
