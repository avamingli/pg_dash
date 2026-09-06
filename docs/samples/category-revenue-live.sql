-- A live query with the same 3-slice shape as customer-revenue.json,
-- for recording the Watch panel against a real cluster. Written for the
-- demo dataset already loaded on the dev WarehousePG cluster in .env
-- (public.lineitem 130M rows / 7.4 GB, public.products 8k rows, 3
-- segments); any TPC-H-like lineitem/products pair works.
--
-- Plan (verified with EXPLAIN on WarehousePG 7.2.1):
--   Gather Motion 3:1                      slice 1
--     Finalize HashAggregate
--       Redistribute Motion 3:3            slice 2   (on category)
--         Streaming Partial HashAggregate
--           Hash Join
--             Seq Scan on lineitem         (local, filter keeps 1 row in 20)
--             Hash
--               Broadcast Motion 3:3       slice 3   (products, small)
--                 Seq Scan on products
--
-- The filter is the run-time knob, and its *shape* matters more than
-- its selectivity. lineitem is stored in lineitem_id order, so a range
-- filter (lineitem_id <= N) matches one contiguous stretch of blocks:
-- the scan emits nothing for seconds, then bursts, then emits nothing
-- again — on the Watch panel the tree sits frozen and jumps. A modulo
-- filter matches rows spread evenly through the table, so the scan's
-- row count climbs steadily for the whole run, which is what you want
-- to see. Measured with 1 s samples of instrument_detail:
--   lineitem_id % 20 = 0   (5%)   ~15 s, scan grows every second   ← use this
--   lineitem_id <= 6500000 (5%)   ~12 s, scan at 0 for 4 s then a burst
--   no filter                     ~4 min
-- Timings move with whatever else the cluster is doing; check with
-- \timing before you hit Record. 12-20 s is the target for a video.
--
-- Prerequisites: CREATE EXTENSION whpg_plan_tree; gp_enable_query_metrics = on.

SELECT p.category,
       count(*) AS n_items,
       sum(li.quantity * p.unit_price * (1 - li.discount)) AS revenue
FROM lineitem li
JOIN products p ON p.product_id = li.product_id
WHERE li.lineitem_id % 20 = 0
GROUP BY p.category;
