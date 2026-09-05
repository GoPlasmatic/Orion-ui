# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run dev          # Start Vite dev server (proxies /api, /health, /healthz, /readyz, /metrics to ORION_URL)
npm run build        # TypeScript check + Vite production build
npm run lint         # ESLint
npm run preview      # Preview production build locally

npm test             # Vitest unit tests, incl. the API ↔ OpenAPI contract test
npm run test:e2e     # Playwright smoke flow (needs a live orion-server on :8080; skips locally if absent).
                     # ORION_URL points it at another server; UI_PORT moves the dev server off 5173 —
                     # `reuseExistingServer` adopts whatever is already listening there.
npm run patch:api    # Re-apply local fixes to the vendored spec (see contracts/PATCHES.md)
npm run generate:api # Patch + regenerate src/api/schema.d.ts from contracts/openapi.json
npm run check:contract # Fail if schema.d.ts is stale relative to the vendored spec
```

## Server contract

`contracts/openapi.json` is the vendored copy of the server's OpenAPI 3.1 spec (source:
`Orion/docs/openapi.json`, also served at `/api/v1/openapi.json` — but **only when the server
does not run with `environment = "production"`**) and pins the server version this UI targets.
`src/api/schema.d.ts` is generated from it (do not hand-edit).

`schema.d.ts` is **not imported anywhere**: it exists solely as a checked-in fingerprint for
`npm run check:contract`. Every type the app uses is hand-written in `src/api/types.ts`, so
regenerating it buys no type safety — read it to transcribe new shapes accurately, then write
them into `types.ts` by hand.

When the server API changes:

```bash
cp ../Orion/docs/openapi.json contracts/openapi.json
npm run generate:api   # runs contracts/patch-spec.mjs, then openapi-typescript
npm test
```

`contracts/patch-spec.mjs` re-applies local fixes to defects in the published spec; see
`contracts/PATCHES.md` for what is patched and why. It is idempotent and reports
`nothing to patch` once upstream is fixed.

`src/api/contract.test.ts` asserts every request the API layer can issue exists in the spec with
the same method and only declared query params, and its completeness check forces new API
functions to be added to the `INVOCATIONS` manifest. Note it matches spec paths **structurally**
(segment count plus `{param}` wildcards), so a path that moved to a same-shaped route fails as a
*method* mismatch rather than a path one. CI runs both plus the Playwright smoke flow against a
real server container (`ghcr.io/goplasmatic/orion`, tag-pinned to the targeted version).

## Architecture

Orion UI is a React 19 dashboard for the Orion workflow engine. It uses Vite 8, TypeScript (strict), Tailwind CSS v4, and TanStack Query/Table.

### Core Domain

Targets the Orion **v1.6** API (dataflow-rs 3.12 / datalogic-rs 5.4). Four primitives with a
Draft -> Active -> Archived lifecycle, plus the read-only operator surfaces:

- **Channels** — Service endpoints (sync/async, REST/HTTP/Kafka/**cron**). Config covers `auth`
  (`api_key` | `hmac` | `jwt`), rate limits (incl. `key_logic` + `key_headers`), backpressure,
  dedup, caching (incl. `key_logic` since 1.5), `origin_allow_list`, `request`, `response`
  (incl. `cookies`), `validation_logic`, `tracing` and **`oauth2_login`** (1.6, inbound OAuth2 /
  OIDC sign-in; `oauth2-login-editor.tsx`). `transport_config` is a JSON editor for Kafka and a
  structured schedule editor (`cron-transport-editor.tsx`) for cron. Full CRUD (create/edit
  forms, server-side Validate, bulk import, export). `methods` is `string[] | null`. A **cron
  channel** (`protocol: "cron"`, 1.6) is started by a clock: its schedule lives in
  `transport_config`, it is always `async`, registers no route or topic, is refused everything
  caller-shaped in `config` (`lib/cron.ts::CRON_REFUSED_CONFIG_KEYS`), and is run manually with
  `POST admin/channels/{id}/trigger` — never from the Data Console.
- **Schedules** — The cron occurrence ledger (`/schedules`): `GET admin/cron/status` (one row
  per active cron channel — schedule, next fire, last run, backlog) and
  `GET admin/cron/occurrences` (every instant a schedule was due, with `retry` for a failed or
  skipped one). An occurrence detail page carries the trace id, the executing version and the
  lease. Also embedded on a cron channel's detail page.
- **Plugins** — Custom task functions as sandboxed WebAssembly components (`/plugins`, 1.6): a
  versioned entity with the workflow's lifecycle. Upload (manifest as TOML text or JSON +
  component as base64, encoded in the browser; the sha256 is computed client-side to compare),
  Validate, activate/archive with pre-flight, versions, `GET admin/plugins/{id}/dependencies`
  (the active workflows calling its functions), import/export (`?include_artifacts=true`).
  The single read carries `health` — whether *this node* loaded the digest.
- **Workflows** — Step pipelines with JSONLogic conditions. A step is a **task** (carries
  `function`) or, since 1.2, a **task group** (carries its own `tasks`) — one condition gating a
  contiguous run, plus `terminal` to end the workflow after a step. Full authoring via
  `workflow-form.tsx` (visual condition editor + steps JSON with a client-side shape lint and
  task/guard-clause snippets + server-side Validate), plus import wizard, dry-run test, export,
  canary rollout (`PATCH /{id}/rollout`), and a **Dependencies** tab backed by
  `GET admin/workflows/{id}/dependencies`. Uses `@goplasmatic/dataflow-ui` `WorkflowVisualizer`
  and `@goplasmatic/datalogic-ui` `DataLogicEditor`.
- **Connectors** — External system connections: `http`, `kafka`, `db`, `cache`, `es`, `storage`,
  **`smtp`**. Full CRUD + Validate + **Test** (reachability probe) + export. Keyed by `id` (a UUID,
  distinct from `name`).
- **Functions** — The server's function catalogue (`GET admin/functions`, `api/functions.ts`,
  `use-functions.ts`) is fetched but has **no page**: the `/functions` reference was removed on
  2026-09-05 because a standalone list answered no question anyone had while doing something
  else. The catalogue belongs inside the workflow editor, the trace view and the DLQ / occurrence
  retry dialogs (see `ui-improvements.md`). Its shape still matters: since 1.2 it is *every*
  valid function name, not just the schema registry — entries carry `source` (`orion` | `engine`
  | `plugin`), optional `aliases`, `input_fields` is **absent** for an engine built-in, every
  entry carries `retry_safety` (1.6) and a `plugin` entry names the plugin version and digest
  serving it.
- **Trace DLQ** — Operator view of the async dead-letter queue (`/trace-dlq`): inspect, requeue,
  purge.
- **Packages** — Read-only promotion receipts (`/packages`). `PUT admin/packages/{name}` is
  deliberately **not** exposed; recording receipts is CI's job.
- **Health** — `/engine` (named Settings until 2026-09-05; `/settings` redirects) renders the
  whole `/health` report (`health-components.tsx`): every
  component with what its state means, plus the admin-only detail — background tasks, plugin
  loads and failures, the scheduler's own numbers. The Operations dashboard shows only the faults.

### v1.x wire contracts worth remembering

- **A cron channel's schedule is `transport_config` (1.6).** `{ schedule, timezone?, payload?,
  misfire_policy?, max_catch_up?, concurrency? }` — six-field expression (seconds first; five- and
  seven-field forms are refused rather than guessed at), an IANA zone, a fixed payload delivered
  where a request body would be. `lib/cron.ts::cronTransport` is the one reader. Unknown keys are
  refused. `payload` is recorded verbatim as every occurrence's trace input, so secrets and
  `env://`-style references are refused in it. `metadata.trigger` is what the workflow gets:
  `type` (`cron` | `manual`), `occurrence_id`, `scheduled_for`, `started_at`, `attempt`.
- **Occurrences outlive names.** `admin/cron/occurrences?channel_id=` filters by the stable id —
  an occurrence keeps the channel *name* it was materialised under, so renaming does not rewrite
  history. Statuses (`pending`, `claimed`, `running`, `completed`, `failed`, `skipped_misfire`,
  `skipped_singleton`) are an open string. A misfire run is **one** row with the count and range
  in `error_message`, not one per missed instant. A retry keeps the id and `scheduled_for` and
  increments `attempt`; only `failed` / `skipped_*` accept it (409 otherwise). Re-running finished
  work is a *trigger*, which mints a new occurrence. Failed occurrences never enter the trace DLQ.
  Cron runs **do** count in `orion_messages_total{channel}`, unlike `channel_call` targets.
- **`/health` components (1.4–1.6):** always `database`, `engine` (constant ok), `connectors`,
  `channels`, `background_tasks`, `engine_reload` (the last reload failed — serving the previous
  generation) and `plugins` (`disabled` when the sandbox is off and nothing needs it; a *state*,
  not a fault — `lib/status.ts::isComponentFault` keeps it off the dashboard); conditionally
  `kafka`, `cron` (on, or off while an active cron channel is quarantined), `config_propagation`
  and `cluster_redis`. `degraded` on `engine_reload`/`config_propagation`/`cron` does not fail
  `/readyz`. Admin-only detail adds `plugins.{loaded,failed_to_load}` (a failed load quarantines
  every workflow naming the plugin's functions — surfaced as an alert like a failed connector),
  `cron` (reconcile age, oldest pending, lease renewal failures) and `background_tasks[]`.
- **Plugins are off by default** (`plugins.enabled = false`): every `admin/plugins` route answers
  400, and a stored active plugin row quarantines its dependants rather than aborting. A plugin
  function is pure JSON → JSON with no imports at all (no clock, sockets, connectors, secrets — a
  `{"secret": …}` node in a plugin task's input is a create-time error). Activating a version is
  checked against every active workflow calling it: a renamed or newly-required field is a 409
  naming the workflow. `GET admin/workflows/{id}/dependencies` gained `plugins[]` (id, version,
  digest, functions) and `unresolved_functions[]` — a workflow with any of the latter would be
  refused activation on this node. `PluginResponse.manifest` is the validated manifest as JSON;
  `functions` repeats the names at the top level so a client need not walk it.
- **`retry_safety` (1.6)** is served for every catalogue entry as `{"kind"}` — `pure`, `read`,
  `idempotent_write`, `unsafe_write`, or `depends_on` with the `input` that decides
  (`http_call` → `method`, `data_write` → `op`). A different question from whether an *error*
  was transient. `retry-safety-badge.tsx` renders it.
- **`template_at` (1.5)** on a catalogue field: `[""]` means the value is JSONLogic, compiled
  once and evaluated per message, so an object there may be an operator call rather than a
  literal of the declared kind. A literal is JSONLogic for itself, so the static spelling still
  works. `channel_call.channel` is one such field — a computed target is an object, and
  `lib/topology.ts::channelCallTargets` skips it (the server's `has_dynamic_channel_calls` is the
  authority; `channel_logic` survives only as an alias).
- **`halt_on: "failure"` (1.6, dataflow-rs 3.10)** on a task ends the workflow when that task
  failed (status ≥ 400, which covers a `validation` rule) — the outcome axis to `terminal`'s
  position axis; they compose by `or`. `lintSteps` refuses any other spelling; the visualizer
  (dataflow-ui 3.12) draws it; `countHaltOnFailure` badges it.
- **`?token=` on trace reads is deprecated (1.6).** The header `x-trace-token` is what
  `tracesApi.get` has always sent; the console now hands the token to the trace page in router
  *state* rather than the UI's own URL, for the same reason (browser history, `Referer`, pasted
  links). `/traces/:id?token=` is still read for old links.
- **Trace `mode` is open:** `sync` | `async` | `kafka` (1.4 — no `channel_id`, no `input_json`)
  | `cron` (1.6). `TRACE_MODES` drives the filter.
- **Audit vocabulary** gained `resource_type: plugin` and `cron_occurrence`, and actions
  `trigger` (channel) and `retry` (cron_occurrence). Status changes are named for the status
  requested (`status_active`, `status_archived`); there is no `activate` action.
- **`response.cookies` (1.5)** is its own switch — a shaped channel's workflow may then set
  cookies declaratively through `data._orion.response.cookies`. A response that sets a cookie is
  never stored in the response cache. `cache.key_logic` is the general form of
  `cache_key_fields` and takes precedence.
- **Integrity failures (1.5):** `errors[].code` may be `integrity_unique` / `integrity_foreign_key`
  (a run that does not catch one answers 409) or `integrity_not_null` / `integrity_check` (400).
- **`orion_messages_total{status}` counts a run that finished with task errors as `error` on every
  transport since 1.4** (the sync route used to count it `ok`).
- **Envelope:** every admin 2xx body puts its payload under `data`. List endpoints add
  `limit`/`offset` alongside, and `total` where the endpoint computes it. `unwrap()` in
  `client.ts` is the helper; `/health` is not an admin route and is *not* wrapped.
- **Workflow `tasks` is a tree, not a list.** An element carrying its own `tasks` key is a
  **task group** (the engine's own test — presence of the key, nothing else); one carrying
  `function` is a task. Any step may set `terminal: true`. Groups nest 8 deep and group ids share
  the task id namespace. Anything asking "what does this workflow run / reference / cost" must
  descend — use `flattenSteps`/`countLeafSteps` from `lib/workflow-steps.ts`, never
  `tasks.length`. `"tasks": []` is a 400 at create since 1.2.
- **Three identifier spaces, and `channel_call` uses the third.** `channel.channel_id` is a
  **UUID**; `channel.name` is the slug; `workflow.workflow_id` is a slug equal to the channel's
  `workflow_id`, while `workflow.name` is a human title ("Auth - login"). A `channel_call` task's
  `input.channel` names the channel **by `name`**, and `orion_messages_total{channel}` is labelled
  the same way. Resolve a call target through `channelsByName` — `channelsById` is UUID-keyed and
  misses every time, which is how the relationship graphs used to render every callee as a dashed
  "missing" node and stop the walk one hop in.
- **`orion_messages_total` counts ingress, not execution.** A channel reached only by
  `channel_call` — every `internal-*` route in a fan-out design — is dispatched inside the engine
  and gets **no series at all**, in that family or in `orion_workflow_duration_seconds`. So the
  busiest dependency in a system reads as permanently idle unless load is inferred from its
  callers (`deriveLoad` in `lib/traffic-encoding.ts`). Nothing attributes an arrival to a
  particular caller either, so per-edge volume is an upper bound, never a measurement.
- **`status` on `orion_messages_total` gained `unauthorized` in 1.2**, beyond the documented
  `ok` | `error` | `timeout` | `duplicate`. It is refused at the edge and never runs a workflow,
  so counting it as an error reports a correctly-guarded channel as broken, while folding it into
  "ok" hides a channel serving nothing but 401s. `use-metrics.ts` keeps it out of both.
- **The function catalogue is two lists in one.** `GET admin/functions` serves all 26 valid names.
  `source: "orion"` rows carry `input_fields` and are input-schema validated at create;
  `source: "engine"` rows (dataflow-rs built-ins — `map`, `filter`, `log`, `parse_json`, …) **omit**
  `input_fields` entirely. Never index it without a guard. `validation` carries `validate` in
  `aliases` rather than appearing twice. The field shape is **not in the OpenAPI spec** (hand-typed
  from a live server): each field carries `kind`, `required`, `resolvable` (folds `{"var": …}`),
  `alias`, and since 1.3 `secret_at` — the paths inside the field that take `{"secret": "name"}`
  (`[""]` = the value itself, `["[].key"]` = each element's `key`). Those are also the only places an
  `env://` / `vault://` string resolves; anywhere else it is refused as `UNRESOLVED_SECRET_REF`.
- **`[vars]` and `[secrets]` (1.3) have no admin endpoint.** Both are server config. A var is
  stamped into every message's `metadata.vars` at ingress (HTTP, Kafka *and* the workflow test
  endpoint) and is recorded in traces on purpose; `channel`, `cookies` and `vars` are
  platform-owned metadata keys a caller cannot supply. A secret is held by the engine, read as
  `{"secret": "name"}` in the five `secret_at` fields, and never appears in a trace or response.
  Misusing one quarantines the channel — `health.channels.quarantined` is `[{ channel, reason }]`,
  objects, not names.
- **Errors:** non-2xx bodies are `{ error: { code, message, details?, request_id? } }`.
  `client.ts` parses all four onto `ApiError`. `details[]` entries are
  `{ path, code, message, expected?, got? }` — `UNKNOWN_FIELD` is how a retired key spelling
  reports itself. Codes: `VALIDATION_ERROR` (not `BAD_REQUEST`), `CONFLICT` (409 on duplicate
  create), `NOT_FOUND` (404 on update with no draft), `CIRCUIT_OPEN` (503).
- **Traces live on the admin plane:** `GET admin/traces` and `admin/traces/{id}`. The old
  `data/traces` paths now resolve as a *channel name* and 404. The single-trace GET also accepts
  the `trace_token` from an async 202 (`x-trace-token` header or `?token=`).
- **Trace list is the one pagination deviation:** `total` only with `?include_total=true`, plus an
  opaque `cursor`/`next_cursor` keyset mode. `cursor` + `offset` together is a 400, as is `cursor`
  with any `sort_by` other than `created_at`. Note `buildQuery` serializes `offset: 0`, so cursor
  mode must pass `offset: undefined` explicitly.
- **Trace list rows are payload-free:** no `task_trace_json`, `input_json` or `result_json` — fetch
  a single trace for those. This is why `use-trace-analytics.ts` aggregates at row level only.
- **Channel `config` sub-fields:** `auth`, `rate_limit` (`requests_per_second`, `burst`,
  `key_logic`, `key_headers`, `on_backend_error`), `backpressure.max_concurrent_per_node`,
  `deduplication` (`header`, `window_secs`, `connector`, `on_backend_error`), `cache`,
  `origin_allow_list` (flat `string[]` — **not** the pre-1.0 `cors` object), `request`, `response`
  (incl. status-keyed `error_bodies`), `validation_logic`, `tracing`. **Unknown keys are refused**,
  so a stale spelling is a 400, not a no-op.
- **Channel auth secrets** (`auth.keys`, `auth.secret`/`secrets`, `auth.jwt_keys[].key`) come back
  masked as `"******"`. Sending a mask back on update *restores* the stored value — forms must
  round-trip masks untouched.
- **Connectors carry both** `config` (parsed, the shape POST/PUT accept) and `config_json` (the
  same document as a string). **Prefer `config`.** The list endpoint additionally returns
  `load_status` / `load_error` / `load_error_stage`.
- **Every entity carries `tags` and `content_hash`** (`sha256:…` over the canonical importable
  content, DB-owned fields excluded). Equal hashes mean importing one over the other is a no-op.
- **Bulk import:** `POST {channels|connectors|workflows}/import?dry_run=&on_conflict=` returns
  `{ dry_run, imported, failed, unchanged, skipped, errors[], results[] }` — dry runs report in the
  *same* fields as real runs. `on_conflict` is `fail` | `skip` | `new_version`. Max 1000 items.
- **Status changes** take `?dry_run=true` (answers the `/validate` envelope instead of the entity —
  used by the activation pre-flight in `LifecycleActions`) and `?reload=now|defer`.
- **Channel activation requires an active workflow.**
- **Audit logs filter server-side:** `action`, `resource_type`, `resource_id`, `principal`,
  `start_time`, `end_time`. No `sort_by`; `limit` clamped 1–1000.
- **Circuit breakers:** `GET admin/connectors/circuit-breakers` returns
  `{ enabled, scope, instance_id, breakers }`. State is **per-replica**, never cluster-wide.
  There is no connectors-reload endpoint; the "reload" affordance calls `admin/engine/reload`.
- **Connector probe:** `POST admin/connectors/{id}/test` — an unreachable backend is still a 200.
  Key "broken" on `supported && !reachable`: `es`, `kafka` and MongoDB-backed `db` return
  `supported: false`. The `http` probe issues one *genuine* request with real credentials.
- **Backups:** `POST`/`GET admin/backups`. SQLite only (400 otherwise). **No restore endpoint.**
- **Profiling:** sync data requests with `X-Orion-Profile: 1` return `_orion.profile`.
- **`errors[]` in a 200:** `code` names the real failure (`IO_ERROR`, `TIMEOUT_ERROR`,
  `FUNCTION_ERROR`, the connector's lower-case `circuit_open`), with `TASK_ERROR` only as a
  fallback. A 200 does not mean the workflow succeeded.
- **REST channels:** sync channels with a `route_pattern` are invoked by method + concrete path via
  the data-plane catch-all (`api.send()`); routes match byte-exactly. GET/HEAD send no body.
- **Async submissions** answer 202 `{ trace_id, trace_token }`.
- **Metrics carry the `orion_` prefix and every `*_seconds` family is a histogram.** The whole set
  was renamed in 1.0, and `metrics.rs` sets explicit `LATENCY_BUCKETS` on the `_seconds` suffix
  *deliberately* — without them the exporter renders a histogram as a summary with per-replica
  quantiles that cannot be aggregated across a cluster. So there is no `quantile` label to read:
  latency comes from `_bucket`/`_sum`/`_count` via `histogramQuantile()`/`histogramMean()` in
  `api/metrics.ts`. `orion_messages_total{status}` is `ok` | `error` | `timeout` | `duplicate`; a
  duplicate was suppressed by the dedup guard, never processed, so it is kept out of the error-rate
  denominator.
- **Per-workflow cost (1.2):** `orion_workflow_duration_seconds{workflow}` measures a whole run and
  `orion_task_duration_seconds{workflow,task,function}` its task bodies, so the difference is the
  engine's own overhead (condition evaluation, group gating, loop bookkeeping, audit writes). A
  workflow its condition or rollout gate rejected is not recorded; a looping workflow records once.

### Layers

- **`src/api/`** — Typed API client. `client.ts` wraps fetch with the `/api/v1` base path, parses the structured error envelope onto `ApiError` (incl. `details[]` and `requestId`), and exports `buildQuery()`, `unwrap()`, and `api.send()` for arbitrary-method data-plane calls. `RequestOptions.changeContext` sends `X-Orion-Change-Context` so a multi-request promotion's audit rows can be grouped. Domain modules: `channels.ts`, `workflows.ts`, `connectors.ts`, `traces.ts`, `trace-dlq.ts`, `packages.ts`, `engine.ts`, `audit.ts`, `backup.ts`, `functions.ts`, `data.ts`. All types hand-written in `types.ts`.
- **`src/hooks/`** — TanStack Query wrappers. One hook file per domain (`use-channels.ts`, `use-workflows.ts`, etc.). Query keys are `["entity", params]` arrays. Mutations invalidate via `queryClient.invalidateQueries`. The client default is `staleTime: 30_000` (a page visited twice in a row does not refetch its lists; polled queries keep their own `refetchInterval`, and invalidation ignores staleness), and every paginated list hook sets `placeholderData: keepPreviousData` so a page turn holds the last page instead of dropping to a skeleton.
- **`src/pages/`** — Route-level components. Named exports like `ChannelsPage`, `WorkflowDetailPage`. Data fetching via hooks, not inline.
- **`src/components/ui/`** — Shadcn-style primitives using `React.forwardRef`, CVA variants, and
  `cn()` for class merging: `Button`, `Card`, `Badge`, `Table`, `Tabs`, `Dialog`, `Input`,
  `Textarea`, `Select`, `Label`, `Checkbox`, `Switch`, `Slider`, `Callout`, `Separator`,
  `Skeleton`, `Sparkline`. `field.ts` holds the border/focus/invalid chrome shared by
  Input/Textarea/Select — change it there, not per field. `Select` renders a wrapper div so it can
  overlay a themed chevron: `className` sizes the *control* (as callers already expected),
  `selectClassName` reaches the `<select>` itself.
- **`src/components/shared/`** — Shared composed components: `StatusBadge`, `LifecycleActions` (incl. the activation pre-flight), `VersionHistory`, `JsonViewer`, `PageHeader`, `ConfirmDialog`, `PaginationFooter`, `ValidationResults`, `ImportDialog`/`ImportSummary`, `ChannelAuthEditor`, `ConnectorTestDialog`, `WorkflowDependencies`, `FilterBar`, `EmptyState`, `ErrorState` (the one
  way a page reports a failed load — reads status, code, field details and request id off
  `ApiError`, with Retry) and `ErrorBoundary`.
- **`src/components/layout/`** — `AppLayout`, `Sidebar`, `Header`. `AppLayout` owns the two
  sidebar states: folded to an icon rail (the control at the sidebar's foot, remembered in
  `localStorage["orion-sidebar"]`) and, below `md`, a drawer behind the header's menu button
  that closes on navigation, Escape or the backdrop.
- **`src/lib/utils.ts`** — `cn()` (clsx + tailwind-merge), `formatDate()` (absolute, in the
  chosen zone, with a zone marker), `formatWhen()` (relative under a day, absolute beyond — the
  list-cell rendering), `formatInstant()` (the ISO instant), `formatDuration()`, `formatRelative()` ("12s ago" / "in 40m"; pair it with the
  absolute `formatDate()` in a `title`), `toRfc3339()` (a `datetime-local` value to the server's
  form, through the zone preference), `parseJson()` (safe parse; returns the *raw string* on failure, not null), `downloadJson()` (the shared export blob helper), and `parseServerDate()` / `serverTime()`: **the admin plane serialises `chrono::NaiveDateTime` — `2026-09-05T12:13:55`, no zone — and every such value is UTC.** `new Date()` reads a zoneless string as local time, so go through these for anything time-based; `formatDate` already does.
- **`src/lib/use-pagination.ts`** — `usePagination()` + `PAGE_SIZE`, paired with `PaginationFooter`. Lives in `lib/` because the fast-refresh lint rule forbids non-component exports from component files.
- **`src/lib/time-zone.ts`** + `time-zone-provider.tsx` / `use-time-zone.ts` — the display
  zone (`local` | `utc`, `localStorage["orion-timezone"]`), chosen on Engine → Display (the card
  also holds theme, incl. "Follow the system", and density). A module variable is what
  `formatDate` reads, so non-React code sees the same value; the provider is what re-renders on
  a change. Every absolute time in the app goes through `formatDate`, which is how one
  preference reaches every page.
- **`src/lib/editor-types.ts`** + `shared/json-editor.tsx` / `json-editor-view.tsx` — the JSON
  editor (CodeMirror 6). `json-editor.tsx` is a `lazy` wrapper and the only import a page should
  use; the CodeMirror runtime lives in `json-editor-view.tsx` and its own `codemirror` chunk,
  fetched the first time an editor mounts. A lint or completion source is *handed* the parse
  tree (`LintContext`, `CompletionRequest`) rather than importing CodeMirror — an import from
  `@codemirror/*` outside the view module undoes the split. `lib/json-path.ts` maps a
  `lintSteps` path (`tasks[1].function.name`) to a range in the document; `lib/workflow-completions.ts`
  is the catalogue-backed source (function names inside `function.name`, that function's
  `input_fields` inside `input`, the keys a step takes, the `halt_on` spellings) and handles a
  string still being typed (an error node to the parser, not a `String`). `onRun` binds
  Mod-Enter above the default keymap (which would insert a blank line): the console sends on it
  and the workflow dry run runs on it.
- **`src/lib/onboarding.ts`** + `shared/getting-started.tsx` — the first-run checklist the
  dashboard leads with while the engine serves no channel (`isFirstRun`, `firstRunSteps`, five
  steps ticking from the live counts); dismissed per browser
  (`localStorage["orion-getting-started-dismissed"]`).
- **`src/lib/use-now.ts`** — `useNow(intervalMs)`: the current time as ticking state, for "ago"
  labels and age windows. `Date.now()` in render trips the `react-hooks/purity` lint.
- **`src/lib/nav.ts`** — the page registry (sections, icons, keywords, `g`+key shortcuts, which
  live count sits beside an item) and `navItemFor(pathname)`.
- **`src/lib/page-title.ts`** — `setPageTitle` / `setFallbackTitle`: the tab title, with the page
  winning over the shell (a child's effect runs before its parent's, so the shell yields).
- **`src/lib/faults.ts`** + **`src/hooks/use-faults.ts`** — the map's fault overlay: quarantined
  channels and failed connectors from `/health`, open breakers from this node's map, keyed by
  channel and connector name; `faultsFor(node)` is what a node draws.
- **`src/hooks/use-attention.ts`** — `useAttentionItems(windowSec)`: "Needs attention" as data
  (severity-ordered, each with the page to act on), shared by the dashboard and the sidebar's
  Operations count so the two cannot disagree; `useNavCounts()` adds DLQ, breaker and cron
  backlog counts. Failing channels are judged over the traffic window once a second sample
  exists, cumulative before that.
- **`src/lib/use-unsaved-changes.ts`** + `shared/unsaved-changes-dialog.tsx` — the form guard.
  `useBlocker` reads refs at navigation time so a save that navigates away is not blocked; the
  save handler calls `markSaved()` first.
- **`src/lib/use-url-filters.ts`** — `useUrlFilters(keys)`: list filters and sort as URL search
  params. `values` read as strings (empty when absent); `set(patch)` replaces the history entry
  and changes several keys in one navigation — two calls in a row each start from the last
  render's params and the second undoes the first. `nextSort` cycles unsorted → asc → desc →
  unsorted, and `shared/sortable-head.tsx` is the header cell that drives it with `aria-sort`.
  Channels, Workflows, Connectors, Plugins, Audit and the DLQ keep their filters this way; the
  sort fields are the server's own `sort_by` values (channels: `priority`, `name`, `status`,
  `channel_type`, `protocol`, `created_at`, `updated_at`; workflows drop the type columns;
  plugins take `plugin_id`; connectors `name`, `connector_type`, `created_at`, `updated_at`).
- **`src/lib/table.ts`** — `listTableFeatures`, plus `activatableRow(onOpen)` / `ROW_ACTIVATABLE`:
  a row that opens something takes focus and Enter or Space opens it (a `<tr onClick>` alone is
  invisible to the keyboard); the handler ignores keys that started on a link or button inside.
- **`src/lib/toast-error.tsx`** — `toastError(title, e)`: the one way a mutation reports failure.
  Shows `ApiError.details[]` and the request id, with a "Copy request id" action. Every hook's
  `onError` goes through it.
- **`src/lib/retry-safety.ts`** + `hooks/use-retry-safety.ts` + `shared/retry-safety-warning.tsx` —
  the guard in front of a DLQ requeue and a cron occurrence retry: `retryRisks(steps, catalogue)`
  names the tasks whose function is `unsafe_write` or `depends_on` its input. It reads the
  workflow's *current* definition, because that is what a retry runs. Rendered in the DLQ entry
  and bulk dialogs, on an occurrence page and on a cron channel's occurrences tab.
- **`src/lib/trace-payload.ts`** — `extractSteps` and `firstTaskPayload`: the request as the first
  task saw it, the closest thing to the original input a trace keeps (the read carries no raw
  request). "Re-send in console", the console's "Last trace's input" and the dry run's "Use last
  trace's input" all read it.
- **`src/lib/motion.ts`** — `useReducedMotion()`: for motion started from script (the map's
  animated edges, its viewport travel). CSS animation is stopped by the global
  `prefers-reduced-motion` rule at the end of `index.css`.
- **`src/components/shared/`** also holds `Breadcrumbs`, `TagsInput` (chips; Enter, comma, paste
  and Backspace), `FormError` (a failed Save with `ApiError.details[]`), `ChannelTrafficCard` /
  `ChannelRecentTraces` (a channel's own window on its page) and `ConnectorField` in
  `config-field.tsx` (a connector chosen from the registry, a stray stored value still shown).
- **`src/lib/topology.ts`** — the entity index (`buildIndex`) and reference extraction
  (`channelCallTargets`, connector refs) that `system-graph.ts` builds on. The per-entity graph
  on a detail page is `components/graph/neighbourhood-map.tsx`: a one-hop projection of the
  System Map — same canvas, same encodings, live traffic and faults — which replaced the old
  `RelationshipGraph` and its second visual language on 2026-09-05. For a single workflow prefer
  `workflowsApi.dependencies()`, which is the server's own answer and also reports dynamic
  `channel_call` targets. Call targets resolve through `channelsByName` — see the identifier
  note above.
- **`src/lib/system-graph.ts`** — the *whole* system as one graph, for the System Map:
  `buildSystemGraph` (one node per channel with its workflow folded in, edges from `channel_call`,
  plus fan-in/fan-out, tier and connector fan-in) and `neighbourhood` (bidirectional blast
  radius). Channels are keyed by **name**, because that is what calls and metrics both use.
  Connectors are deliberately not nodes: one used by 51 of 62 workflows adds an edge everywhere
  and distinguishes nothing, so they ride the referencing node and render as a rail.
- **`src/hooks/use-metrics.ts`** — `useChannelTraffic(windowSec)` is the windowed view every
  page shares (`TRAFFIC_WINDOWS`, default 5 min, bounded by the 60-sample ring buffer): per
  channel ok / failed / rejected / duplicate, `byStatus`, a windowed p95 from **bucket deltas**
  (`deltaSnapshot(base, cur)` is a valid histogram because counters are monotonic), plus totals
  (`errorPct`, `p95Ms`, `meanMs`) and per-poll `series` / `seriesFor(channel)` for sparklines.
  `useMetrics()` keeps the cumulative figures (workflow cost, the fallback before a second
  sample).
- **`src/lib/traffic-encoding.ts`** — how telemetry becomes shape and colour: health thresholds,
  the sqrt dot scale (a dot reads as an *area*), and `deriveLoad`, which propagates load in tier
  order to the channels the exporter cannot see. A `HealthLevel` is a colour *slot* — `idle` /
  `healthy` / `notice` / `warning` / `critical` — and what it means depends on the colour metric:
  `legendFor(colorMetric)` names the slots (`notice` is "rejected" in health mode, "100–500 ms"
  in latency mode, "draft" in lifecycle mode). `errorLevel` is the error-share banding the
  dashboard KPI shares with the map.
- **`src/lib/map-layout.ts`** — the map's layout: one lane per call tier, with **every** channel
  nothing calls in the entry lane whether or not it calls anything itself (an entry channel that
  makes no calls is reached over its route — it is not an orphan, and the old ELK-plus-leftover-grid
  layout that banded such channels as "not reached by any call" was wrong about that). Entries
  sharing one dependency set (3+) are drawn as a **cluster** box with a single edge per callee, so
  eighteen routes that all call `internal-session-check` are one line, not eighteen; the call-less
  entries are just another cluster ("no calls out"). Barycenter ordering keeps a hub among its
  callers. A cluster can be `collapsed` (`LayoutOptions.isCollapsed`): it lays out as one
  summary box and its members take the box's position, so React Flow animates them in and out.
  Pure, synchronous, no dependency.
- **`src/components/graph/traffic-map.tsx`** — the canvas. Level of detail follows
  `useViewport().zoom` (`LOD_ZOOM`): a dot and a large name below it, the full card above.
  Clusters are nodes (`ClusterNode`): a click toggles collapse, a map of `COLLAPSE_MAP_AT`+
  channels starts with clusters of `COLLAPSE_CLUSTER_AT`+ collapsed, and the cluster holding the
  selected channel is always open. `hops` bounds the blast radius
  (`neighbourhood(graph, id, hops)`; the page reads `?hops=`, the detail pages' neighbourhood
  map is fixed at one); the MiniMap appears past 15 nodes. The compact/expanded hysteresis is a
  module-level set (`expandedEver`) because the compiler lint refuses `setState` in an effect.
- **`src/lib/workflow-steps.ts`** — Reading a workflow's step tree: `isTaskGroup`, `groupMembers`,
  `flattenSteps`, `countLeafSteps`, `countGroups`, `countTerminal`, `groupDepth`, plus `lintSteps`
  (client-side shape check reporting at the coordinate the author typed). Mirrors the server's
  `engine/steps.rs`; re-implemented rather than imported from `dataflow-ui` so the API layer does
  not depend on the visualizer package.
- **`src/lib/workflow-mapper.ts`** — Maps API `Workflow` (has `workflow_id`) to
  `@goplasmatic/dataflow-ui` `Workflow` type (has `id`). Walks the step tree rather than casting:
  the visualizer requires `function.input`, which the API type leaves optional. Passes `halt_on`
  through so the 3.12 visualizer draws it.
- **`src/lib/cron.ts`** — Reading a cron channel: `isCronChannel`, `cronTransport` (the one
  reader of `transport_config` as a schedule), `CRON_REFUSED_CONFIG_KEYS` +
  `stripCronRefusedConfig` (what a protocol switch must drop), `lintCronExpression` (six fields,
  while typing — Validate is the authority), `isRetryable`, the policy option lists and status
  labels.
- **`src/lib/health.ts`** — `componentRoute`: which page acts on a degraded `/health` component.
- **`src/api/plugins.ts`, `src/api/cron.ts`** — the 1.6 entity and the ledger;
  `channelsApi.trigger` is the manual cron run. Hooks in `use-plugins.ts` / `use-cron.ts`; a
  plugin status change invalidates `["functions"]` and `["workflows"]` because the vocabulary
  moved. `use-metrics.ts` also exposes `useCronMetrics` (pending gauge, lag p95, occurrences by
  status, lease failures) and `usePluginMetrics` (per-function invocations, errors, p95), both
  reading the shared `["metrics"]` poll.

### Routing

React Router v7 in `src/app.tsx`. All routes nest under `AppLayout` (sidebar + header + `<Outlet />`).

```
/                   -> OperationsPage
/system-map         -> SystemMapPage (view state in the URL: ?select=<channel name>&q=&tag=
                                      &lifecycle=all&window=&size=&colour=&hops=1|2|all)
/channels           -> ChannelsPage
/channels/new       -> ChannelFormPage (create; ?protocol=cron preselects a schedule)
/channels/:id       -> ChannelDetailPage
/channels/:id/edit  -> ChannelFormPage (edit; draft only)
/workflows          -> WorkflowsPage
/workflows/new      -> WorkflowFormPage (create)
/workflows/:id      -> WorkflowDetailPage
/workflows/:id/edit -> WorkflowFormPage (edit; draft only)
/plugins            -> PluginsPage
/plugins/new        -> PluginFormPage (upload)
/plugins/:id        -> PluginDetailPage
/plugins/:id/edit   -> PluginFormPage (edit; draft only)
/connectors         -> ConnectorsPage
/connectors/new     -> ConnectorFormPage (create)
/connectors/:id     -> ConnectorDetailPage (?test=1 opens the probe dialog)
/connectors/:id/edit-> ConnectorFormPage (edit)
/traces             -> TracesPage (?channel= and ?status= pre-filter)
/traces/:id         -> TraceDetailPage (accepts ?token= for async trace polling)
/trace-dlq          -> TraceDlqPage
/schedules          -> SchedulesPage (accepts ?channel_id= to pre-filter the ledger)
/schedules/occurrences/:id -> OccurrenceDetailPage
/circuit-breakers   -> CircuitBreakersPage (?key=channel:connector highlights that row)
/audit              -> AuditPage
/console            -> ConsolePage (?channel=<name> preselects it and seeds its REST route)
/packages           -> PackagesPage (read-only)
/engine             -> EnginePage (#component-<name> scrolls the health report to that row;
                                   the Display card: theme, time zone, density)
/settings           -> redirect to /engine, keeping search and hash (the page's name until 2026-09-05)
*                   -> NotFoundPage
```

The router is a **data router** (`createBrowserRouter` + `RouterProvider`), because the
unsaved-changes guard on every form is `useBlocker`, which only exists there. `AppLayout` wraps
the `<Outlet />` in an `ErrorBoundary` keyed on the path, so a page that throws renders
`ErrorState` instead of blanking the console; it also sets the fallback tab title from the nav
registry and runs the `g` + key shortcuts.

A new page needs two registrations: a route in `src/app.tsx` and an entry in `src/lib/nav.ts`,
which feeds the sidebar (grouped Build / Observe / Govern, with live counts from
`useNavCounts`), the palette's "Go to" group, the `g` + key shortcuts and the fallback tab
title. A list page names the tab through `PageHeader`; a detail page through `Breadcrumbs`
(`lib/page-title.ts` lets the page win over the shell).

Forms (`channel-form.tsx`, `connector-form.tsx`, `workflow-form.tsx`, `plugin-form.tsx`) use a wrapper page that waits for the edit query, then mounts an inner form seeded via `useState` initializers (keyed to remount on data load) — avoid `setState`-in-`useEffect` for form hydration. Each has a `buildPayload()` shared by Save and Validate, so Validate checks exactly what Save would send. Every form: ids are picked, not typed (the workflow `Select` grouped by status; `ConnectorField` for cache and dedup connectors; HTTP methods as a checkbox group), tags are a `TagsInput`, a failed Save renders `FormError` with the server's `details[]`, and a JSON snapshot of the fields drives `useUnsavedChanges` — `markSaved()` before the post-save `navigate`. JSON is authored in the `JsonEditor`, never a `Textarea`: the workflow's steps (with the form's `lint` mapping `lintSteps` findings to ranges, catalogue completion, and the detail page's diagram redrawn below from the last document that passed the lint), the condition's JSON mode, and every config editor's Advanced view, the console's payload and the workflow dry run's payload (both run on ⌘ Enter through `onRun`).

### API Proxy

Dev server proxies `/api`, `/health`, `/healthz`, `/readyz`, `/metrics` to `process.env.ORION_URL` (default `http://localhost:8080`). The API client prepends `/api/v1` to all paths.

### Visualization Libraries

- **`@goplasmatic/dataflow-ui`** — `WorkflowVisualizer` renders workflow task pipelines with tree/flow/graph views and optional debug tracing. CSS imported in `main.tsx`.
- **`@goplasmatic/datalogic-ui`** — `DataLogicEditor` renders JSONLogic expressions as interactive flow diagrams. Read-only (`editable={false}`) in viewers; editable with `onChange` in the workflow form's condition editor and the channel config's validation / key-logic / JWT authorization-logic fields (via the shared `LogicField` in `config-field.tsx`). CSS imported in `main.tsx`.
- **CodeMirror 6** (`codemirror`, `@codemirror/*`, `@lezer/*`) — the JSON editor behind
  `shared/json-editor.tsx`; see `lib/editor-types.ts`. Themed through the CSS variables in
  `json-editor-view.tsx` (never a bundled theme), split into its own chunk by `vite.config.ts`.

### Pagination

Server-side offset/limit pagination via `usePagination()` + `PaginationFooter`. `PaginatedResponse<T>` is `{ data, total?, limit, offset }` — **`total` is optional**, because the trace list omits it unless asked with `?include_total=true`. Treat an absent total as "unknown", never zero; the footer falls back to a row-count range and infers "has next" from a full page.

## Conventions

- **Imports:** Always use `@/` path alias (maps to `src/`).
- **File names:** kebab-case (`use-workflows.ts`, `app-layout.tsx`). Exports are PascalCase for components, camelCase for functions/objects.
- **Styling:** Tailwind utility classes only. Use `cn()` for conditional/merged classes. Theme
  tokens are CSS variables in `src/index.css` (hex + `rgba`, mapped into Tailwind via
  `@theme inline`). Never hardcode a colour — no `text-[#4CBD97]`, no `bg-slate-800`.
- **Component variants:** Use `class-variance-authority` (CVA) with `VariantProps` typing. Keep
  `xVariants` unexported — a non-component export from a component file trips the
  `react-refresh/only-export-components` lint rule.
- **Semantic vs chart colour:** `--success` / `--warning` / `--info` / `--destructive` are *ink*
  tokens, carrying a per-theme value that is readable as text (the brand green `#4CBD97` and amber
  `#FFD167` are ~2:1 on white and must never be text in light mode). `--chart-1…5` are data-viz
  fills, brand-exact and identical across themes. Use semantic tokens for anything with a label;
  use chart tokens only for chart geometry. `statusChartColor()` in `lib/status.ts` returns the
  concrete hex recharts needs, since CSS variables do not resolve in SVG fills.
- **Elevation:** four steps (`shadow-xs` → `shadow-lg`), theme-aware — light casts a soft ink
  shadow, dark a deeper near-black one. Cards carry `shadow-xs` by default; pass `interactive` to a
  `Card` that navigates for hover elevation.
- **Inline status banners:** use `Callout` (`variant` = info | success | warning | destructive |
  muted) rather than re-deriving `rounded-md border border-X/40 bg-X/10 … text-X`.
- **Form captions:** use `Label`, never a bare `<label>`, so weight/spacing and the `required`
  marker stay consistent. Wrapping labels around a control (checkbox rows) stay plain `<label>`.
- **List filters:** wrap the filter row in `FilterBar` and size each control with `FILTER_W`. A bare
  `Select` is `w-full`; without a width two dropdowns stretch across the whole page.
- **Focus rings:** `focus-visible:ring-2 focus-visible:ring-ring/60` plus an offset in the
  surrounding surface colour. A 1px ring is invisible against a filled control.
- **Icons:** `lucide-react` exclusively.
- **Tables:** `@tanstack/react-table` with `createColumnHelper<T>()`, server-side sorting via query
  params. Filters and sort live in the URL through `useUrlFilters`; sortable headers are
  `SortableHead`; a clickable row spreads `activatableRow(...)` so the keyboard can open it; a
  loading table draws `PAGE_SIZE` skeleton rows so the layout does not jump when data lands.
  Columns that need live data (a quarantine set, a breaker map, this node's plugin loads) are
  built by a `buildColumns(...)` factory inside a `useMemo`, not a module constant.
- **No index files:** Import directly from the file (`@/components/ui/button`, not `@/components/ui`).
- **Entity status:** Use `StatusBadge` from `@/components/shared/status-badge` for draft/active/archived display.
- **Lifecycle operations:** Use `LifecycleActions` from `@/components/shared/lifecycle-actions` for activate/archive/delete/new-version buttons, passing `onPreflight`/`preflight` to surface the `?dry_run=true` activation check.
- **Status colours:** add new status/state strings to `src/lib/status.ts` rather than inlining — every map there falls back to neutral, so an unmapped value degrades silently to grey.
- **Untoasted mutations:** validate/test/dry-run hooks are bare `useMutation({ mutationFn })` with no toast or invalidation — their results render inline, and a "failure" (invalid config, unreachable backend) is information rather than an error.
- **Failed mutations:** `toastError(title, e)` from `lib/toast-error.tsx`, never `toast.error`
  with `e.message` — the field findings and the request id are the part a person acts on. A
  batch (requeue every entry shown, reset every open breaker) is one request per item under
  `Promise.allSettled`, reported as "n done, m refused".
- **Load failures:** a page that cannot load its entity renders `ErrorState` (with `refetch` as
  `onRetry` and a `backTo`), never a bare "Failed to load" line.
- **Times:** `formatWhen()` for list cells (relative under a day, absolute beyond) and
  `formatRelative()` for anything a person watches live (trace and audit lists, the dashboard),
  both with the absolute `formatDate()` in the element's `title`. Every absolute time goes
  through `formatDate` — `toLocaleString` by hand bypasses the zone preference.
- **Per-browser preferences** live in `localStorage`, never the server: `orion-timezone`,
  `orion-sidebar`, `orion-getting-started-dismissed`, the theme and density keys, the
  console's history and headers, the palette's recents (`orion-palette-recent`), a workflow's
  last dry-run payload (`orion-dryrun-<id>`) and whether its diagram is folded
  (`orion-workflow-diagram`). A page must render correctly when the key is absent or the
  accessor throws (private mode).
- **Links between pages carry state in the URL:** every list page's filters and sort
  (`?status=&tag=&sort=&order=` and their kin on Channels, Workflows, Connectors, Plugins;
  `?action=&resource_type=&resource_id=&principal=&start=&end=` on Audit; `?channel=&exhausted=`
  on the DLQ), the console's `?channel=&method=&path=`,
  the map reads `?select=` (and every filter),
  the dashboard and the map `?window=`, the console `?channel=`, the breakers page `?key=`,
  traces `?channel=&status=`, the connector page `?test=1`. A link that lands on an unfiltered
  list and asks the operator to find the thing again is a bug. Router *state* carries what must
  not be in a URL: an async trace token, a payload handed to the console, the trace list's page
  of ids (for newer / older on the detail).
- **The console remembers in this browser only:** request history and per-channel headers live in
  `localStorage` (`orion-console-history`, `orion-console-headers`); a guarded channel's credential
  goes in the headers table, and the form warns when the channel's `auth` header is missing.
