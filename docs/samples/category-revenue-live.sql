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
--             Seq Scan on lineitem         (local, filtered)
--             Hash
--               Broadcast Motion 3:3       slice 3   (products, small)
--                 Seq Scan on products
--
-- The lineitem_id filter is the run-time knob. The scan itself is the
-- floor (~14 s for the full table on that cluster); every row that
-- passes the filter adds join + aggregate work on top:
--   <= 6 500 000   (5%)   ~30-40 s   ← the one used for the recording
--   <= 13 000 000  (10%)  ~40 s
--   no filter             ~4 min
-- Timings move with whatever else the cluster is doing; check with
-- \timing before you hit Record.
--
-- Prerequisites: CREATE EXTENSION whpg_plan_tree; gp_enable_query_metrics = on.

SELECT p.category,
       count(*) AS n_items,
       sum(li.quantity * p.unit_price * (1 - li.discount)) AS revenue
FROM lineitem li
JOIN products p ON p.product_id = li.product_id
WHERE li.lineitem_id <= 6500000
GROUP BY p.category;
