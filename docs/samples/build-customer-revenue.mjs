#!/usr/bin/env node
// Generates docs/samples/customer-revenue.json — a small, screen-sized
// synthetic Watch-panel recording meant for demo GIFs / screen captures.
//
// Where four-join.json is shaped to cover every replay code path (6
// slices, 19 nodes, tall tree), this one is shaped to be *watched*:
//
//   - 3 slices, 8 nodes, tree depth 5 → fits a 1080p viewport without
//     scrolling at 100% zoom (PlanGraph is 114px per level)
//   - ~21 s of wall time: play it at 1x for a LinkedIn-length video
//     (long enough that the bars visibly climb), at 2x for a ~10 s
//     README/Slack GIF — speed only changes the wait between frames,
//     so the on-screen figures are the same either way
//   - A clear three-act story: the small customers redistribute (s3)
//     finishes first, the big orders redistribute (s2) streams for most
//     of the run, then the join/aggregate burst and the coordinator
//     receives the result (s1)
//   - Ends with the empty terminal frame the Watch panel writes on 404,
//     so the replay reaches `finished` and every slice reads "done" —
//     the natural last frame to hold on before the GIF loops
//
// Regenerate with:  node docs/samples/build-customer-revenue.mjs
// Output goes to docs/samples/customer-revenue.json.

import fs from 'node:fs';
import path from 'node:path';

const SAMPLE_NAME = 'customer-revenue';
const OUT_PATH = new URL(`./${SAMPLE_NAME}.json`, import.meta.url);

const SQL = `SELECT c.cust_id,
       c.name,
       sum(o.amount) AS revenue
FROM orders o
JOIN customers c ON c.cust_id = o.cust_id
WHERE o.order_date >= DATE '2026-07-01'
GROUP BY c.cust_id, c.name
HAVING sum(o.amount) > 10000;`;

const PID = 314159;
const SESS_ID = 2718;
const NSEGS = 3;
const SEGIDS = [0, 1, 2];

// ─── Plan tree ──────────────────────────────────────────────────
// Slice ids as computeSliceIds() assigns them (root → new slice on
// each Motion). orders is distributed by order_id and customers by
// region, so both sides move to line up on cust_id:
//
//   Gather Motion 3:1            nid=1  slice 1  (root)
//     HashAggregate              nid=2  slice 1  (group by cust_id, after redistribute)
//       Hash Join                nid=3  slice 1
//         Redistribute Motion    nid=4  slice 2  (orders → cust_id, 600k rows)
//           Seq Scan orders      nid=5  slice 2
//         Hash                   nid=6  slice 1
//           Redistribute Motion  nid=7  slice 3  (customers → cust_id, 50k rows)
//             Seq Scan customers nid=8  slice 3
const NODES = [
  { nid: 1, parent: -1, type: 'Gather Motion',       senders: NSEGS, receivers: 1,     rel: null,        rows: 1200,   cost: [9800, 9900] },
  { nid: 2, parent: 1,  type: 'HashAggregate',       senders: null,  receivers: null,  rel: null,        rows: 1200,   cost: [9200, 9700], strategy: 'Hashed' },
  { nid: 3, parent: 2,  type: 'Hash Join',           senders: null,  receivers: null,  rel: null,        rows: 600000, cost: [1100, 7600] },
  { nid: 4, parent: 3,  type: 'Redistribute Motion', senders: NSEGS, receivers: NSEGS, rel: null,        rows: 600000, cost: [0, 5200] },
  { nid: 5, parent: 4,  type: 'Seq Scan',            senders: null,  receivers: null,  rel: 'orders',    rows: 600000, cost: [0, 4100] },
  { nid: 6, parent: 3,  type: 'Hash',                senders: null,  receivers: null,  rel: null,        rows: 50000,  cost: [900, 900] },
  { nid: 7, parent: 6,  type: 'Redistribute Motion', senders: NSEGS, receivers: NSEGS, rel: null,        rows: 50000,  cost: [0, 800] },
  { nid: 8, parent: 7,  type: 'Seq Scan',            senders: null,  receivers: null,  rel: 'customers', rows: 50000,  cost: [0, 600] },
];

function planRows() {
  const out = [];
  for (const n of NODES) {
    for (const segid of SEGIDS) {
      out.push({
        segid,
        pid: PID,
        nid: n.nid,
        parent_nid: n.parent,
        node_type: n.type,
        parallel_aware: false,
        strategy: n.strategy ?? null,
        partial_mode: null,
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
// 26 live frames at 800ms (0 … 20.0s) plus one empty terminal frame.
// Frame 0 is the usual "plan captured, shmem still empty" first poll.
//
//   frames 1–6   customers scan + redistribute (s3) fill and plateau;
//                the Hash (s1) fills right behind them
//   frames 1–18  orders scan + redistribute (s2) stream — the long bar
//   frames 2–19  Hash Join probes as orders arrive, one frame behind
//   frames 19–21 HashAggregate hoards, then bursts its 1,200 groups
//   frames 19–23 Gather delivers them to the coordinator
//   frame 26     terminal: query ended, slice 1 completes via `finished`
const N_LIVE_FRAMES = 26;
const FRAME_MS = 800;

// Linear ramp: 0 before `start`, `from`→`to` across [start, end], `to` after.
const g = (start, end, from, to) => (i) => {
  if (i < start) return 0;
  if (i >= end) return to;
  const t = (i - start) / (end - start);
  return Math.round(from + (to - from) * t);
};

const totalRowsByNid = {
  1: g(19, 23, 100, 1200),      // Gather — coord receives the HAVING survivors
  2: g(19, 21, 400, 1200),      // HashAggregate — nothing until inputs exhausted
  3: g(2, 19, 5000, 580000),    // Hash Join — probe side trails the orders stream
  4: g(1, 18, 8000, 600000),    // Redistribute orders
  5: g(1, 18, 15000, 600000),   // Seq Scan orders — the bar to watch
  6: g(1, 7, 2000, 50000),      // Hash — built from the customers redistribute
  7: g(1, 7, 4000, 50000),      // Redistribute customers
  8: g(1, 6, 8000, 50000),      // Seq Scan customers — done early
};

function nodesForFrame(i) {
  const rows = [];
  for (const nid of Object.keys(totalRowsByNid).map(Number)) {
    const total = totalRowsByNid[nid](i);
    if (total <= 0) continue;
    // Split across segments; keep a "current cycle" remainder in
    // tuplecount the way InstrEndLoop leaves it (ntuples = completed).
    const perSeg = Math.floor(total / SEGIDS.length);
    const rem = total - perSeg * SEGIDS.length;
    SEGIDS.forEach((segid, idx) => {
      const seg_total = perSeg + (idx < rem ? 1 : 0);
      const ntuples = Math.max(0, seg_total - Math.floor(seg_total * 0.15));
      const tuplecount = seg_total - ntuples;
      rows.push({ segid, pid: PID, nid, tuplecount, nloops: seg_total > 0 ? 1 : 0, ntuples });
    });
  }
  return rows;
}

function memoryForFrame(i) {
  // Climbs while the hash table builds and the join streams, peaks at
  // the aggregate burst, settles as the coordinator drains the result.
  const base = 32;
  const peak = 128;
  const t = Math.min(1, Math.max(0, (i - 1) / 18));
  const climbing = base + (peak - base) * t;
  const settling = i >= 22 ? climbing - (climbing - 56) * ((i - 22) / 3) : climbing;
  const per = Math.max(base, settling);
  return SEGIDS.map(segid => ({ segid, vmem_mb: Math.round(per + segid * 4) }));
}

const plan = planRows();
const frames = Array.from({ length: N_LIVE_FRAMES }, (_, i) => ({
  tsMs: i * FRAME_MS,
  progress: {
    pid: PID,
    sess_id: SESS_ID,
    nodes: nodesForFrame(i),
    memory: memoryForFrame(i),
    plan,
  },
}));

// The Watch panel writes exactly this frame when the /progress poll
// comes back 404 — the shape replayRecording reads as "the query ended".
frames.push({
  tsMs: N_LIVE_FRAMES * FRAME_MS,
  progress: { pid: PID, sess_id: SESS_ID, nodes: [] },
});

const recording = {
  version: 1,
  query: SQL,
  startedAt: new Date('2026-09-04T09:30:00Z').toISOString(),
  clusterInfo: { num_segments: NSEGS, mode: 'cloudberry' },
  frames,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(recording, null, 2));
console.error(`wrote ${path.relative(process.cwd(), OUT_PATH.pathname)} — ${frames.length} frames, ${(fs.statSync(OUT_PATH).size / 1024).toFixed(1)} KB`);
