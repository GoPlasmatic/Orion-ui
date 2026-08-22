# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run dev          # Start Vite dev server (proxies /api, /health, /healthz, /readyz, /metrics to ORION_URL)
npm run build        # TypeScript check + Vite production build
npm run lint         # ESLint
npm run preview      # Preview production build locally

npm test             # Vitest unit tests, incl. the API ↔ OpenAPI contract test
npm run test:e2e     # Playwright smoke flow (needs a live orion-server on :8080; skips locally if absent)
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

Orion UI is a React 19 dashboard for the Orion workflow engine. It uses Vite 7, TypeScript (strict), Tailwind CSS v4, and TanStack Query/Table.

### Core Domain

Targets the Orion **v1.1** API (dataflow-rs 3.5 / datalogic-rs 5.2). Three primitives with
Draft -> Active -> Archived lifecycle, plus two read-only operator surfaces:

- **Channels** — Service endpoints (sync/async, REST/HTTP/Kafka). Config covers `auth`
  (`api_key` | `hmac` | `jwt`), rate limits (incl. `key_logic` + `key_headers`), backpressure,
  dedup, caching, `origin_allow_list`, `request`, `response`, `validation_logic` and `tracing`;
  `transport_config` is a JSON editor shown for Kafka. Full CRUD (create/edit forms, server-side
  Validate, bulk import, export). `methods` is `string[] | null`.
- **Workflows** — Task pipelines with JSONLogic conditions. Full authoring via `workflow-form.tsx`
  (visual condition editor + tasks JSON + server-side Validate), plus import wizard, dry-run test,
  export, canary rollout (`PATCH /{id}/rollout`), and a **Dependencies** tab backed by
  `GET admin/workflows/{id}/dependencies`. Uses `@goplasmatic/dataflow-ui` `WorkflowVisualizer`
  and `@goplasmatic/datalogic-ui` `DataLogicEditor`.
- **Connectors** — External system connections: `http`, `kafka`, `db`, `cache`, `es`, `storage`,
  **`smtp`**. Full CRUD + Validate + **Test** (reachability probe) + export. Keyed by `id` (a UUID,
  distinct from `name`).
- **Functions** — Read-only reference page (`/functions`) rendering the server's per-function
  input-schema registry (`GET admin/functions`).
- **Trace DLQ** — Operator view of the async dead-letter queue (`/trace-dlq`): inspect, requeue,
  purge.
- **Packages** — Read-only promotion receipts (`/packages`). `PUT admin/packages/{name}` is
  deliberately **not** exposed; recording receipts is CI's job.

### v1.x wire contracts worth remembering

- **Envelope:** every admin 2xx body puts its payload under `data`. List endpoints add
  `limit`/`offset` alongside, and `total` where the endpoint computes it. `unwrap()` in
  `client.ts` is the helper; `/health` is not an admin route and is *not* wrapped.
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

### Layers

- **`src/api/`** — Typed API client. `client.ts` wraps fetch with the `/api/v1` base path, parses the structured error envelope onto `ApiError` (incl. `details[]` and `requestId`), and exports `buildQuery()`, `unwrap()`, and `api.send()` for arbitrary-method data-plane calls. `RequestOptions.changeContext` sends `X-Orion-Change-Context` so a multi-request promotion's audit rows can be grouped. Domain modules: `channels.ts`, `workflows.ts`, `connectors.ts`, `traces.ts`, `trace-dlq.ts`, `packages.ts`, `engine.ts`, `audit.ts`, `backup.ts`, `functions.ts`, `data.ts`. All types hand-written in `types.ts`.
- **`src/hooks/`** — TanStack Query wrappers. One hook file per domain (`use-channels.ts`, `use-workflows.ts`, etc.). Query keys are `["entity", params]` arrays. Mutations invalidate via `queryClient.invalidateQueries`.
- **`src/pages/`** — Route-level components. Named exports like `ChannelsPage`, `WorkflowDetailPage`. Data fetching via hooks, not inline.
- **`src/components/ui/`** — Shadcn-style primitives using `React.forwardRef`, CVA variants, and
  `cn()` for class merging: `Button`, `Card`, `Badge`, `Table`, `Tabs`, `Dialog`, `Input`,
  `Textarea`, `Select`, `Label`, `Checkbox`, `Switch`, `Slider`, `Callout`, `Separator`,
  `Skeleton`, `Sparkline`. `field.ts` holds the border/focus/invalid chrome shared by
  Input/Textarea/Select — change it there, not per field. `Select` renders a wrapper div so it can
  overlay a themed chevron: `className` sizes the *control* (as callers already expected),
  `selectClassName` reaches the `<select>` itself.
- **`src/components/shared/`** — Shared composed components: `StatusBadge`, `LifecycleActions` (incl. the activation pre-flight), `VersionHistory`, `JsonViewer`, `PageHeader`, `ConfirmDialog`, `PaginationFooter`, `ValidationResults`, `ImportDialog`/`ImportSummary`, `ChannelAuthEditor`, `ConnectorTestDialog`, `WorkflowDependencies`, `FilterBar`, `EmptyState`.
- **`src/components/layout/`** — `AppLayout`, `Sidebar`, `Header`.
- **`src/lib/utils.ts`** — `cn()` (clsx + tailwind-merge), `formatDate()`, `formatDuration()`, `parseJson()` (safe parse; returns the *raw string* on failure, not null), `downloadJson()` (the shared export blob helper).
- **`src/lib/use-pagination.ts`** — `usePagination()` + `PAGE_SIZE`, paired with `PaginationFooter`. Lives in `lib/` because the fast-refresh lint rule forbids non-component exports from component files.
- **`src/lib/topology.ts`** — client-side channel/workflow/connector graph inference for the *bulk* views (system map, reverse sweeps). For a single workflow prefer `workflowsApi.dependencies()`, which is the server's own answer and also reports dynamic `channel_call` targets.
- **`src/lib/workflow-mapper.ts`** — Maps API `Workflow` (has `workflow_id`) to `@goplasmatic/dataflow-ui` `Workflow` type (has `id`).

### Routing

React Router v7 in `src/app.tsx`. All routes nest under `AppLayout` (sidebar + header + `<Outlet />`).

```
/                   -> OperationsPage
/system-map         -> SystemMapPage
/channels           -> ChannelsPage
/channels/new       -> ChannelFormPage (create)
/channels/:id       -> ChannelDetailPage
/channels/:id/edit  -> ChannelFormPage (edit; draft only)
/workflows          -> WorkflowsPage
/workflows/new      -> WorkflowFormPage (create)
/workflows/:id      -> WorkflowDetailPage
/workflows/:id/edit -> WorkflowFormPage (edit; draft only)
/functions          -> FunctionsPage
/connectors         -> ConnectorsPage
/connectors/new     -> ConnectorFormPage (create)
/connectors/:id     -> ConnectorDetailPage
/connectors/:id/edit-> ConnectorFormPage (edit)
/traces             -> TracesPage
/traces/:id         -> TraceDetailPage (accepts ?token= for async trace polling)
/trace-dlq          -> TraceDlqPage
/circuit-breakers   -> CircuitBreakersPage
/audit              -> AuditPage
/console            -> ConsolePage
/packages           -> PackagesPage (read-only)
/settings           -> SettingsPage
```

A new page needs three registrations: a route in `src/app.tsx`, a nav item in `components/layout/sidebar.tsx`, and a `nav-*` entry in `components/shared/command-palette.tsx`.

Forms (`channel-form.tsx`, `connector-form.tsx`, `workflow-form.tsx`) use a wrapper page that waits for the edit query, then mounts an inner form seeded via `useState` initializers (keyed to remount on data load) — avoid `setState`-in-`useEffect` for form hydration. Each has a `buildPayload()` shared by Save and Validate, so Validate checks exactly what Save would send.

### API Proxy

Dev server proxies `/api`, `/health`, `/healthz`, `/readyz`, `/metrics` to `process.env.ORION_URL` (default `http://localhost:8080`). The API client prepends `/api/v1` to all paths.

### Visualization Libraries

- **`@goplasmatic/dataflow-ui`** — `WorkflowVisualizer` renders workflow task pipelines with tree/flow/graph views and optional debug tracing. CSS imported in `main.tsx`.
- **`@goplasmatic/datalogic-ui`** — `DataLogicEditor` renders JSONLogic expressions as interactive flow diagrams. Read-only (`editable={false}`) in viewers; editable with `onChange` in the workflow form's condition editor and the channel config's validation / key-logic / JWT authorization-logic fields (via the shared `LogicField` in `config-field.tsx`). CSS imported in `main.tsx`.

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
- **Tables:** `@tanstack/react-table` with `createColumnHelper<T>()`, server-side sorting via query params.
- **No index files:** Import directly from the file (`@/components/ui/button`, not `@/components/ui`).
- **Entity status:** Use `StatusBadge` from `@/components/shared/status-badge` for draft/active/archived display.
- **Lifecycle operations:** Use `LifecycleActions` from `@/components/shared/lifecycle-actions` for activate/archive/delete/new-version buttons, passing `onPreflight`/`preflight` to surface the `?dry_run=true` activation check.
- **Status colours:** add new status/state strings to `src/lib/status.ts` rather than inlining — every map there falls back to neutral, so an unmapped value degrades silently to grey.
- **Untoasted mutations:** validate/test/dry-run hooks are bare `useMutation({ mutationFn })` with no toast or invalidation — their results render inline, and a "failure" (invalid config, unreachable backend) is information rather than an error.
