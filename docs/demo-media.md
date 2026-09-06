# Demo media playbook — live plan tree

Everything needed to record, cut and publish the live plan tree demo. Two recordings, four outputs, one script.

| Output | Source | Where it goes |
|---|---|---|
| `docs/plan-tree.gif` (1280 wide, ~10 s) | replay of `docs/samples/customer-revenue.json` at 2x | README of pg_dash and whpg_plan_tree |
| `docs/media/plan-tree-slack.gif` (960 wide) | same | internal Slack / Feishu post |
| `docs/media/plan-tree-linkedin.mp4` (1080p, ~18–22 s) | live run on the dev WarehousePG cluster, sped up 1.5–1.8x, **no title/end cards** (add `--cards` if you ever want branded bookends) | LinkedIn, Cloudberry community |
| `docs/media/title-card.png`, `end-card.png` | `title-card.html`, `end-card.html` | rendered by the script |

Tools: ffmpeg, gifski, gifsicle (installed), Google Chrome (renders the cards). Script: `scripts/demo-media.sh`.

## 1. Pre-flight (10 min)

- [ ] `make stop`, then `cd frontend && npm run build && npx vite preview --port 3000` and run the backend by hand — production build, no Vite HMR overlay.
- [ ] Cluster warm: run the live query once in psql with `\timing`. Measured: 18.7 s cold and 11.7 s warm right after a restart; 30–40 s when the cluster had other load. Aim for a 12–20 s run and set `--speed` accordingly.
- [ ] Chrome: a fresh window, one tab, bookmarks bar hidden (Cmd+Shift+B), zoom 100% (Cmd+0), window maximized. Dark theme is the app default.
- [ ] System: Do Not Disturb on, Slack/Feishu/mail quit, external display disconnected (record on the Retina panel: 3072×1920 native).
- [ ] `scripts/demo-media.sh cards` once, and open `docs/media/title-card.png` to check the copy.

## 2. Recording A — replay for the README GIF (5 min)

1. Open `/replay`, drag in `docs/samples/customer-revenue.json`.
2. Speed **2x**, click the fullscreen icon, then in the header strip click **Restart**, then **Pause**. The tree is now at frame 0, fully fitted.
3. Cmd+Shift+5 → *Record Selected Portion*. Draw the region so its **top edge sits just below the header strip** (zoom toolbar / transport / ✕): only the slice panel and the tree are inside. Options: Timer *None*, Microphone *None*, *Show Mouse Clicks* **off**.
4. Click *Record*, then click **Play** in the header (outside the region), and move the pointer off-screen.
5. The tree goes fully green at ~10.4 s. Wait 2 more seconds, stop with the menu-bar button (or Cmd+Ctrl+Esc). Save as `~/Desktop/replay.mov`.

```sh
scripts/demo-media.sh gif ~/Desktop/replay.mov            # speed already baked in by the 2x replay
```

Check the size line it prints: target ≤ 5 MB for `plan-tree.gif`; the script runs gifsicle automatically if it's over.

## 3. Recording B — live run for LinkedIn (15 min)

Shot list. Total raw length ~45 s, sped up to ~20 s in post.

| t | What's on screen | Action |
|---|---|---|
| 0–3 s | SQL Editor, query pasted, cluster name **WarehousePG** visible top-left | hold still |
| 3 s | — | click **Run** |
| 5–8 s | Watch panel slides in, plan tree appears | click the **fullscreen** icon |
| 8–40 s | tree runs: products slice goes green early, lineitem scan bar climbs, aggregate bursts, coordinator receives rows | hands off, pointer off-screen |
| ~40 s | tree fully green, "Finished" | hold 2 s, stop |

The query (`docs/samples/category-revenue-live.sql`):

```sql
SELECT p.category,
       count(*) AS n_items,
       sum(li.quantity * p.unit_price * (1 - li.discount)) AS revenue
FROM lineitem li
JOIN products p ON p.product_id = li.product_id
WHERE li.lineitem_id % 20 = 0
GROUP BY p.category;
```

Why the modulo filter: lineitem is stored in id order, so a range filter matches one contiguous stretch of blocks and the tree freezes for seconds then jumps. `% 20` spreads the matching rows through the whole scan, so the row counts climb steadily from the first frame to the last (see the comment block in the SQL file for the measurements).

Recording settings: Cmd+Shift+5 → *Record Selected Portion*, region = the whole browser content area (below the tab bar). Timer *5 seconds* so you can get your hands on the mouse. *Show Mouse Clicks* **on** for this one: the clicks are part of the story. Save as `~/Desktop/live.mov`.

Trim in QuickTime (Cmd+T): start 1 s before the Run click, end 2 s after the tree is fully green. Then:

```sh
scripts/demo-media.sh mp4 ~/Desktop/live.mov --speed 1.8
```

Pick `--speed` so the middle section is 18–22 s: on a freshly started, idle cluster the query takes 12–19 s and `--speed 1` is right; on a busy one it took 30–40 s and `--speed 1.8` brought it back. The final file is just the run itself (~19–26 s depending on `--speed`), so the viewer sees the plan tree from the first frame; add `--cards` if you want title/end cards back. Slice timings on screen stay the real numbers.

## 4. Quality checklist before publishing

- Open the GIF in a browser at 100%: node labels readable, no color banding in the dark background (raise `--quality` or width if so).
- Play the MP4 in QuickTime: it opens straight on the run (or on the title card if you used `--cards`), no black frames between segments, tree text crisp.
- Both loop / end on the fully green tree.

## 5. Publishing, in order

### README (both repos)

pg_dash — insert the GIF plus a one-line intro under the two intro screenshots (done in the current README), so the animated demo is what people see right after the tagline; keep the "Live Plan Watch" feature bullet in sync.

whpg_plan_tree — copy the GIF in as `img/plan-tree.gif` and point the demo image at it (replacing `img/live_query_plan.png`), caption pointing back at pg_dash as the reference UI.

### Internal channel (after the manager's nod)

> 分享一个业余时间做的东西：WarehousePG 的实时查询计划树。
>
> [plan-tree-slack.gif]
>
> 树、节点、每个节点的行数都来自执行器正在跑的真实 plan，由一个新的 extension `whpg_plan_tree` 在查询开始时捕获到共享内存。不改内核，WHPG7、GPDB7、Cloudberry 上不用改就能编。UI 是 pg_dash，我的开源项目，作为参考实现。
>
> 销售和 DBA 从 GPCC 时代就在要这个功能，希望能作为一个底座用起来。WEM 团队如果想基于这个接口做，我随时可以讲一下。

English variant for a mixed channel:

> Sharing something I've been building on the side: a live, animated query plan tree for WarehousePG.
>
> [gif]
>
> The tree, node labels and per-node row counts come from the real plan the executor is running, captured into shmem at query start by a small new extension, `whpg_plan_tree`. No kernel changes; builds unmodified against WHPG7, GPDB7 and Cloudberry. The UI is pg_dash, my open-source reference implementation; the extension is the part meant to be built on.
>
> Sales and DBAs have been asking for this since the GPCC days, so I hope it's useful as a foundation. If the WEM team wants to build on the interface, happy to walk through it.

### LinkedIn (after the extension repo is public)

Upload `plan-tree-linkedin.mp4` as a native video (not a link, not a GIF: LinkedIn freezes GIFs). Text:

> There has been no open-source way to watch a running query's plan as a live, animated tree. Not because it's hard to draw, but because nothing outside the running backend could see the real plan.
>
> So I wrote one for WarehousePG. whpg_plan_tree captures the already-planned tree of every running query into shared memory at query start and exposes it over SQL. No kernel changes. It builds unmodified against WarehousePG 7, Greenplum 7 and Apache Cloudberry.
>
> Here it is powering the Watch view in pg_dash, my open-source dashboard: slices light up as they start, row counts climb per node, and the coordinator receives the result.
>
> Extension: github.com/avamingli/whpg_plan_tree
> Dashboard: github.com/avamingli/pg_dash
>
> #PostgreSQL #WarehousePG #Greenplum #ApacheCloudberry #MPP #OpenSource

Post on a weekday morning US Eastern (evening China). Reply to the first few comments within the hour: the algorithm rewards early engagement. Send the link to the manager and ask for a company repost.

### Apache Cloudberry community (a day or two later)

Dev list or Slack, from the apache.org identity, same video. Drop the WarehousePG-first framing:

> A small extension that captures a running query's real plan tree into shmem and exposes it over SQL, so a dashboard can render it live. Works unmodified on Apache Cloudberry (and Greenplum / WarehousePG). Would be glad to hear if this is useful as a building block for monitoring tools in the community. [links]

## 6. Re-recording later

The UI will change. The replay GIF is fully reproducible: same JSON, same 2x, same crop, one script run. Keep `replay.mov` and `live.mov` somewhere durable so the MP4 can be re-cut with or without cards, or at a different speed, without a new recording.
