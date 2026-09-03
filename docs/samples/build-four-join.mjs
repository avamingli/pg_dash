#!/usr/bin/env node
// Generates docs/samples/four-join.json — a synthetic Watch-panel
// recording of a 4-way JOIN + GROUP BY + LIMIT query on a 3-segment
// Cloudberry cluster. Shaped to exercise every code path in the
// replay pipeline:
//
//   - Multiple slices with clear ordering (dim tables finish fast,
//     fact scans stream, upper HJ aggregates last)
//   - Small dim-table slices that never light up in shmem — verifies
//     Rule B (parent-completed → child-inferred-done) in the replay
//   - A slice that's actively growing for most of the recording so
//     the per-node progress bars have something to animate
//   - Coord (segid=-1) slice at the top receiving Gather output
//     limited by LIMIT 20
//
// Regenerate with:  node docs/samples/build-four-join.mjs
// Output goes to docs/samples/four-join.json.
//
// Extending: add another sample by copying this file, renaming
// SAMPLE_NAME, adjusting the plan/frame loops, and running the copy.

import fs from 'node:fs';
import path from 'node:path';

const SAMPLE_NAME = 'four-join';
const OUT_PATH = new URL(`./${SAMPLE_NAME}.json`, import.meta.url);

const SQL = `SELECT n.nation_name,
       p.category,
       count(DISTINCT o.order_id) AS n_orders,
       sum(li.quantity * p.unit_price * (1 - li.discount)) AS revenue
FROM nations n
JOIN orders  o on true
JOIN lineitem  li ON li.order_id  = o.order_id
JOIN products  p ON p.product_id  = li.product_id
WHERE o.order_date >= DATE '2023-01-01'
  AND o.status = 'shipped'
GROUP BY n.nation_name, p.category
LIMIT 20;`;

const PID = 987654;
const SESS_ID = 4242;
const NSEGS = 3;
const SEGIDS = [0, 1, 2];
const COORD_SEG = -1;

// ─── Plan tree ──────────────────────────────────────────────────
// Layout used, with the slice ids computeSliceIds() will assign
// via DFS (root → new slice on each Motion):
//
//   Gather Motion              nid=1   slice 1  (coord side, root)
//     Limit                    nid=2   slice 1
//       HashAggregate final    nid=3   slice 1
//         Redistribute Motion  nid=4   slice 2  (redistribute on group cols)
//           HashAggregate part nid=5   slice 2
//             Hash Join top    nid=6   slice 2  (join with products)
//               Hash Join mid  nid=7   slice 2  (join with lineitem)
//                 Hash Join hi nid=8   slice 2  (nations × orders)
//                   Redistribute Motion nid=9  slice 3  (orders)
//                     Seq Scan orders   nid=10 slice 3
//                   Hash       nid=11   slice 2
//                     Broadcast Motion  nid=12 slice 4  (nations, tiny)
//                       Seq Scan        nid=13 slice 4
//                 Hash         nid=14   slice 2
//                   Redistribute Motion nid=15 slice 5  (lineitem)
//                     Seq Scan          nid=16 slice 5
//               Hash           nid=17   slice 2
//                 Broadcast Motion      nid=18 slice 6  (products, small)
//                   Seq Scan            nid=19 slice 6

/** @typedef {import('../../frontend/src/types/metrics.ts').QueryProgressPlanNode} PlanRow */

// One plan row template per (nid) → we fan it out per-segment below.
// Keep node_type strings matching what the frontend's nodeLabel /
// buildRealPlanTree / computeSliceIds expects (see planTree.ts).
const NODES = [
  { nid: 1,  parent: -1, type: 'Gather Motion',      senders: NSEGS, receivers: 1,     rel: null,       rows: 20,         cost: [12000, 12100] },
  { nid: 2,  parent: 1,  type: 'Limit',              senders: null,  receivers: null,  rel: null,       rows: 20,         cost: [12000, 12050] },
  { nid: 3,  parent: 2,  type: 'HashAggregate',      senders: null,  receivers: null,  rel: null,       rows: 200,        cost: [11000, 11800], strategy: 'Hashed' },
  { nid: 4,  parent: 3,  type: 'Redistribute Motion', senders: NSEGS, receivers: NSEGS, rel: null,      rows: 200,        cost: [10500, 10800] },
  { nid: 5,  parent: 4,  type: 'HashAggregate',      senders: null,  receivers: null,  rel: null,       rows: 200,        cost: [9000, 10000], strategy: 'Hashed', partial: 'Partial' },
  { nid: 6,  parent: 5,  type: 'Hash Join',          senders: null,  receivers: null,  rel: null,       rows: 500000,     cost: [7500, 8800] },
  { nid: 7,  parent: 6,  type: 'Hash Join',          senders: null,  receivers: null,  rel: null,       rows: 480000,     cost: [4200, 6800] },
  { nid: 8,  parent: 7,  type: 'Hash Join',          senders: null,  receivers: null,  rel: null,       rows: 12000,      cost: [1200, 1600] },
  { nid: 9,  parent: 8,  type: 'Redistribute Motion', senders: NSEGS, receivers: NSEGS, rel: null,      rows: 40000,      cost: [1000, 1100] },
  { nid: 10, parent: 9,  type: 'Seq Scan',           senders: null,  receivers: null,  rel: 'orders',   rows: 40000,      cost: [0, 900] },
  { nid: 11, parent: 8,  type: 'Hash',               senders: null,  receivers: null,  rel: null,       rows: 40,         cost: [10, 20] },
  { nid: 12, parent: 11, type: 'Broadcast Motion',   senders: 1,     receivers: NSEGS, rel: null,       rows: 40,         cost: [5, 15] },
  { nid: 13, parent: 12, type: 'Seq Scan',           senders: null,  receivers: null,  rel: 'nations',  rows: 40,         cost: [0, 5] },
  { nid: 14, parent: 7,  type: 'Hash',               senders: null,  receivers: null,  rel: null,       rows: 1000000,    cost: [3000, 3500] },
  { nid: 15, parent: 14, type: 'Redistribute Motion', senders: NSEGS, receivers: NSEGS, rel: null,      rows: 1000000,    cost: [2500, 2800] },
  { nid: 16, parent: 15, type: 'Seq Scan',           senders: null,  receivers: null,  rel: 'lineitem', rows: 1000000,    cost: [0, 2400] },
  { nid: 17, parent: 6,  type: 'Hash',               senders: null,  receivers: null,  rel: null,       rows: 8000,       cost: [400, 500] },
  { nid: 18, parent: 17, type: 'Broadcast Motion',   senders: 1,     receivers: NSEGS, rel: null,       rows: 8000,       cost: [300, 400] },
  { nid: 19, parent: 18, type: 'Seq Scan',           senders: null,  receivers: null,  rel: 'products', rows: 8000,       cost: [0, 250] },
];

// Nodes above the top Motion (nid=1) run only on the coord (segid=-1).
// Everything at nid=1 and below runs on every segment (0..NSEGS-1).
// (Approximation of what whpg_plan_tree.plan_detail actually returns.)
const COORD_ONLY_NIDS = new Set([]); // in this plan the root IS a Motion, so nothing is coord-only above it
function segsFor(nid) {
  return COORD_ONLY_NIDS.has(nid) ? [COORD_SEG] : SEGIDS;
}

function planRows() {
  const out = [];
  for (const n of NODES) {
    for (const segid of segsFor(n.nid)) {
      out.push({
        segid,
        pid: PID,
        nid: n.nid,
        parent_nid: n.parent,
        node_type: n.type,
        parallel_aware: false,
        strategy: n.strategy ?? null,
        partial_mode: n.partial ?? null,
        operation: null,
        motion_senders: n.senders,
        motion_receivers: n.receivers,
        relname: n.rel,
        plan_rows: n.rows,
        startup_cost: n.cost[0],
        total_cost: n.cost[1],
      });
    }
  }
  return out;
}

// ─── Row-count timelines per nid ────────────────────────────────
// Each entry gives a function frameIdx → { ntuples, tuplecount } per
// segment. Real GPDB rows are aggregated across segs (ntuples =
// completed cycles, tuplecount = current cycle in progress), we just
// want the sum (ntuples+tuplecount) to grow monotonically past the
// max/plateau moment the way the frontend's aggregateByNode reads it.
//
// Deliberately shaped for pipeline coverage:
//   nid 13 (nations) — never above zero in any observed frame:
//     tiny gang finished before frame 0. Exercises Rule B.
//   nid 19 (products) — same story, tiny gang, never observed.
//   nid 10 (orders)  — grows frames 1–5, plateaus.
//   nid 16 (lineitem)— grows frames 1–8, plateaus.
//   nid 8/7/6 (HJs)  — grow after their inner sides fill in.
//   nid 5/3 (agg)    — hoarder pattern; own rows stay 0 until inputs
//                      exhausted, then a burst.
//   nid 1 (coord Gather) — receives final 20 rows once agg emits.
const N_FRAMES = 15;

// Growth curve helpers.
const g = (start, end, from, to) => (i) => {
  if (i < start) return 0;
  if (i >= end) return to;
  const t = (i - start) / (end - start);
  return Math.round(from + (to - from) * t);
};
const stayZero = () => 0;

const totalRowsByNid = {
  1:  g(11, 14, 0, 20),        // coord Gather receives 20 rows near the end
  2:  g(11, 14, 0, 20),        // Limit — same 20
  3:  g(10, 12, 0, 200),       // final HashAgg
  4:  g(9, 11, 0, 200),        // Redistribute pipe out of partial agg
  5:  g(8, 10, 0, 200),        // partial HashAgg emits after HJs done
  6:  g(6, 9, 0, 500000),      // top HJ (join products)
  7:  g(5, 8, 0, 480000),      // middle HJ (join lineitem)
  8:  g(3, 6, 0, 12000),       // low HJ (nations × orders)
  9:  g(2, 5, 0, 40000),       // Redistribute orders
  10: g(1, 5, 0, 40000),       // Seq Scan orders
  11: g(0, 1, 0, 40),          // Hash of nations
  12: stayZero,                // Broadcast nations — never in shmem (recycled before poll 0)
  13: stayZero,                // Seq Scan nations
  14: g(6, 8, 0, 1000000),     // Hash of lineitem output
  15: g(4, 8, 0, 1000000),     // Redistribute lineitem
  16: g(1, 8, 0, 1000000),     // Seq Scan lineitem
  17: g(0, 1, 0, 8000),        // Hash products
  18: stayZero,                // Broadcast products — never in shmem
  19: stayZero,                // Seq Scan products
};

function nodesForFrame(i) {
  const rows = [];
  for (const nid of Object.keys(totalRowsByNid).map(Number)) {
    const total = totalRowsByNid[nid](i);
    const segs = segsFor(nid);
    if (total <= 0 && !COORD_ONLY_NIDS.has(nid)) continue;
    // Split total across segments; put "current" leftover in tuplecount
    // to mimic InstrEndLoop behavior (ntuples = completed cycles).
    const perSeg = Math.floor(total / segs.length);
    const rem = total - perSeg * segs.length;
    segs.forEach((segid, idx) => {
      const seg_total = perSeg + (idx < rem ? 1 : 0);
      const ntuples = Math.max(0, seg_total - Math.floor(seg_total * 0.15));
      const tuplecount = seg_total - ntuples;
      rows.push({
        segid,
        pid: PID,
        nid,
        tuplecount,
        nloops: seg_total > 0 ? 1 : 0,
        ntuples,
      });
    });
  }
  return rows;
}

function memoryForFrame(i) {
  // Memory ramps as HJs build, peaks during aggregation, drops at end.
  const base = 40;
  const peak = 240;
  const t = Math.min(1, Math.max(0, (i - 2) / 9));
  const climbing = base + (peak - base) * t;
  const settling = i >= 12 ? climbing - (climbing - 80) * ((i - 12) / 2) : climbing;
  const per = Math.max(base, settling);
  return SEGIDS.map(segid => ({ segid, vmem_mb: Math.round(per + segid * 8) }));
}

// Frame cadence — every 900ms for the first stretch, then bunched
// closer around the aggregation burst (nice visual density in a GIF)
// and back to 900ms at the end.
const FRAME_TS_MS = Array.from({ length: N_FRAMES }, (_, i) => i * 900);

const plan = planRows();
const frames = FRAME_TS_MS.map((tsMs, i) => ({
  tsMs,
  progress: {
    pid: PID,
    sess_id: SESS_ID,
    nodes: nodesForFrame(i),
    memory: memoryForFrame(i),
    // Include plan in every frame — matches real backend, and lets a
    // replay engine cold-start from any frame if it ever needs to.
    plan,
  },
}));

const recording = {
  version: 1,
  query: SQL,
  startedAt: new Date('2026-09-03T18:45:00Z').toISOString(),
  clusterInfo: {
    num_segments: NSEGS,
    mode: 'cloudberry',
  },
  frames,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(recording, null, 2));
console.error(`wrote ${path.relative(process.cwd(), OUT_PATH.pathname)} — ${frames.length} frames, ${(fs.statSync(OUT_PATH).size / 1024).toFixed(1)} KB`);
