# Orion UI — UX improvement proposals

Reviewed against `main` at `e4ca86a` (targets Orion 1.6). Every finding names the file and
line it comes from so it can be verified and turned into an issue. Line numbers are from the
current tree.

**Contents**

1. [Method, personas, and where their loops break](#1-method-personas-and-where-their-loops-break)
2. [Priority 1 — Operations dashboard](#2-priority-1--operations-dashboard)
3. [Priority 1 — System Map](#3-priority-1--system-map)
4. [Priority 1 — Left navigation](#4-priority-1--left-navigation)
5. [Priority 2 — Cross-cutting](#5-priority-2--cross-cutting)
6. [Priority 2 — Page by page](#6-priority-2--page-by-page)
7. [Roadmap](#7-roadmap)
8. [Server-side asks](#8-server-side-asks)
9. [Follow-up beyond the roadmap](#9-follow-up-beyond-the-roadmap)

**Status (2026-09-05).** Every item in §7 is implemented — quick wins 1–14, medium items 15–25
and the larger items 26–30; the tables there say what each shipped as and where it deviates from
the analysis. The Functions page has been removed (route, nav, palette, and the links from the
workflow form and plugin detail); the catalogue is still fetched by the API layer and now
surfaces where the question is asked — as completion inside the workflow editor (item 26). Also
shipped alongside the quick wins: failed traces in "Needs attention" are bounded
to the last hour (§2.2), the coverage line reads serving / internal / idle (§2.3), a metrics-off
server shows one banner instead of three empties (§2.4), the map's Pause / Resume control and the
lifecycle-colour coupling (§3.13), Enter in the map search selects the first match (§3.6), and
the map distinguishes "metrics off" from "no traffic" (§3.9). A second pass the same day took
the proposals in §2–§6 that the roadmap never scheduled; §9 lists what shipped and what was
left on purpose, with the reason. The analysis below is kept as written so the reasoning behind
each change stays on record.

---

## 1. Method, personas, and where their loops break

What was reviewed: all 27 routed pages, the layout shell, every shared component and UI
primitive, the hooks, the `lib/` model code (system graph, layout, traffic encoding, metrics),
the theme, the README screenshots, and the Playwright smoke flow.

Two people use this console, and each uses it in a loop:

| | Operations engineer (on-call / SRE) | Developer (workflow and integration author) |
|---|---|---|
| The question | Is it healthy? What broke, where, since when, and what do I do about it? | Does my definition work, and why did this run do what it did? |
| The loop | Dashboard → alert → entity → act (reset, requeue, retry, reload, archive) → confirm | Author → validate → activate → send a test → read the trace → new version |
| What they need | Time windows and trends, blast radius, per-node vs cluster, queue depths (DLQ, cron backlog), what changed recently | Pickers instead of ids, a real editor, a live preview, a one-click test that can authenticate, trace → input round-trips |

### 1.1 Operator journey today: "a channel started failing"

1. The dashboard says `Erroring: auth-send-otp · 100% of processed requests failed since the
   engine started`. The number is cumulative, so it cannot say whether the failure is happening
   *now* (`operations.tsx:168-170, 221`).
2. Clicking it opens `/traces?channel=…`. Every list row carries `error_message`
   (`types.ts:1044-1059`) but the table does not render it (`traces.tsx:28-61`); reading the
   reason costs one more click per trace. *(Done: an Error column, and the reason on the
   dashboard rows.)*
3. To see what the channel depends on: the Channels list has no name search → open the detail →
   Relationships tab, a non-interactive 300 px graph (`relationship-graph.tsx:60`) → click the
   connector → Circuit Breaker tab. *(Done: the alert lands on the channel, whose Relationships
   tab is now a live one-hop map with breaker and connector faults drawn on it.)*
4. Reset the breaker and go back to the dashboard: the alert still reads 100%, because the
   counter is since start. The all-clear never returns until the engine restarts. *(Done: the
   alert is judged over the traffic window and clears when the window does.)*

### 1.2 Developer journey today: "ship a new endpoint"

1. The editor has no function picker and no schema hints; the catalogue
   (`GET admin/functions`) reaches the author nowhere in the authoring flow. (The standalone
   Functions page that used to open in a new tab was removed on 2026-09-05 — a list nobody
   visited as a destination — so the catalogue is unsurfaced until the editor integration lands.)
2. Steps are authored in a bare `<textarea>` (`workflow-form.tsx:490-500`): no line numbers, no
   highlighting, and lint findings name a JSON path you cannot click to.
3. The channel form asks for the workflow **id as free text** (`channel-form.tsx:366-370`) and
   HTTP methods as a comma-separated string (`:288-294`). *(Done: a picker and a checkbox group.)*
4. The Data Console cannot send request headers (`console.tsx`), so a channel with
   `auth.api_key`, `hmac` or `jwt` answers 401 from the console and cannot be exercised from
   the UI at all. *(Done: a headers table remembered per channel, with a warning when the
   channel's auth header is missing.)*
5. Nothing on the channel detail page shows the channel's own traffic, its recent traces, or a
   "send a test request" button; the operational data lives on the dashboard and the map only.
   *(Done.)*

Both loops share a root cause: pages are organised around API resources, and the links between
them stop one hop short of the action.

---

## 2. Priority 1 — Operations dashboard

File: `src/pages/operations.tsx` (716 lines), data from `hooks/use-metrics.ts`,
`use-health.ts`, `use-engine.ts`, `use-traces.ts`, `use-connectors.ts`.

### What already works well

- "Needs attention" is severity-ordered and stable across polls (`:183-258`), lists only
  actionable items, and its all-clear state says what was checked (`:399-406`).
- Erroring channels come from the Prometheus counters rather than the trace table, which catches
  failures that never write a trace (`:155-170`).
- Top channels promote erroring rows above busy ones (`:260-276`); Workflow cost separates engine
  overhead from task bodies (`:592-669`).
- The metrics-off state names the server flag to enable (`:371-378`).

### 2.1 Alerts stop one hop short of the action

| Alert | Goes to today | Should go to |
|---|---|---|
| Quarantined channel (`:195`) | `/channels` list | `/channels/:id` with a quarantine banner — the detail page currently has none |
| Connector failed to load (`:204`) | `/connectors` list | `/connectors/:id` with the Test dialog opened |
| Circuit breaker open (`:247`) | `/circuit-breakers` | same page, scrolled to and highlighting that key |
| Component degraded (`:238`) | `componentRoute()` or `/settings` | the health report scrolled to that component, hint expanded |
| Erroring channel (`:222`) | `/traces?channel=` | keep, add `status=failed`, and offer "Open in System Map" as a second action |
| Failed trace (`:256`) | `/traces/:id` | fine |

The name→id lookups already exist (`buildIndex().channelsByName` in `lib/topology.ts`; connectors
by name in `system-graph.ts:245-256`). Extract the alert derivation (`:185-258`) into a
`useAttentionItems()` hook so the sidebar badge and the header pill (§4.3) can share it instead
of re-deriving it.

Also: alert rows truncate both lines with no tooltip (`:710-711`), so a long quarantine reason —
the whole remedy — is cut off. Add `title` and let the detail wrap to two lines.

### 2.2 Time is invisible

- The KPI strip mixes three time bases and says so nowhere: Requests/min and Avg latency are a
  single 10 s poll delta (`use-metrics.ts:381-385, 400-403`); p95 is cumulative since the server
  started (`:409-413`); the erroring-channel alert is cumulative (`operations.tsx:221`); the
  sparklines cover "since this page loaded, at most 60 samples" (`use-metrics.ts:60`).
- The System Map has a window selector (1 / 5 / 10 min, `system-map.tsx:54-58`) built on the same
  ring buffer through `useChannelTraffic`. The dashboard does not use it.
- Failed traces in "Needs attention" are the five most recent with no age bound
  (`operations.tsx:133-136, 249-257`). On a quiet system a failure from three days ago stays in
  the list, and the all-clear copy claims "no failed traces recently" (`:404`), which is not what
  is checked.

**Proposal**

1. Put the same window selector in the page header and drive the KPI strip, Top channels and the
   outcomes chart from `useChannelTraffic(windowSec)`, which already computes windowed
   ok / failed / rejected / duplicate per channel. Label every cumulative number "since start".
2. Split the erroring alert into two facts: *failing now* ("12% in the last 5 min", windowed,
   drives severity) and *since start* ("34%", muted). The alert clears when the windowed rate
   drops below the warning band.
3. Bound failed traces to the window (or the last hour) and show relative age on every alert row
   ("since 4 m").
4. Show the covered span under each sparkline ("last 4 m 20 s"), as the map's footer does. The
   buffer only holds what the page has seen; a freshly opened dashboard implies a history it does
   not have.

### 2.3 Signals the dashboard does not show

All of these are available from hooks that already exist:

| Signal | Source | Why an operator wants it on the front page |
|---|---|---|
| Trace DLQ depth and exhausted count | `useTraceDlq({ limit: 1 })` → `total`; `exhausted: true` | An async failure queue is the single most important backlog number; today it is visible only by opening `/trace-dlq` |
| Cron: pending occurrences, lag p95, lease failures, and failed / skipped occurrences in the last 24 h | `useCronMetrics()` (`use-metrics.ts:539-577`), `useCronOccurrences({ status: "failed" })` | A nightly job that fails never enters the DLQ and never appears in "failed traces" if trace storage dropped the row. The dashboard is silent unless `components.cron` is degraded |
| Background task restarts (`restarts > 0` or `state !== "running"`) | `health.background_tasks` | "Up now but has been failing" is a real alert; only the health report renders it (`health-components.tsx:153-183`) |
| Node identity | `breakers.instance_id`, `health.git_hash` | Breakers and plugin load state are per replica (`circuit-breakers.tsx:65-70`); the dashboard never says which node it describes |
| Recent changes | `useAuditLogs({ limit: 5 })` | The first question after an incident is "what changed"; the audit log is four clicks away |
| Internal channel load | `deriveLoad()` (`traffic-encoding.ts:125-162`) | "6 of 7 channels have served a request" (`:424-440`) undercounts forever because `channel_call` targets have no series; report "48 serving · 9 internal (unmetered) · 5 idle" |

### 2.4 KPI strip (`:347-378`)

- Error rate renders `0.0 %` when nothing was processed in the window (`use-metrics.ts:392`
  returns `0`). A zero reads as healthy; show "— no traffic".
- No thresholds: 12% renders in the same colour as 0%. Reuse the map's bands
  (`traffic-encoding.ts:25-28`: warning ≥ 1%, critical ≥ 5%) so the dashboard and the map agree
  on what "failing" means.
- p95 is the only KPI without a sparkline (`:369`) and the only cumulative one. Compute a windowed
  p95 from bucket deltas, or label it "since start".
- KPI cards are not links. Error rate → `/traces?status=failed`; p95 → Top channels sorted by p95;
  Requests → System Map.
- When metrics are off the page shows three separate empties for one cause (`:372-377`, `:505`,
  `:606`). Show one banner and hide the metric-backed cards.
- Avg latency in µs (`21µs` in the screenshot) is honest but reads as a rendering glitch to a
  newcomer; consider "<1 ms" below the millisecond.

### 2.5 Outcomes by channel (`:444-491`)

- Absolute stacked counts: the busiest channel dominates and a 1% error segment is a hairline.
  Normalise to 100% per channel with counts in the tooltip (or a share / count toggle), and sort
  by failure share whenever any channel has one.
- There is no legend, and `statusChartColor` (`lib/status.ts:126-142`) has no entry for
  `timeout`, `unauthorized` or `duplicate`, so all three fall back to the same grey: a timeout
  looks like a suppressed duplicate. Add the three colours (timeout = warning, unauthorized =
  info, duplicate = muted) and draw a legend.
- Bars are inert; a click should open traces filtered to that channel.

### 2.6 Top channels (`:494-550`)

- Rows are static (`:519`) while every other card's rows navigate. Link the name to the channel
  and add "map" as a secondary action.
- "Req / min" (10 s delta) and "Total" (since start) sit in one row with no basis in the header.
- Names truncate to `high-value-…` (`:520`) with only a `title` tooltip; give the name column a
  minimum width and let the numeric columns shrink.
- Internal channels never appear. Either add derived-load rows marked `≤` (hollow, as the map
  draws them) or a footnote: "9 internal channels are dispatched in-engine and carry no series".

### 2.7 Recent traces (`:552-590`)

- Absolute timestamps (`Aug 28, 2026, 04:41 AM`) on a live feed; use relative time with the
  absolute instant on hover.
- No duration, and a failed row does not show its `error_message` — both are on the list row.
- Six rows and no live indicator, though the card already polls every 15 s (`:129-132`).

### 2.8 Workflow cost (`:597-669`)

Valuable, but it is the last, full-width card, below the fold at 1080p. Two options: move it to
the Workflows list as columns (runs, mean, p95, engine %), or keep it on the dashboard behind the
window selector and use the vacated slot for DLQ + schedules (§2.3). Also, `useWorkflows({ limit:
200 })` (`:127`) drops names past 200 workflows; use 1000 like the map does.

### 2.9 First run

A fresh instance shows five empties at once (KPIs "—", all clear, "No message activity yet",
"No channel metrics yet", "No recent traces", "No workflow runs recorded yet"). When
`engine.channels.length === 0`, replace the grid with a getting-started checklist — create a
workflow → bind a channel → send a request from the console → read the trace — each step linking
to its page and ticking when done. The list pages already have teaching empty states; the
dashboard is where a new user lands first. *(Done, item 30 — the checklist leads the dashboard
rather than replacing it.)*

### 2.10 Proposed layout

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Operations                                       Window [5 min ▾]   ● live · 4 s ago  ⟳ │
│ ok · v1.6.0 · node a1b2c3 · up 3 d 4 h · 62 channels: 48 serving · 9 internal · 5 idle   │
├──────────────┬──────────────┬──────────────┬──────────────┬──────────────┬───────────────┤
│ Requests/min │ Error rate   │ p95 latency  │ Trace DLQ    │ Cron backlog │ Open breakers │
│ 1,240 ▁▂▃▅▆  │ 0.4% ▁▁▂▁▁   │ 212 ms ▂▂▃▂  │ 12 · 3 exh.  │ 2 · lag 4 s  │ 1 (this node) │
│ last 4 m 20 s│ ≥1% amber    │ windowed     │ → DLQ        │ → Schedules  │ → Breakers    │
├──────────────┴──────────────┴──────┬───────┴──────────────┴──────────────┴───────────────┤
│ Needs attention (4)                │ Traffic by channel · last 5 min        [legend]     │
│ ⛔ Quarantined auth-login · 2 h  → │ auth-login   ████████████░░  96% ok · 4% timeout     │
│ ⛔ Connector pg failed to load   → │ orders       ██████████████ 100% ok                  │
│ ⚠ Breaker open orders:pg · 2 m  → │ …                                                    │
│ ⚠ nightly-report failed 03:00   → │                                                      │
├────────────────────────────────────┼──────────────────────────────────────────────────────┤
│ Top channels · window     [→ map]  │ Recent   ( traces │ changes )              ● live    │
│ name     rate  err%  p95   share   │ ✗ failed   auth-login  sync  12 s ago  TIMEOUT_ERROR │
│ orders   620   0.0   180 ms ██████ │ ✓ done     orders      sync  15 s ago  210 ms        │
│ ≤ lookup 610    —      —   ░░░░░   │ ✎ update   workflow orders v4 · ci · 3 m ago         │
├────────────────────────────────────┴──────────────────────────────────────────────────────┤
│ Next 24 h: nightly-report 03:00 (failed · retry →) · sync-crm in 40 m · …                 │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Priority 1 — System Map

Files: `pages/system-map.tsx`, `components/graph/traffic-map.tsx`, `traffic-node.tsx`,
`map-inspector.tsx`, `lib/system-graph.ts`, `lib/map-layout.ts`, `lib/traffic-encoding.ts`.

### What already works well

- One global graph with fan-in visible and hubs placed downstream of their callers
  (`system-graph.ts:128-166`, `map-layout.ts`). Clusters collapse eighteen identical edges into
  one (`map-layout.ts:64-73`).
- Derived load with the honest `≤` (`traffic-encoding.ts:96-162`) removes the biggest lie a naive
  map would tell about internal channels.
- `rejected` as its own colour rather than a failure (`traffic-encoding.ts:11-22`).
- Selecting from the failing strip or the inspector travels the canvas (`traffic-map.tsx:206-209`).
- Layout depends on structure only, so a poll does not shuffle the canvas (`:167-179`).

### 3.1 The inspector disappears below 1024 px

The inspector card is `hidden lg:block` (`system-map.tsx:327`) and the legend `hidden lg:flex`
(`:268`). On a laptop with a split screen, clicking a node dims everything else and shows
nothing. Below `lg`, render the inspector as a bottom sheet or a slide-over panel; keep the legend
behind a popover button at every width.

### 3.2 Nothing on the map is linkable

Selection, window, search, tag, lifecycle, size and colour live in component state
(`:82-91`). The dashboard's "System Map" button (`operations.tsx:436`) lands on an unselected map.
Put `select`, `q`, `tag`, `window`, `size` and `colour` in the URL with `useSearchParams` — the
pattern `traces.tsx:72-91` already uses — and link into it from dashboard alerts, the channel
detail page ("Open in map"), and a "copy link" in the inspector.

### 3.3 The legend is wrong in two of three colour modes, and most encodings are unexplained

- The legend swatches are hard-coded to the health labels (`:269-273`). In **Latency** mode the
  bands are < 100 / 100–500 / 500–2000 / ≥ 2000 ms (`traffic-encoding.ts:38-49`), but `levelFor`
  folds the second band into `warning` (`:223`), and the legend keeps saying
  "healthy / errors / failing / rejected". In **Lifecycle** mode `draft` is painted with the
  `rejected` colour (`:226-227`) while the legend still reads "rejected".
- Not explained anywhere on screen: dot **size** (square-root of the metric, `:209-213`); a
  **hollow** dot = load inferred from callers (`traffic-node.tsx:97-98`); a **thick ring** = hub
  with five or more callers (`:19, :100`); a **dashed** border = named by a call but not in the
  registry (`:138`); a **compact** card = no traffic in the window (`:131-154`); edge width = the
  caller's rate as an upper bound (`traffic-encoding.ts:268-271`).

**Proposal**: a metric-aware legend (`legendFor(colorMetric)`), a size scale showing the min and
max values of the current size metric, and a "How to read this map" popover beside the filters.
Latency mode should keep four distinct levels instead of folding two.

### 3.4 The canvas jumps when traffic arrives

`layoutKey` includes `isCompact(id)` per node (`traffic-map.tsx:172-179`), and `fitView` runs on
every layoutKey change (`:197-202`). A channel receiving its first request in the window grows
from 204 × 42 to 260 × 76 px, which re-lays out every lane and re-frames the viewport — on a
bursty system, on the 10 s poll. Options, in order of preference:

1. Hysteresis: once a node has expanded in this session it stays expanded.
2. One node size, with density expressed inside the card rather than by its footprint.
3. Re-layout without `fitView` unless the *node set* changed; animate position changes.

### 3.5 Scale

The design accepts an unreadable first frame (`FIT_MIN_ZOOM = 0.15`, `:41-46`). Four things would
make 60+ channels readable:

1. **Level of detail by zoom.** Below ~0.5 render dot + name only; above it the full card
   (`useViewport().zoom` from React Flow). The compact rendering already exists; drive it by zoom
   as well as by traffic. This also retires the 10 px text (§3.13).
2. **Collapsible clusters.** A cluster of 18 entries sharing one callee should collapse to a
   single summary node (count, summed rate, worst health) and expand on click. Today the box saves
   edges but not height (`map-layout.ts:134-152`), and it is `pointer-events-none`
   (`traffic-map.tsx:92`).
3. **MiniMap.** The `.react-flow__minimap` styles are already themed (`index.css:251-255`) but the
   component is never rendered (`traffic-map.tsx:380-381`). Show it when the node count exceeds
   ~15.
4. **Blast-radius hops.** Focus dims everything outside `neighbourhood(graph, id)` with
   `hops = Infinity` (`traffic-map.tsx:226-229`, `system-graph.ts:272`). In a connected system
   that dims nothing. Default to one hop with a `1 · 2 · all` control in the inspector.

*(Done, item 27 — all four. Clusters also start collapsed on a map of 30+ channels, and the
selected channel's cluster stays open.)*

### 3.6 Search filters instead of finding

Typing narrows the visible set (`system-map.tsx:122-143`) but neither selects nor travels, and the
placeholder is clipped at the field's width in the screenshot. Highlight matches and dim (rather
than hide) the rest, and let Enter select the first match through `revealChannel`.

### 3.7 The selector says 5 min while the data covers 13 s

The window selector (`:195-206`) and the real span, which appears only in the 10 px footer
(`:321-324`) and the callouts. Show the covered span in the selector ("5 min · 13 s so far"),
disable options longer than the buffer holds, and persist the ring buffer to `sessionStorage` so
a reload does not reset to "waiting for a second sample".

### 3.8 Faults are not drawn on the map

The map's stated purpose is "what is busy and what is broken", but three fault sources never
reach the canvas: a connector that failed to load (`health.connectors.failed_to_load`), an open
breaker (`breakers["channel:connector"]`), and a quarantined channel
(`health.channels.quarantined`). The connectors rail (`:345-370`) marks only unknown and disabled.

**Proposal**: a red badge on the rail for a failed connector; a warning glyph on every node whose
connector list includes one; quarantined channels drawn with a shield glyph and listed in the
failing strip; breaker state on the inspector's connector chips.

### 3.9 Metrics off reads as "no traffic"

`traffic.activeCount === 0` (`:299-307`) shows "No channel has carried traffic … send a request
from the Data Console" when `/metrics` is disabled on the server. `useMetrics().available`
distinguishes the two cases; say "Metrics are off on this server; the map shows structure only".

### 3.10 Inspector additions (`map-inspector.tsx`)

- A rate / error sparkline for the selected channel over the window; the buffer has every sample.
- Its connectors' load status and breaker state (the chips at `:304-335` show only enabled /
  unknown).
- The three most recent failed traces for the channel
  (`useTraces({ channel, status: "failed", limit: 3 })`).
- Actions: "Send test request" (console with `?channel=`), "Trigger now" for a cron channel,
  "Edit" for a draft. The footer offers only Channel and Traces / Occurrences (`:338-357`).
- The header renders `${methods} ${route}` (`:106-110`); a Kafka channel shows "async " with
  nothing after it because `SystemNode` has no `topic` (`system-graph.ts:39-73`). Add it.

### 3.11 Edges

No hover and no label. Add a tooltip: "order-enrichment → customer-lookup · ≤ 47/m, bounded by
the caller's rate". `animated: hot && inFocus` (`traffic-map.tsx:349`) animates every hot edge;
on a busy map that is constant motion. Animate only the selection's edges and honour
`prefers-reduced-motion`.

### 3.12 Two graph languages in one app

Detail pages embed `RelationshipGraph` (`relationship-graph.tsx`) with its own node style
(`nodes.tsx`), hard-coded `rgba(76,189,151,0.7)` glows (`nodes.tsx:28, 31, 34`, against the
project's "never hardcode a colour" rule), non-interactive at 300 px (`:60`), and no traffic.
Replace it with a one-hop projection of the System Map (`neighbourhood(graph, id, 1)` rendered
with `TrafficNode`) plus "Open in System Map". One vocabulary, and live health on the detail page
for free.

### 3.13 Smaller items

- "Colour: Lifecycle" while the lifecycle filter is "Live channels" is one colour; switching
  colour mode should switch the filter to "All lifecycles" or explain the all-green result.
- The Live / Paused button (`:187-194`) reads as a status, not a control. Use "Pause" / "Resume"
  with a pulsing dot for live.
- Lane title "Called · depth 1" (`traffic-map.tsx:48-56`) is jargon; "Internal · 1 hop from an
  entry" reads better. The entry-lane subtitle "reached over their route" is wrong for a cron
  channel.
- Cron nodes could show "next fire in 4 h" from `useCronStatus()` and use the last occurrence
  status as health between fires.
- `text-[10px]` on nodes (`traffic-node.tsx:186, 206, 218`) is below a 12 px floor; level of detail
  (§3.5) lets the card use 12 px at reading zoom.
- Keyboard: nodes are focusable but selection is click-only (`traffic-map.tsx:372-378`); Enter /
  Space should select, Escape clear.

### 3.14 Inspector below `lg` — sketch

```
┌──────────────────────────────────────────────┐
│ [canvas]                                     │
│                                              │
├──────────────────────────────────────────────┤  ← sheet, drag to expand
│ ● customer-lookup   internal · 3 steps    ✕  │
│ ≤ 47/m inferred · p95 12 ms · ▁▂▃▂▁ (5 min)  │
│ called by 6 · calls 0 · pg ⚠ breaker open    │
│ [Channel] [Traces] [Send test] [Open full]   │
└──────────────────────────────────────────────┘
```

---

## 4. Priority 1 — Left navigation

File: `src/components/layout/sidebar.tsx` (plus `header.tsx`, `app-layout.tsx`,
`shared/command-palette.tsx`).

### 4.1 What is wrong with the current grouping

Current (`sidebar.tsx:21-54`):

```
Operations
SYSTEM       System Map · Channels · Workflows · Connectors · Plugins · Packages
             (Functions sat here too until it was removed on 2026-09-05)
MONITORING   Traces · Schedules · Trace DLQ · Circuit Breakers · Audit Log
TOOLS        Data Console · Settings
```

- **"System" is six items of three natures**: a live view (System Map), definitions (Channels,
  Workflows, Connectors, Plugins) and CI receipts (Packages). It is the group an operator scans
  past to reach Monitoring.
- **"Monitoring" holds Schedules**, whose page creates cron channels and triggers runs
  (`schedules.tsx:113-117, 266-274`), and **Audit Log**, which is governance.
- **"Tools" pairs the developer's test bench with "Settings"**, a page that contains no settings:
  it is the health report, engine reload, connector reload, backups and API docs
  (`settings.tsx`). Theme and density live in the header. The name sends operators looking for
  health to the wrong place, and `componentRoute()` falls back to `/settings` for a degraded
  component (`lib/health.ts:15-17`).
- The groups mirror API resources, not the two loops in §1. An on-call user's second-tier pages
  (Traces, DLQ, Breakers) sit in the middle of the list; the developer's test bench sits at the
  bottom, far from the definitions it tests.

### 4.2 Proposed grouping

```
  Operations                    badge: open alerts
  System Map

BUILD                           the developer loop: define → validate → test
  Channels                      Create ▾ (REST · HTTP · Kafka · Cron)
  Workflows
  Connectors
  Plugins
  Data Console                  moved from Tools

OBSERVE                         the operator loop: watch → drill → act
  Traces
  Schedules                     the cron status + ledger; the create CTA moves to Channels
  Trace DLQ                     badge: exhausted count
  Circuit Breakers              badge: open count on this node

GOVERN
  Audit Log
  Packages
  Engine                        renamed from Settings: health, reload, backups, API docs
```

| Change | Why |
|---|---|
| Operations and System Map ungrouped at the top | The two overview pages; every persona starts on one of them |
| Build = the four definitions + console | Everything a developer touches in one loop, in the order the smoke flow uses them (`e2e/smoke.spec.ts`) |
| Data Console leaves Tools | It is not a utility; it is step 4 of authoring |
| Schedules stays with Observe | Its content is status and the occurrence ledger; the definition is a channel with `protocol: cron`, so creation belongs on Channels |
| Audit + Packages + Engine = Govern | Change control and instance operations, which neither loop touches daily |
| Settings → Engine | The page's own card is "Engine", the API is `admin/engine/*`, and the word "settings" promises preferences that live in the header |

Minimal alternative if regrouping is too much churn at once: keep three groups, move System Map
up beside Operations, rename "System" → "Definitions", move Data Console into a new "Develop"
group, and rename "Settings" → "Engine".

### 4.3 Navigation mechanics

1. **Counts on nav items.** Operations (open alerts), Trace DLQ (exhausted entries), Circuit
   Breakers (open on this node), Schedules (pending > 0 or failed today). Health is already polled
   app-wide by the header (`use-health.ts`); breakers and the DLQ need one light poll each, on the
   query keys the pages already use. The alert count needs `useAttentionItems()` from §2.1.
2. **Header pill states.** The pill says "Unhealthy" for anything that is not `ok`
   (`header.tsx:57-72`). The server reports `degraded`, and degraded on `engine_reload`,
   `config_propagation` or `cron` does not fail readiness. Three states: Healthy / Degraded
   (amber, tooltip lists the components) / Unreachable. Make it a link to Operations, and put the
   node id beside it so per-replica data has a home.
3. **One navigation registry.** The sidebar list (`sidebar.tsx:21-54`) and the palette's "Go to"
   list (`command-palette.tsx:78-94`) are the same fourteen entries typed twice; `CLAUDE.md`
   documents the three-place registration. A `lib/nav.ts` exporting sections, icons, keywords and
   shortcuts should feed both, plus breadcrumbs and page titles.
4. **Collapsible rail and a drawer.** The sidebar is a fixed `w-60` (`sidebar.tsx:58`) in an
   `h-screen` flex shell (`app-layout.tsx:23-24`). Offer an icon-only mode with tooltips
   (persisted like density) and a drawer below `md` with a hamburger in the header. On a phone
   during an incident the content column is ~130 px wide today.
5. **Breadcrumbs instead of "Back to X".** Every detail page hand-rolls `← Back to Channels`
   (`channel-detail.tsx:74-76` and six siblings), which always goes to the list rather than where
   the user came from: map → channel → back lands on the Channels list. Breadcrumbs
   (`Channels / orders / v3`) plus the browser's own back button.
6. **Page titles.** `document.title` is the static `Orion — Plasmatic` (`index.html:7`); every tab
   and history entry reads the same. Set it per route from the registry.
7. **Keyboard.** `g` then `o / m / c / w / t …` to jump, `?` for a shortcut sheet, and a palette
   footer listing `↑ ↓ ↵ esc`. The palette has no result cap: with an empty query it lists every
   entity it fetched (`command-palette.tsx:67-70, 157-163`) — up to 800 rows.
8. **Section hints.** The group labels are fine at 11 px / 60% (`sidebar.tsx:76`); the loop hint
   ("define → validate → test") works as a tooltip rather than a second line.

---

## 5. Priority 2 — Cross-cutting

### 5.1 Error handling and resilience

- **No catch-all route** (`app.tsx:56-88`): an unknown URL renders the shell with an empty
  `<Outlet />`. Add a NotFound page with a search box.
- **No error boundary anywhere.** One render error white-screens the app. Add a per-route boundary
  with "reload" and the request id if the failure was an `ApiError`.
- Detail pages say "Failed to load channel." (`channel-detail.tsx:56-67`, same in six others)
  regardless of 404 / 403 / 500 / network. `ApiError` carries `status`, `code`, `details`,
  `requestId` (`api/client.ts:5-30`); a shared `ErrorState` should show them with Retry.
- Mutation toasts show `e.message` only (`use-channels.ts:46` and every hook); add the
  `details[]` lines and a "copy request id" action so a support ticket can carry it.

### 5.2 URL state and caching

- Only five pages use `useSearchParams` (`traces`, `schedules`, `functions`, `channel-form`,
  `trace-detail`). Filters on Channels, Workflows, Connectors, Plugins, Audit and the DLQ are not
  linkable or reload-safe. A `useUrlFilters()` helper wrapping `useSearchParams` + `resetPage`.
- `staleTime` was set only for functions (`use-functions.ts:13`); the client defaults left
  everything at 0, so every mount refetched — the System Map issues three 1000-row list calls,
  the palette four 200-row calls. (A remount inside the five-minute garbage-collection window does
  show the cached rows while it refetches, so that cost was network and server load rather than a
  visible flash; the flash happened on every page turn and filter change, where the query key
  changes and nothing is cached under it.) Now `staleTime: 30_000` is the client default and every
  paginated list hook sets `placeholderData: keepPreviousData`. **Done.**

### 5.3 Tables

- Clickable `<tr onClick>` rows (`channels.tsx:222-227` and every list) are not keyboard
  reachable. Make the name a `Link` and / or add `tabIndex={0}` + Enter.
- Skeletons render five rows (`channels.tsx:194`) for a 20-row page, so the layout jumps on load.
- No name search on Channels, Connectors or Plugins. The channel list API supports `tag` and
  `channel_type` (`types.ts:434-443`) but the page exposes neither (`channels.tsx:149-177`); a
  `q` parameter is a server ask (§8).
- The connector type filter is applied to the current page only (`connectors.tsx:113-116`):
  "DB" can show three rows and still offer a full next page.
- Only Traces sorts by column; Channels and Workflows accept `sort_by` and do not expose it.
- "Updated" columns are absolute; relative with the absolute on hover.
- Placeholders mix `"--"` (`channels.tsx:61`, `channel-detail.tsx`) and `"—"` (everywhere else).

### 5.4 Forms

- **Free-text ids.** Workflow id (`channel-form.tsx:366-370`), the cache and dedup connector
  names (`channel-config-editor.tsx`, placeholders `idempotency-cache`), HTTP methods
  (`:288-294`), tags. Replace with a searchable select of active workflows, a select of
  `cache`-type connectors, a checkbox group, and a chip input; every list they need is already a
  hook.
- **Server 400s are flattened.** `setError(e.message)` (`channel-form.tsx:198, 203`; same in the
  workflow, connector and plugin forms) drops `ApiError.details[]`, which carries
  `path / code / message / expected / got`. Render them like `ValidationResults` and focus the
  first offending field.
- **No unsaved-changes guard** on any form.
- **Workflow steps editor.** Adopt a code editor (CodeMirror 6, JSON mode) with `lintSteps`
  findings mapped to line / column, function-name completion from `useFunctions()`, and
  required-field snippets from `input_fields`. Render a live `WorkflowVisualizer` beside the
  editor; today the diagram exists only on the detail page (`workflow-detail.tsx:224-227`).
  *(Done, item 26 — the diagram sits below the editor rather than beside it, so the visualizer
  keeps the card's full width; the required-field snippets became completion of the declared
  fields inside `input`.)*
- **Channel form length.** One `max-w-2xl` column with ten-plus config sections stacked
  (`channel-config-editor.tsx:249-501`). Add a sticky section index (Basics · Routing · Auth ·
  Limits · Response · Tracing) and mark sections that hold values.
- Type and protocol are immutable after create (`channel-form.tsx:179-182`) but the create form
  does not say so. Priority fields carry no hint of what priority orders.
- Save wording differs: "Save" (channel, connector) vs "Create Draft" / "Save Draft" (workflow,
  plugin). Standardise on the draft wording, since every entity is a draft until activated.

### 5.5 Time

`formatDate` (`lib/utils.ts:29-37`) renders local time in `en-US` with no zone marker;
`datetime-local` filters (`audit.tsx:155-168`, `schedules.tsx:326-345`) take local input and
convert silently; server timestamps are UTC. Add a "times shown in: Local (UTC+05:30) / UTC"
preference, tooltips with the ISO instant, and relative times for anything under a day old.
*(Done, item 29 — the preference is on Engine → Display; a cell's `title` carries the absolute
time in the chosen zone, and `formatInstant` is the ISO form.)*

### 5.6 Accessibility

- `TabsList` has no `role="tablist"` and triggers have no arrow-key movement
  (`ui/tabs.tsx:52-96`).
- `text-[10px]` / `text-[11px]` in roughly forty places; a 12 px floor.
- The JsonViewer copy button has no accessible name (`json-viewer.tsx:47`).
- Compact map nodes encode health by colour alone.
- No `prefers-reduced-motion` handling for animated edges and pulses.
- The theme provider supports `system` (`theme-provider.tsx:4, 11-14`) but no control offers it;
  the header only toggles light / dark.

### 5.7 Responsive

Fixed sidebar, hidden inspector, hidden legend; nothing below `md` is designed. Minimum: drawer
navigation, the map stacked with a sheet inspector, cards to one column (mostly already
`grid-cols-1`). *(Done, item 28.)*

### 5.8 Consistency nits

- `workflows.tsx:114-129` hand-rolls the header instead of passing children to `PageHeader`;
  detail pages each hand-roll their title row. A `DetailHeader` (title, status, version, actions)
  would standardise seven pages.
- Button wording: "Create Channel" / "New Workflow" / "Upload Plugin" / "Create Connector".
- "View all" is a ghost `Button` with `navigate` in some cards and a `Link` in others.

---

## 6. Priority 2 — Page by page

### Channels — list, detail, form

- **Quarantine is invisible on the channel itself.** `/channels/:id` shows no banner when the
  channel is in `health.channels.quarantined` (`channel-detail.tsx` has no health read). Add the
  banner with the reason and a "Validate" shortcut; add a status chip on the list row.
- **No traffic on the channel page.** The dashboard and the map know the channel's rate, error
  share and p95; the detail page does not. Add a "Traffic" card from `useChannelTraffic` with a
  sparkline, and "Recent traces" for this channel (`useTraces({ channel, limit: 5 })`).
- **No test affordance.** Add "Send test request" → `/console?channel=<name>`; the console needs
  to read that parameter (it does not today, `console.tsx:176`).
- The Configuration tab renders cards for rate limit, backpressure, timeout, cache, response,
  OAuth2, dedup, origins and tracing (`:277-505`) but not `auth` (mode, header, key count),
  `request`, `validation_logic`, `rate_limit.key_logic` or `error_bodies`; those fall to the raw
  JSON. Auth is the security-relevant one.
- The list exposes status and protocol filters only (`channels.tsx:149-177`); the API also
  filters by `tag` and `channel_type`. Show the linked workflow and tags as columns.
- "Create Channel" should be a split button (REST · HTTP · Kafka · Cron) so the cron path does
  not depend on the Schedules page.

### Workflows — list, detail, form

- The list shows no "runs on" information. An active workflow bound to no channel is dead weight
  and a draft bound to an active channel is a surprise; both are computable client-side from the
  channel list.
- Detail: add "Runs on" (channels, with links) and a warning when none. The Dry Run tab starts
  from `{ }` (`workflow-detail.tsx:47`); offer "use the input of trace …" and remember the last
  payload per workflow in `localStorage`. `⌘ Enter` to run.
- Version compare exists for workflows only (`version-compare.tsx`); channels and plugins have a
  version list with no diff. `VersionHistory` shows version, status and date but not who
  (available from audit) or a "compare with previous" link.
- The diagram is `calc(100dvh - 19rem)` tall (`:225`); on a 768 px-high laptop that is the
  520 px floor and the tabs are below the fold. A "diagram / details" split toggle, or tabs above
  the diagram.

### Connectors — list, detail

- **Breaker matching bug**: `key.includes(connector.name)` (`connector-detail.tsx:55-57`) is a
  substring match, so connector `db` matches `orders:db-replica`. Use the segment after the colon.
- Delete has no dependency pre-check (`:176-189`); the server may 409, but the dialog should say
  "used by 3 active workflows" first — `buildIndex` has the answer.
- The list shows `load_status` (good) but not breaker state; add it.
- Detail shows the config as raw JSON only (`:115-124`); the structured editor exists for the
  form, so a read-only rendering of the same sections is cheap.

### Traces — list, analytics, detail

- List: add an error column for failed rows (`Trace.error_message`), a duration column exists;
  add a **Live** toggle (`useTraces` already takes `refetchInterval`), and use relative times.
- No date range filter — the API has none (`types.ts:1101-1114`); see §8.
- Analytics aggregates the last 100–500 rows client-side with no time axis
  (`trace-analytics.tsx`). Rows carry `created_at`, so an errors-per-minute histogram is possible
  without a new endpoint.
- Detail: the verdict layout is excellent. Add a copy button on the trace id, a link to the
  workflow that ran (only the channel is linked, `trace-detail.tsx:174-182`), "find similar
  failures" (`/traces?channel=&status=failed`), "re-send this input in the console", a per-task
  duration bar so the slow step is visible without expanding, and previous / next trace within the
  current filter.

### Data Console

- **Headers.** No way to set `x-api-key`, `Authorization`, `Idempotency-Key` or an HMAC signature
  header, so any guarded channel is untestable here. Add a headers table with per-channel memory.
- History is in-memory (`console.tsx:188, 285-300`) and lost on reload; persist eight entries per
  channel in `localStorage`.
- Payload: a plain textarea with validation only on Send; add "Format JSON", inline parse errors,
  and `⌘ Enter`.
- Pre-fill: the sample is `{ "example": "value" }`; offer the last trace's input for the channel.
- Read `?channel=` (and `?method=&path=`) so other pages can deep-link.
- Response: show HTTP status and elapsed time as chips above the JSON; poll an async receipt
  inline instead of only linking out.

### Schedules and occurrences

- Solid page. Add a 24 h timeline of upcoming fires across schedules, sortable "next fire", and
  an `error_message` preview on failed ledger rows (`occurrences-table.tsx`).
- The `datetime-local` filters (`schedules.tsx:326-345`) do not say they take local time.
- The channel filter lists active schedules only (`:300-308`); a paused channel's history is
  reachable only by URL.

### Trace DLQ

Good. Add a depth badge in the nav (§4.3), bulk requeue for a channel, and a channel link in the
entry dialog.

### Circuit breakers

Add "reset all open", a channel link (resolve the name through the channel list as the connector
already is, `circuit-breakers.tsx:27-31`), and a per-row highlight when arriving from an alert.
"Since" is a server ask (§8).

### Audit log

- `AuditLog.details` (`types.ts:1127-1140`) is never rendered (`audit.tsx:19-50`); add an
  expander row.
- Resource ids are plain text; link channel UUIDs to `/channels/:id`, workflow slugs to
  `/workflows/:id`, plugin ids to `/plugins/:id`.
- `change_context` (sent as `X-Orion-Change-Context`, `client.ts:32-40`) groups a promotion's
  rows but nothing shows or filters by it.
- Export (CSV / JSON) for the current filter.

### Functions

Removed on 2026-09-05: the route, the page, the nav and palette entries, and the links from the
workflow form and the plugin detail. The catalogue itself — `api/functions.ts`, `useFunctions()`
— stays, because the places it belongs are still to be built: function-name completion and an
inline schema panel in the workflow editor (roadmap 26), the task's function name on the trace
detail, and a `retry_safety` guard on the DLQ requeue and occurrence retry dialogs ("this
workflow has one task that is unsafe to retry: `send_email`"). A standalone list answered none of
those questions where they are asked.

### Plugins

Good. The upload form could show manifest parse feedback before Validate (TOML vs JSON detected,
function names found), and the list could carry this node's load state as a column.

### Packages

Fine for a read-only receipt view. Link a receipt to the audit rows with the same
`change_context` once the audit page shows it.

### Settings (→ Engine)

- Rename (§4.2). Move theme (with a `system` option) and density here as well as the header.
  *(Done — the Display card, item 29, which also holds the time-zone preference.)*
- "Reload Engine" has no confirmation and no impact note (cluster epoch bump, `engine.ts:7-12`).
- The API docs buttons open `/docs` and `/api/v1/openapi.json` unconditionally
  (`settings.tsx:184-197`); the spec is served only outside `environment = "production"`
  (`CLAUDE.md`). Probe first or annotate.

### Command palette

Substring match only, no ranking, no recents, no cap (`command-palette.tsx:157-163`). Rank exact
name matches first, cap each group at eight with "more…", remember the last five selections, and
add page-contextual actions (on a draft: "Activate", "Validate"; on any channel: "Open in map").

---

## 7. Roadmap

Sizes are engineering estimates for one person: **S** ≤ 1 day, **M** 2–5 days, **L** 1–2 weeks.
"Ops" / "Dev" marks the persona that benefits most.

### Quick wins

All fourteen shipped on 2026-09-05.

| # | Item | Section | Persona | What shipped |
|---|---|---|---|---|
| 1 | Deep-link every alert; quarantine banner on channel detail | 2.1, 6 | Ops | A quarantine lands on the channel (banner with the reason), a failed connector on the connector with its probe open (`?test=1`), a breaker on its highlighted row (`?key=`), a degraded component on its health row (`#component-<name>`), an erroring channel on failed traces. Channel-shaped alerts carry a second "Map" action. Detail lines wrap to two lines |
| 2 | Error-rate "no traffic", KPI bands, p95 label | 2.4 | Ops | Error rate is "—" with "no traffic" when nothing was processed; it paints amber ≥ 1% and red ≥ 5% (the map's bands) and links to failed traces. Every KPI says what it covers (the 10 s poll, or since start). Requests links to the map |
| 3 | Chart colours + legend | 2.5 | Ops | `timeout`, `unauthorized`, `duplicate` have their own colours; a legend under the chart; bars are each channel's share with counts in the tooltip, failing channels first; a bar opens that channel's traces |
| 4 | Header pill | 4.3 | Ops | Healthy / Degraded (amber, faulting components in the tooltip and a count) / Unreachable / Checking; links to Operations; the node id sits beside it |
| 5 | Metric-aware legend + help | 3.3 | Ops | `legendFor(colorMetric)` names the colours per mode; latency keeps four bands through a `notice` slot; a "How to read this map" dialog explains lanes, size, hollow and thick rings, dashed borders, compact cards, edge width and dimming |
| 6 | Map URL state | 3.2 | Ops | `select`, `q`, `tag`, `lifecycle`, `window`, `size`, `colour` live in the URL; the dashboard and channel page link with `?select=`; the inspector copies a link; the window selector says how much of the window is buffered |
| 7 | MiniMap; Kafka topic | 3.5, 3.10 | Ops | A minimap above 15 channels, themed through the stylesheet; `SystemNode.topic` on the graph, in the inspector header and in search |
| 8 | NotFound, error boundary, `ErrorState` | 5.1 | Both | `*` route; the layout's outlet sits in an `ErrorBoundary` keyed on the path; six detail pages render `ErrorState` with status, code, field details, request id and Retry |
| 9 | Tabs a11y; copy label | 5.6 | Both | `role="tablist"`, arrow / Home / End keys, roving tabindex, `aria-controls` / `aria-labelledby` wiring; the JSON copy button has a name |
| 10 | Caching | 5.2 | Both | `staleTime: 30_000` client default; `keepPreviousData` on the nine paginated list hooks |
| 11 | Breaker match | 6 | Ops | The connector segment of `channel:connector` is compared exactly |
| 12 | Trace list | 6 | Ops | An Error column, a Live toggle (5 s), relative times with the absolute on hover |
| 13 | Audit | 6 | Ops | `details` expands under the row as JSON; resource ids link to channel, workflow, connector, plugin, occurrence, breaker, DLQ or packages; relative times |
| 14 | Console deep link | 6, 3.10 | Dev | `/console?channel=` seeds the channel, method and path; "Send test request" on the channel page and "Test" in the map inspector; the URL follows the selection |

### Medium

All eleven shipped on 2026-09-05.

| # | Item | Section | Persona | What shipped |
|---|---|---|---|---|
| 15 | Dashboard window selector; windowed alerts | 2.2 | Ops | `?window=` on the dashboard (1 / 5 / 10 min, the same list as the map). Every KPI, the outcomes chart and Top channels cover the window; p95 comes from histogram bucket deltas, so it is windowed too rather than merely labelled. "Erroring" alerts are judged over the window once a second sample exists and say so, with the since-start share as context; failed traces are bounded to the last hour |
| 16 | Dashboard cards: DLQ, cron backlog, task restarts, recent changes | 2.3 | Ops | A backlog row: Trace DLQ depth with the exhausted count, open breakers on this node, cron backlog with lag p95 and lost leases, and the next scheduled run. A "Scheduled in the next 24 h" strip. "Recent changes" as a tab beside recent traces, with resource ids linked. New alerts for a scheduled run that failed in the last day and for a background task that restarted or stopped. Cron cards appear only when the server reports a scheduler |
| 17 | Navigation regroup, registry, counts, breadcrumbs, titles | 4 | Both | `lib/nav.ts` feeds the sidebar (Operations and System Map on top; Build; Observe; Govern), the palette's Go-to group, `g` + key shortcuts and the tab title. Live counts beside Operations, Schedules, Trace DLQ and Circuit Breakers, from the same hook the dashboard renders. Breadcrumbs on every detail and form page replace "Back to X". Settings is Engine at `/engine`; `/settings` redirects with its hash. The palette ranks exact names first, caps each group and lists its keys; `?` opens it. Not done: the "Create ▾" split button on Channels — Schedules keeps its create button |
| 18 | Faults on the map | 3.8 | Ops | `lib/faults.ts` overlays quarantined channels, failed connectors and open breakers on the canvas: a glyph per fault and a red or amber border on the node, the failing strip lists quarantines and failed connectors, the connectors rail marks a failed one, and the inspector explains each fault with a link to the probe or the breaker |
| 19 | Map inspector additions; sheet below `lg` | 3.1, 3.10 | Ops | Rate and error sparklines over the window, connector chips carrying load and breaker state, the three most recent failures, Trigger now for an active cron channel, Edit for a draft and Test for the rest. Below `lg` the inspector rises as a bottom sheet instead of vanishing |
| 20 | Layout stability | 3.4 | Ops | A channel that has expanded once stays expanded for the session, and the viewport re-frames only when the set of channels changes, never because a node grew |
| 21 | Form pickers, `details[]`, unsaved guard | 5.4 | Dev | A workflow picker grouped by status (a stray stored id stays selectable and says so), connector pickers for cache and dedup, HTTP methods as a checkbox group, tag chips on channels, workflows and plugins, `FormError` rendering path, message, expected and got, and an unsaved-changes dialog on all four forms through a data router and `useBlocker`, plus `beforeunload`. Not done: focusing the first offending field |
| 22 | Console headers, persisted history, format, ⌘ Enter | 6 | Dev | A headers table remembered per channel in this browser, a warning when the channel's `auth` header is missing, history kept across reloads, Format, ⌘ Enter to send, round-trip time on the response, and a payload handed over from a trace |
| 23 | Channel detail: traffic, recent traces, auth | 6 | Both | A Traffic card (rate, errors, p95, requests, sparklines, outcome bar, with "metrics off" and "no series" states) and the last five traces on the overview; Authentication, Request and Validation-logic cards plus key logic and error bodies in the configuration tab |
| 24 | Replace `RelationshipGraph` | 3.12 | Both | `NeighbourhoodMap`: one hop of the System Map around a channel, a workflow's channels or a connector's users, with live traffic and faults, a click to open a channel and "Open in System Map". The old graph, its node style, its layout and its tests are deleted. The connector delete dialog now names the channels that use it |
| 25 | Trace detail additions | 6 | Both | Breadcrumbs, a link to the workflow the channel runs, "Similar failures", "Re-send in console" with the first task's message payload (the trace read does not keep the raw request), a duration bar per step scaled to the longest, and Newer / Older over the ids the list handed over in router state |

### Larger

| # | Item | Section | Size | Persona | What shipped |
|---|---|---|---|---|---|
| 26 | Workflow editor: CodeMirror, lint to line, function completion, live preview | 5.4 | L | Dev | The steps, the condition's JSON mode and every config editor's Advanced view are a CodeMirror 6 editor (`shared/json-editor.tsx`), loaded on first use so no other page downloads it. Syntax errors underline as typed; each `lintSteps` finding is mapped from the coordinate it reports (`tasks[1].function.name`) to a range in the document through the parse tree (`lib/json-path.ts`), marked in the gutter and listed under the editor — click one to go there. Completion from the live catalogue (`lib/workflow-completions.ts`): function names inside `function.name`, that function's declared `input_fields` with kind, required and description inside `input`, the keys a step takes on Ctrl-Space, the `halt_on` spellings. The detail page's own diagram redraws below the editor 350 ms after the last keystroke, from the last document that passed the shape lint. The lint stays advisory — Save still goes to the server, which is the authority. |
| 27 | Map at scale: level of detail by zoom, collapsible clusters, hop control | 3.5 | L | Ops | Below zoom 0.55 a node is a dot and a large name, above it the full card. A cluster is a real node: a click collapses it to one summary (count, summed rate, worst health, a fault ring) and a click expands it; a map of 30+ channels starts with every cluster of 6+ collapsed, and the cluster holding the selected channel is always open. The inspector's blast radius is `1 hop · 2 hops · all`, one hop by default, in the URL as `?hops=`; the detail pages' neighbourhood map is fixed at one. A MiniMap appears past 15 nodes. |
| 28 | Responsive shell: drawer nav, collapsible rail, stacked map | 4.3, 5.7 | L | Both | Below `md` the sidebar is a drawer behind a menu button in the header — closed by a choice, Escape or the backdrop. Above it, a Collapse control at the sidebar's foot folds it to an icon rail with the live counts as overlay badges, remembered per browser. The map already stacks with a sheet inspector below `lg` (item 15); detail-page headers wrap instead of overflowing. |
| 29 | Time-zone preference and unified time rendering | 5.5 | M–L | Both | Engine → Display: "Times shown in" Local (named, with its offset) or UTC, remembered per browser; the header says "times in UTC" while that is on. `formatDate` renders in the chosen zone with a zone marker; `formatWhen` (relative under a day, absolute beyond) is the list-cell rendering, with the absolute in the cell's `title`; the audit and schedule `datetime-local` filters convert through the same preference and say which zone they take. Theme (now with "Follow the system") and density moved onto the same card. |
| 30 | First-run onboarding on the dashboard | 2.9 | M | Dev | While the engine serves no channel the dashboard leads with a five-step checklist — create a workflow, activate it, bind a channel, activate it, send a request and read its trace — each step linking to its page and ticking from the live counts, with a link to the documentation; dismissable per browser. The rest of the dashboard stays below it rather than being replaced, so an operator with only drafts still sees the health strip. |

---

## 8. Server-side asks

Items above that the UI cannot deliver alone; worth filing against the Orion server.

| Ask | Unblocks |
|---|---|
| `GET admin/traces?since=&until=` (time range) | Trace date filter, dashboard "failed in the last hour" without over-fetching |
| `GET admin/channels?q=` (name / route search), same for connectors and plugins | List search without client-side paging artefacts |
| A `total` on `GET admin/trace-dlq` without fetching rows, or a `?exhausted=true&limit=1` count | Nav badge and dashboard card cheaply |
| Breaker state with `since` / `last_transition_at` | "open for 2 m" on the dashboard and breakers page |
| `GET admin/cron/occurrences?status=failed&since=` count, or per-channel counts on `cron/status` | Cron alerts on the dashboard |
| `details.change_context` as an audit filter | Grouping a promotion's audit rows on the Audit page and linking from Packages (the value is shown in a Context column; filtering waits on this) |
| `error_message` on the occurrence *list* row (`CronOccurrenceSummaryResponse`) | A failure preview on the ledger without one detail read per row |
| Windowed histogram quantiles are already possible from bucket deltas; nothing needed | — |

---

## 9. Follow-up beyond the roadmap

A second pass on 2026-09-05 took the proposals in §2–§6 that never reached the roadmap in §7.
What shipped, and what was left on purpose.

### Shipped

| Area | What shipped |
|---|---|
| Dashboard (§2.2, §2.6) | Every windowed figure says how much of the window is buffered ("last 5 min · 48 s so far"), the same "so far" the map's selector shows; Top channels rows carry a Map action beside the row's own link |
| System Map (§3.6, §3.11, §3.13, §5.6) | Search highlights the hits and dims the rest instead of hiding, so the canvas holds still while a name is typed; Enter selects the exact name first, then the first match. Every edge has a hover tooltip naming caller, callee and the rate bound ("≤ 47/m — at most the caller's rate"). A focused node selects on Enter or Space and clears on Escape. A cron card shows its next fire. A node's accessible name and hover text carry what its colour means under the current metric. Animated edges and viewport travel honour `prefers-reduced-motion`, and a global rule stops CSS animation under it |
| Palette (§4.3, §6) | The last five commands lead an empty query as a Recent group; on a channel page the palette offers the map, a test request, its traces and, for a draft, its editor; a workflow draft offers its editor |
| Error handling (§5.1) | `toastError` shows the server's field findings and the request id with a "Copy request id" action; every mutation hook reports through it |
| URL state (§5.2) | `useUrlFilters`: the filters and sort on Channels, Workflows, Connectors, Plugins, Audit and the DLQ live in the URL |
| Tables (§5.3) | Rows open from the keyboard; skeletons draw a full page; Channels, Workflows, Connectors and Plugins sort by column, server-side, on the server's own `sort_by` fields; the connector type filter pages over the whole list rather than one page of it; the `--` placeholders are gone |
| Channels (§6) | Type and tag filters; Workflow and Tags columns; a quarantine chip on the row with the reason; version compare on the Versions tab |
| Workflows (§6) | A "Runs on" column that warns on an active workflow no channel runs; the dry run is the JSON editor with ⌘ Enter, remembers its payload per workflow in this browser, and can borrow the last trace's input; the diagram folds away and the choice is remembered; "Create Workflow" like its siblings |
| Connectors (§6) | Breaker state on the list (the worst of the connector's keys); the detail page renders the configuration as a settings table above the JSON, with masked secrets named as such |
| Traces (§6) | Analytics has a time axis — traces per bucket, failed on top, the bucket chosen from the span — from the rows' `created_at`; the trace id has a copy button |
| Console (§6) | `?method=&path=` complete a REST deep link; the payload is the JSON editor, so a syntax error is underlined as typed and ⌘ Enter sends; "Last trace's input" fills the payload from the newest trace through the channel; an async 202 is followed inline until the trace settles |
| Schedules (§6) | The status table sorts by channel, next fire, last run or pending |
| Trace DLQ (§6) | "Requeue all shown" behind a confirmation that names the channels; the channel links to its page in the list and the dialog; the retry-safety guard in the entry dialog and the bulk dialog |
| Circuit breakers (§6) | "Reset all open" behind a confirmation; the channel links to its page |
| Audit (§6) | A Context column showing `details.change_context`; CSV and JSON export of the current filter (the most recent thousand rows, the server's cap) |
| Plugins (§6) | Manifest feedback before Validate — the syntax detected, the plugin and version, the functions found, a missing `[[functions]]` table; a "This node" column with the load state from `/health`; version compare |
| Packages (§6) | A receipt links to its audit rows |
| Engine (§6) | Reload asks first and says what a reload does (the epoch bump, deferred transitions landing); the API docs buttons probe the spec once and say so when a production server withholds it |
| Functions (§6) | The `retry_safety` guard: a requeue or an occurrence retry names the tasks whose function is `unsafe_write` or `depends_on` its input, on the DLQ dialogs, the occurrence page and a cron channel's occurrences tab. The catalogue now reaches the place the question is asked |

### Left on purpose

| Proposal | Why not |
|---|---|
| Disable window options longer than the buffer (§3.7) | With 13 s buffered every option would be disabled. The selector says "5 min requested; 13 s buffered so far" instead, and the dashboard now says the same |
| Persist the metrics ring buffer to `sessionStorage` (§3.7) | Counters reset when the server restarts; a buffer that outlives a reload would splice a pre-restart sample onto a post-restart one and report negative deltas. The cost of not persisting is one ten-second poll |
| A size legend with the current min and max (§3.3) | The help dialog explains the square-root rule; two numbers that move every poll add little |
| A 12 px floor on every label (§3.13, §5.6) | The map card's geometry is sized for its 10–11 px lines, and level of detail already gives the card 13 px at reading zoom; a wholesale bump is a visual regression for a cosmetic gain |
| "<1 ms" for sub-millisecond latency (§2.4) | Microseconds are honest, and the same formatter serves trace steps, where they matter |
| Derived-load rows in Top channels (§2.6) | The footnote was the other option the analysis offered and says the same thing without a column of `≤` guesses |
| Workflow cost off the dashboard (§2.8) | The backlog row took the slot the analysis wanted freed; the card keeps its "since start" label |
| `DetailHeader` (§5.8) | A refactor of seven pages with no visible change |
| "Save Draft" on the connector form (§5.4) | Connectors have no draft state — `enabled` is their switch — so the draft wording would be wrong there |
| Focus the first offending field (§5.4) | Still needs an id per field; `FormError` names the path |
| An `error_message` preview on ledger rows (§6) | The occurrence list row does not carry it; a server ask, added to §8 |
| Author and "compare with previous" on version history (§6) | Compare defaults to the two newest versions, and the author needs an audit join per version |
| A 24 h timeline on the Schedules page (§6) | The dashboard's strip and the status table sorted by next fire answer it |
| `change_context` as an audit filter, package → audit by context (§6) | Server asks (§8); the value is shown, and a package links to its audit rows by resource id |
