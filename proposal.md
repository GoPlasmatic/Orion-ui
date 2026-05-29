# Orion UI — UI/UX Rethink Proposal

> Status: Draft for discussion · Date: 2026-05-29 · Author: design exploration
>
> Inputs analyzed: current `Orion-ui` codebase, the `payment-hub` sample use case
> (`../Orion-test/payment-hub`), the Orion product docs (`../Orion/docs/src`), and the
> goplasmatic.io marketing site (`../../website`) for brand alignment.
>
> The six open questions from the first draft have been answered by the team and are now
> baked into the body below; see §9 for the resolved decisions.

---

## 1. Executive summary

Orion markets itself as **"the declarative services runtime for the AI era"** — a single
binary that replaces microservice sprawl, where *"AI generates workflows, Orion provides
the governance."* The product story is about **confidence**: every service gets
observability, resilience, security, and safe rollouts built in.

The current UI does not tell that story. It is a **competent but generic CRUD admin panel**:
three entity lists, detail pages with tabs, forms backed by raw-JSON textareas, and a
dashboard that is essentially a wall of counters. It manages *records*. It does not help
an operator **run a system**.

The `payment-hub` demo makes the gap concrete. A payment flows
`payments` channel → `payment-authorization` workflow → (`channel_call`) → `fraud-check`
channel → back → decision, with an `idempotency-cache` connector in front. The operator's
real questions are *"Did pay-1001 go through? Why was it declined? Is the cache hitting?
Is fraud-check healthy?"* Today, answering any of these means hunting through a flat trace
list and reading raw JSON blobs. The relationships between the primitives — the thing that
makes Orion *Orion* — are invisible in the UI.

**This proposal recommends repositioning the UI from an entity manager to an operations
console**, organized around three shifts:

1. **From entity lists → operator questions.** Lead with "what's happening and what needs
   my attention," not "here are your rows."
2. **From three disconnected lists → one connected system.** Make the
   Channel→Workflow→Connector topology a first-class, navigable surface.
3. **From raw JSON inspection → guided decision narratives.** Turn the trace detail into a
   visual story of what the workflow decided and why.

Everything below is grounded in code that exists today and dependencies already installed
(notably `@xyflow/react`, `@goplasmatic/dataflow-ui`, `@goplasmatic/datalogic-ui`).

---

## 2. What exists today (baseline)

**Navigation:** sidebar with Dashboard, Channels, Workflows, Connectors, Traces, Audit Log,
Data Console, Settings. Header has theme toggle + a health pill.

**Dashboard** (`src/pages/dashboard.tsx`): four counter cards (Health, Workflows, Channels,
Connectors), two "active" cards, an Engine Status / Health Checks pair, and a "last 5 traces"
list. All data refreshes only on a manual **Refresh** button. No trends, no rates, no latency,
no error signal.

**Channels / Connectors:** full CRUD. List → filter dropdowns → table → detail (tabbed) →
form. Forms hydrate via keyed remount and edit config through a **12–14 row JSON textarea**.

**Workflows:** visualization-only (by design). List → detail with Visualization
(`WorkflowVisualizer`), a dry-run "Test" tab, Versions, and raw JSON.

**Traces** (`src/pages/trace-detail.tsx`): filterable list → detail page that stacks cards:
Details grid, optional Error block, a "Per-Task Execution Trace" of collapsible steps (each
expanding to Input/Output/Data-after JSON), Workflow Errors, and Output. It is effectively a
JSON inspector.

**Audit / Console / Settings:** audit log table; a data console to POST test payloads (with a
profiling panel); settings cards for engine reload, connector reload, backup, and API docs links.

**Design system:** Tailwind v4, OKLch tokens in `src/index.css`, DM Sans / DM Mono, cyan
primary (`#119FCD`), light + dark themes, shadcn-style primitives with CVA. Solid foundation.

### Honest assessment

| Strengths | Weaknesses |
|---|---|
| Clean, consistent component library and token system | Generic CRUD framing; no product narrative |
| Three primitives are present as nav | Primitives shown as **disconnected** lists — no topology |
| Tabbed detail pages group info sensibly | Dashboard = vanity counters, no operational signal |
| Dry-run + profiling + audit already wired | Traces under-deliver: raw JSON, no decision summary |
| Dark/light theming | Config editing via raw JSON textarea (error-prone) |
| Server-side pagination | No toasts, no live updates, weak empty states, no search/command palette |

---

## 3. Positioning vs. product: the gap

The docs promise eight pillars (Observability, Resilience, Security, Scalability,
Deployability, Extensibility, Availability, Maintainability). Mapping the headline promises
to what the UI surfaces today:

| Marketing promise | In the docs | In the UI today | Gap |
|---|---|---|---|
| "Governance is built in" | Rate limits, circuit breakers, validation, CORS, tracing per channel | Shown read-only in a Configuration tab | Not framed as governance; not editable visually |
| "AI generates workflows, you govern" | MCP → generate → validate → import | Import dialog + read-only workflows | Story never told; import is a plain textarea modal |
| Resilience (circuit breakers, retries) | Per-connector breakers, auto-recovery | Breaker tab with reset (no feedback) | Buried; no fleet-wide breaker view |
| Safe rollouts (canary, versioning) | % traffic split, draft→active→archived | Rollout shown as a number; LifecycleActions | No rollout slider, no version diff/compare |
| Observability (metrics, traces, OTLP) | Prometheus, per-task spans | `/metrics` proxied; trace JSON viewer | No metrics charts in-app; traces not analytic |
| "Secrets stored, never exposed" | Auto-masking | Masked `config_json` + a warning note | Reasonable, but masking UX is clunky on edit |

The UI currently *contains* most of these capabilities but **frames none of them as the
value proposition.** A first-time visitor cannot tell from the dashboard that Orion is a
governance-rich runtime for AI-generated services.

---

## 4. The rethink: three shifts

### Shift 1 — From entity lists to operator questions

The payment operator's day is a sequence of questions, not a CRUD session:

- *"Is everything healthy right now?"*
- *"What's my approve / review / decline mix in the last hour?"*
- *"Show me failed and declined payments — why did they fail?"*
- *"Is `fraud-check` slow? Is its circuit breaker tripping?"*
- *"Did the cache actually serve the retry of pay-1001?"*

**Proposal:** The dashboard becomes an **Operations Console** that answers these directly —
live request volume, success/error/decline rates, p50/p95 latency, top channels by traffic,
active alerts (breakers open, error spikes, queue depth), and an "needs attention" feed.
Counters become trends. (Detailed layout in §5.1.)

### Shift 2 — From three lists to one connected system

The single most important idea in Orion — and the thing the payment-hub demonstrates — is
that **channels, workflows, and connectors form a graph.** `payments` runs
`payment-authorization`, which *calls* the `fraud-check` channel and *uses* the
`idempotency-cache` connector. None of this is visible today.

**Proposal (per-channel, decided):** rather than one global mesh, the topology is always
**rooted at a single channel the user selects.** Pick a channel → render *its* flow chain:
the workflow it runs, every `channel_call` it makes (recursively), and every connector each
hop uses. This keeps the graph bounded and legible regardless of deployment size, and matches
how an operator actually thinks ("show me what `/payments` touches"). Rendered with the
already-installed `@xyflow/react`:

```
   Channel selector:  [ payments ▾ ]      ← user picks one root channel

                 ┌────────────────┐
   POST /payments│  payments      │  cache: idempotency-cache (TTL 300s) ◀── hit/miss rate
   ─────────────▶│  (channel)     │
                 └───────┬────────┘
                         │ runs
                 ┌───────▼────────────────┐
                 │ payment-authorization   │ parse→validate→enrich→[fraud]→decide
                 │ (workflow)              │
                 └───────┬─────────────────┘
                         │ channel_call
                 ┌───────▼────────┐
   POST /fraud-  │  fraud-check    │
   check ───────▶│  (channel)      │── runs ──▶ fraud-check (workflow) parse→score
                 └─────────────────┘
```

- Nodes colored by live health/status; edges show call relationships and connector usage.
- Click a node → side panel with status, recent throughput, error rate, quick links.
- This view *is* the product pitch made visible: Orion as "the nervous system for modern
  software" — you trace a signal from its entry channel through every reflex it triggers.
- On each Channel/Workflow/Connector detail page, add a **"Relationships"** mini-graph (the
  local neighborhood) so the connections are discoverable without leaving the page.

### Shift 3 — From raw JSON to guided decision narratives

The trace detail is the operator's most-used debugging surface and currently the weakest. For
the payment-hub it should answer "why declined?" at a glance, but today it shows stacked JSON.

**Proposal:** Rebuild trace detail as a **decision narrative** (details in §5.2):

- **Verdict header:** the outcome up front — `declined` · `risk_score=1.1` ·
  `recommendation=block` · 42 ms · cache miss — parsed from `message.data`.
- **Visual workflow overlay:** reuse `WorkflowVisualizer` with the trace's per-task results
  painted onto the nodes (executed / skipped / errored), so you *see* the path taken,
  including the `channel_call` hop into `fraud-check`.
- **Branch explanation:** render the `decide` task's JSONLogic with
  `@goplasmatic/datalogic-ui` (`DataLogicEditor`, read-only), highlighting which branch fired
  and why (`risk_score ≥ 0.6 → declined`).
- **Risk breakdown:** surface `amount_risk`, `country_risk`, `method_risk` → `risk_score` as
  a small contribution chart, not buried in an output blob.
- **Cache badge:** show "served from cache" vs "executed" explicitly.
- Keep the raw JSON, but as a collapsed "Raw" affordance, not the primary content.

---

## 5. Redesign by surface

### 5.1 Operations Console (replaces Dashboard)

Lead with signal, organized as "Now / Trends / Attention". **Data sourcing (decided):**
prefer the Prometheus **`/metrics`** endpoint for all analytics (request counts, latency
histograms, error/rate-limit/breaker counters) wherever possible; fall back to DB-backed
queries (trace aggregation, audit) only for what metrics can't provide.

- **Health strip:** engine version, uptime, overall health, and per-component health as
  compact chips (today's Health Checks card, condensed to one row).
- **Live KPIs (sparkline cards):** Requests/min, Success rate, Error rate, p50/p95 latency —
  each with a trend line over the last hour, not a single number. Sourced from `/metrics`.
- **Outcome distribution (generic):** a stacked bar of each channel's **terminal status mix**
  over time (e.g. completed / failed, or whatever terminal values a workflow produces). This
  must stay **domain-agnostic** — no payment-specific "approve/review/decline" baked in. The
  payment-hub's decisions are just one instance of a generic "distribution of outcomes per
  channel." Where richer outcome fields exist they can be surfaced per-deployment (see §9).
- **Needs attention feed:** open circuit breakers, error-rate spikes, async queue/DLQ depth,
  failed traces in the last N minutes, channels with no traffic. Each item deep-links to the
  relevant detail.
- **Top channels** table: traffic, error rate, p95 — sortable, click-through.
- **Auto-refresh** (TanStack Query `refetchInterval`) with a visible "live · updated 3s ago"
  indicator, replacing the manual Refresh button. (Polling is the transport — see §5.7.)

### 5.2 Traces & Observability

- **List:** add free-text search (id, channel), a time-range picker, quick filter chips
  (Failed, Declined, Slow > p95, Cache hits), and saved/quick filters. Add a small **latency
  histogram / volume-over-time** strip above the table so the list has analytic context.
- **Detail:** the decision-narrative rebuild from Shift 3.
- **New: aggregate analytics tab** — "errors by task," "slowest tasks," outcome distribution
  over time, cache hit rate. Pull from `/metrics` where the counters/histograms exist; use
  trace-table aggregation only for what metrics don't cover. Keep dimensions generic (channel,
  task, terminal status) so it serves any use case, not just the payment-hub.
- **Linked trace navigation:** when a trace contains a `channel_call`, link to the child
  trace (fraud-check) so you can follow the call chain.

### 5.3 Channels

- Keep CRUD; **replace the raw-JSON config textarea with a structured editor.** The config
  shape is well-known (rate_limit, backpressure, timeout, cache, deduplication, cors,
  tracing) — render real form sections with inputs/toggles, and keep an "Advanced (JSON)"
  escape hatch with live validation. This is the "governance is built in" story made tangible.
- Detail: add the **Relationships** mini-graph (which workflow it runs, which connectors that
  workflow uses) and a **live traffic** strip (req/min, error rate, p95) for this channel.
- List: surface protocol/route more prominently; add search; improve empty state with a
  "Create your first channel" CTA + import option.

### 5.4 Workflows

- **Visualization-only is the confirmed stance for now** (no in-UI editing). So make it
  *intentional and clear, not an absence.* This aligns with the site's framing —
  *"Control how your systems behave. Without touching code."* Add a banner/affordance:
  *"Workflows are authored as JSON (often AI-generated) and imported here for review,
  validation, dry-run, and safe rollout."*
- **Strengthen the import path** into a guided flow: paste/generate JSON → validate (show
  `{field, message}` issues inline using `DataLogicEditor` to visualize conditions) →
  dry-run against a sample → activate with rollout %. This turns import from a plain modal
  into the product's signature journey.
- **Rollout control:** replace the rollout *number* with a **slider** (0–100%) plus
  one-click rollback, matching the canary story in the docs.
- **Version compare:** diff two versions of a workflow definition (the version history exists;
  add a compare view).
- Expose `WorkflowVisualizer`'s tree/flow/graph view toggle (currently fixed to default).

### 5.5 Connectors

- Structured config editor per connector type (HTTP / DB / Kafka / Cache / Storage), same
  pattern as channels, with the secret-masking handled more gracefully than "replace the mask
  or you'll overwrite the secret" — e.g. a "leave unchanged" state for masked fields so the
  user can't accidentally clobber a stored secret.
- **Fleet-wide circuit-breaker view** (new): one screen listing every connector's breaker
  state (closed/open/half-open) with reset actions and *success/error feedback* (toasts).
  Today breaker state is buried per-connector with no confirmation after reset.
- Detail: Relationships mini-graph (which workflows/channels depend on this connector) so the
  blast radius of disabling it is visible.

### 5.6 Data Console

- Strong foundation already. Improvements: a **channel picker that pre-fills a sample payload**
  (derived from the channel's validation rules or recent traces), request **history**, and a
  one-click **"open as trace"** link after sending so console → trace detail is seamless.
- Make the profiling panel's "by function / by connector" breakdown link into the topology.

### 5.7 Global patterns (cross-cutting)

- **Toasts/notifications:** every mutation (activate, archive, reload, breaker reset, import)
  needs success/error feedback. Currently inline-only or silent.
- **Command palette (⌘K):** jump to any channel/workflow/connector/trace by name/id, run
  actions. High leverage for an operator tool.
- **Global search** in the header.
- **Empty states** that teach: each list's empty state should explain the primitive and offer
  the primary action (create / import / run seed).
- **Real-time via polling (decided):** there is no UI-facing push/streaming endpoint (channels
  speak HTTP and Kafka, not SSE/WebSocket to the browser), so "live" = TanStack Query
  `refetchInterval` on dashboards, traces, and breaker state, with a visible freshness
  indicator. Pick sensible intervals (e.g. 5s dashboard, 10s lists) and pause when the tab is
  hidden.
- **Loading/route transitions:** show pending state on navigation; today clicks feel inert.
- **Accessibility:** focus-trap + Esc-to-close on dialogs, keyboard nav, consistent focus
  rings. (ConfirmDialog/ImportDialog currently lack these.)
- **Consistent status color system:** unify the two competing trace-status color maps and the
  StatusBadge palette into one set of semantic tokens.

---

## 6. Visual & brand direction — align to goplasmatic.io

The dashboard should look like part of the Orion product, not a generic admin theme. The
marketing site (`../../website`) gives us a concrete brand system, and the good news is the
UI's existing OKLch tokens already overlap heavily with it. The corrections below pull the UI
fully onto the official brand.

**Brand metaphor — nervous system, not constellation.** I previously guessed a
constellation/star-field angle; the site is actually built on a **nervous-system** metaphor:
*"Orion — the nervous system for modern software,"* with the language of **Signals, Reflexes,
Memory, Protection**, and the value triad **Define clearly · Execute dynamically · Govern
centrally.** The per-channel topology view (§4 Shift 2) is the perfect place to express this:
trace a *signal* from its entry channel through every *reflex* it triggers, rendered as a
glowing neural graph on a dark canvas (the site uses Three.js bloom/neon for exactly this).

**Color tokens (from the site — make these the source of truth):**

```css
--bg-deep:      #07111A;  /* page background (matches UI today) */
--bg-section:   #063B4C;  /* deep section accent */
--bg-card:      #0F2030;  /* card surface */
--bg-card-alt:  #152839;  /* alt card */
--text-heading: #ECF4F8;
--text-body:    #7FAFC0;
--text-muted:   #3D6B7D;
--accent-blue:  #119FCD;  /* primary (already the UI primary) */
--accent-teal:  #4CBD97;
--accent-green: #06D6A0;
--accent-yellow:#FFD167;  /* warning */
--accent-red:   #EF476F;  /* destructive (already in UI) */
```

- **Dark-first.** The brand is dark-native (deep `#07111A`). Keep light mode, but treat dark
  as the primary, designed-for theme — the current UI is light-first.
- **Signature gradient for primary CTAs:** `linear-gradient(225deg, #119FCD 0%, #4CBD97 100%)`
  with dark text (`#063B4C`), per the site's primary buttons. Use sparingly for hero actions.
- **Status colors are semantic only:** green/teal = success, `#FFD167` = warning,
  `#EF476F` = error. Stop using emerald as a decorative accent (the UI does this today).

**Typography — add Montserrat for headings.** The UI uses DM Sans / DM Mono; the brand pairs
**Montserrat (700/800) for display & headings**, **DM Sans for body/UI**, **DM Mono for code &
labels** (the site's hero uses Adobe Typekit *Filson Pro*, optional for app chrome). Adding
Montserrat to headings is the single biggest "now it looks like Orion" change.

**Surface & elevation style:** the site uses **no drop shadows** — depth comes from layered
background colors plus subtle 1px borders at low opacity (`rgba(17,159,205,0.1)`), with hover
borders shifting toward green. Radii 8–16px (8 for controls, 12–16 for cards). Glassmorphism
(`backdrop-filter: blur(12px)`) on overlays/nav. Adopt this in place of the current shadow
scale.

**Make governance visible as design.** Render rate limits, breaker states, latency, rollout %
as small, consistent data-viz primitives in the accent palette across the app — reinforcing
"built-in governance / govern centrally" visually rather than only in text.

**Density:** an operations tool benefits from a denser, information-rich layout than the
current generous card spacing — introduce a compact mode for tables/consoles.

**Logo assets** live at `../../website/src/assets/`: `plasmatic-logo.svg` (full mark) and
`logo.svg` (the Orion mark). Use the Orion mark in the sidebar header in place of / alongside
the current Plasmatic logo.

---

## 7. Cross-cutting fix list (tactical)

Independent of the bigger rethink, these are concrete, mostly-small fixes:

1. Trace status colors duplicated/inconsistent (`dashboard.tsx` vs `trace-detail.tsx`) — unify.
2. Connector type filter is **client-side** — paginate/filter server-side or label the limit.
3. Manual-only dashboard refresh — add auto-refresh.
4. No mutation feedback — add toasts.
5. Forms edit config as raw JSON — structured editors (§5.3/5.5).
6. Import dialog disclaimer is weak ("conflicts not detected until import") — validate names.
7. Empty states are dead ends — add CTAs.
8. Modals lack Esc/focus-trap/scroll on small screens.
9. Workflow visualizer view toggle (tree/flow/graph) not exposed.
10. Circuit-breaker reset gives no confirmation.
11. Settings page reuses the Database icon for Backup *and* API Docs.
12. Dry-run / console payload templates are empty `{}` — seed with channel-appropriate samples.
13. No version diff/compare for workflows or channels.
14. No deep-link from a `channel_call` trace to the child trace.

---

## 8. Suggested phased roadmap

Prioritized by impact-to-effort. Phase 1 delivers the most operator value fastest.

**Phase 1 — Make it an operations tool (high impact, moderate effort)**
- Operations Console dashboard with live KPIs + needs-attention feed (§5.1)
- Trace decision-narrative rebuild: verdict header, workflow overlay, branch explanation,
  cache badge (§5.2 / Shift 3)
- Toasts + auto-refresh + unified status colors (§7: 1,3,4)

**Phase 2 — Make the system legible (high impact, higher effort)**
- System Map topology view with `@xyflow/react` (Shift 2)
- Relationships mini-graphs on each detail page
- Aggregate trace analytics tab + linked child traces (§5.2)
- Fleet-wide circuit-breaker view (§5.5)

**Phase 3 — Make authoring & governance first-class (medium effort)**
- Structured config editors for channels & connectors (§5.3/5.5)
- Guided workflow import → validate → dry-run → rollout journey (§5.4)
- Rollout slider + version compare (§5.4)

**Phase 4 — Polish & power-user (lower effort, ongoing)**
- Command palette + global search (§5.7)
- Empty-state CTAs, console payload templates, accessibility pass (§7)
- Visual/brand pass: goplasmatic.io tokens + Montserrat, dark-first surfaces, neural-graph
  topology styling, density mode (§6)

---

## 9. Resolved decisions

The first draft's open questions have been answered:

1. **Metrics source — `/metrics` first.** Drive analytics from the Prometheus `/metrics`
   endpoint wherever possible; use DB-backed queries only for what metrics can't provide
   (trace aggregation, audit). Reflected in §5.1 and §5.2.
2. **Outcome mix is generic, not payments.** The UI must stay domain-agnostic — render a
   generic per-channel **terminal-status distribution**, never hard-code
   approve/review/decline. Payment decisions are just one instance. Reflected in §5.1/§5.2.
   *(Follow-up worth deciding later: whether to let a deployment optionally declare a "key
   outcome field" so richer, domain-specific mixes can be surfaced without code changes.)*
3. **Workflows stay visual-only.** No in-UI editing for now; the UI is for review, validation,
   dry-run, and rollout. Invest in §5.4's import/dry-run/rollout journey, not an editor.
4. **Topology is per-channel.** No global mesh — the user selects one root **channel** and we
   render its bounded flow chain (workflow → `channel_call` children → connectors). Reflected
   in §4 Shift 2.
5. **Real-time = polling.** Channels speak HTTP and Kafka; there is no browser-facing push
   endpoint, so "live" is `refetchInterval` polling with a freshness indicator. Reflected in
   §5.7.
6. **Brand = goplasmatic.io.** Align to the official tokens, Montserrat/DM Sans/DM Mono type,
   dark-first surfaces, and the **nervous-system** metaphor (not constellation). Reflected in
   §6.

---

*Next step: align on the three shifts (§4) and the Phase 1 scope, then break Phase 1 into
implementation tasks.*
