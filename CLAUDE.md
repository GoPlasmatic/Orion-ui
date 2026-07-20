# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run dev          # Start Vite dev server (proxies /api, /health, /healthz, /readyz, /metrics to ORION_URL)
npm run build        # TypeScript check + Vite production build
npm run lint         # ESLint
npm run preview      # Preview production build locally
```

No test framework is configured.

## Architecture

Orion UI is a React 19 dashboard for the Orion workflow engine. It uses Vite 7, TypeScript (strict), Tailwind CSS v4, and TanStack Query/Table.

### Core Domain

Targets the Orion **v0.3** API (dataflow-rs 3.0). Three primitives with Draft -> Active -> Archived lifecycle:
- **Channels** — Service endpoints (sync/async, REST/HTTP/Kafka) with config (rate limits incl. `key_logic`, caching, dedup, CORS, validation logic, **tracing**) and `transport_config` (JSON editor, shown for Kafka). Full CRUD in UI (create/edit forms + bulk import). Channel responses parse `config`/`transport_config` to objects; `methods` is `string[] | null`.
- **Workflows** — Task pipelines with JSONLogic conditions. **Full authoring in UI**: create/edit (drafts only) via `workflow-form.tsx` (visual condition editor + tasks JSON + server-side Validate), plus import wizard, dry-run test (`{ matched, trace, output, errors }`), validate (`{ valid, errors[], warnings[] }`, issues are `{ field, message }`), export (server-side, honours filters), and canary rollout (`PATCH /{id}/rollout`, slider on the detail page for active workflows). Uses `@goplasmatic/dataflow-ui` `WorkflowVisualizer` and `@goplasmatic/datalogic-ui` `DataLogicEditor` (editable in forms).
- **Connectors** — External system connections (HTTP, DB, Kafka, Cache, Storage, **ES** — no separate "mongo" type). Full CRUD in UI (create/edit forms + bulk import). db/es connectors carry per-operation gates (`config.operations {read, insert, update, delete, upsert, raw_write}`, all default true) rendered as dedicated toggles. Responses carry `config_json` (a JSON **string** with secrets masked by the server) and an `enabled` flag — parse `config_json` for display; connectors are keyed by `id` (a UUID, distinct from `name`).
- **Functions** — Read-only reference page (`/functions`) rendering the server's per-function input-schema registry (`GET admin/functions`, `{ data: FunctionSchema[] }`, field kinds `string|number|bool|object|array|any`).

### v0.3 wire contracts worth remembering

- **Envelope:** single items are wrapped `{ data: <obj> }` (channels, connectors, workflows, single-trace list rows); the `GET data/traces/{id}` detail is hand-built and **not** wrapped.
- **Errors:** non-2xx bodies are `{ error: { code, message } }`. `client.ts` parses this and throws `ApiError(status, message, code)`.
- **Trace detail:** `{ id, status, mode, created_at, started_at?, completed_at?, duration_ms?, message?, error?, task_trace_json? }` — `message` is the parsed workflow result `{ id, status, data, errors }` (completed only), `error` is a string (failed only), `task_trace_json` is the parsed per-task `ExecutionTrace` (only when the channel set `config.tracing.task_details = true`).
- **Channel `config` sub-fields:** `rate_limit.requests_per_second`, `cors.allowed_origins`, `deduplication.window_secs`, plus `tracing { mode: sync|async|batch|off, sample_rate, errors_only, task_details }`.
- **Bulk import:** `POST {channels|connectors|workflows}/import?dry_run=` returns `{ imported, failed, errors[], would_create?, would_fail?, dry_run? }`.
- **Profiling:** sync data requests with the `X-Orion-Profile: 1` header return `_orion.profile` (gated server-side by `tracing.debug_profile_enabled`). The Data Console exposes a Profile toggle.
- **Circuit breakers:** `GET admin/connectors/circuit-breakers` returns `{ enabled, breakers: Record<key, state> }` (keys are `channel:connector`). There is no connectors-reload endpoint; the "reload" affordances call `admin/engine/reload`.
- **Backups:** `POST admin/backups` (plural) creates `{ data: { filename, path, size_bytes, created_at } }`; `GET admin/backups` lists `{ data: [{ filename, size_bytes, modified_at }] }`. SQLite only (400 otherwise). **There is no restore endpoint.**
- **Audit logs:** the server supports `limit`/`offset` only — no action/resource filters. The audit page filters client-side (fetches the most recent 1000 when a filter is active).
- **REST channels:** sync channels with a `route_pattern` are invoked by method + concrete path via the data-plane catch-all (`api.send()` in `client.ts`); the Data Console switches to method+path mode for them. GET/HEAD send no body.
- **Rollout:** `PATCH admin/workflows/{id}/status` accepts optional `rollout_percentage` on activation; `PATCH admin/workflows/{id}/rollout` adjusts it later.

### Layers

- **`src/api/`** — Typed API client. `client.ts` wraps fetch with `/api/v1` base path, parses the structured error envelope, and exports `buildQuery()` plus `api.send()` for arbitrary-method data-plane calls. Domain modules: `channels.ts`, `workflows.ts`, `connectors.ts`, `traces.ts`, `engine.ts`, `audit.ts`, `backup.ts`, `functions.ts`, `data.ts`. All types in `types.ts`. Note `audit.ts` normalizes the audit-logs endpoint's nested `{ pagination }` envelope (it differs from the flat `{ data, total, limit, offset }` other lists use); audit entries use `created_at`/`principal` fields.
- **`src/hooks/`** — TanStack Query wrappers. One hook file per domain (`use-channels.ts`, `use-workflows.ts`, etc.). Query keys are `["entity", params]` arrays. Mutations invalidate via `queryClient.invalidateQueries`.
- **`src/pages/`** — Route-level components. Named exports like `ChannelsPage`, `WorkflowDetailPage`. Data fetching via hooks, not inline.
- **`src/components/ui/`** — Shadcn-style primitives (Button, Card, Badge, Table, Tabs, etc.) using `React.forwardRef`, CVA variants, and `cn()` for class merging.
- **`src/components/shared/`** — Shared composed components: `StatusBadge`, `LifecycleActions`, `VersionHistory`, `JsonViewer`, `PageHeader`, `ConfirmDialog`.
- **`src/components/layout/`** — `AppLayout`, `Sidebar`, `Header`.
- **`src/lib/utils.ts`** — `cn()` (clsx + tailwind-merge), `formatDate()`, `parseJson()` (safe parse for `config_json`/task traces).
- **`src/lib/workflow-mapper.ts`** — Maps API `Workflow` (has `workflow_id`) to `@goplasmatic/dataflow-ui` `Workflow` type (has `id`).

### Routing

React Router v7 in `src/app.tsx`. All routes nest under `AppLayout` (sidebar + header + `<Outlet />`).

```
/                   -> DashboardPage
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
/traces/:id         -> TraceDetailPage
/audit              -> AuditPage
/console            -> ConsolePage
/settings           -> SettingsPage
```

Forms (`channel-form.tsx`, `connector-form.tsx`) use a wrapper page that waits for the edit query, then mounts an inner form seeded via `useState` initializers (keyed to remount on data load) — avoid `setState`-in-`useEffect` for form hydration.

### API Proxy

Dev server proxies `/api`, `/health`, `/healthz`, `/readyz`, `/metrics` to `process.env.ORION_URL` (default `http://localhost:8080`). The API client prepends `/api/v1` to all paths.

### Visualization Libraries

- **`@goplasmatic/dataflow-ui`** — `WorkflowVisualizer` renders workflow task pipelines with tree/flow/graph views and optional debug tracing. CSS imported in `main.tsx`.
- **`@goplasmatic/datalogic-ui`** — `DataLogicEditor` renders JSONLogic expressions as interactive flow diagrams. Read-only (`editable={false}`) in viewers; editable with `onChange` in the workflow form's condition editor and the channel config's validation/key-logic fields. CSS imported in `main.tsx`.

### Pagination

Server-side offset/limit pagination. API returns `PaginatedResponse<T>` (`{ data, total, limit, offset }`). Pages track `offset` in local state and pass it to hooks.

## Conventions

- **Imports:** Always use `@/` path alias (maps to `src/`).
- **File names:** kebab-case (`use-workflows.ts`, `app-layout.tsx`). Exports are PascalCase for components, camelCase for functions/objects.
- **Styling:** Tailwind utility classes only. Use `cn()` for conditional/merged classes. Theme tokens defined as CSS variables in `src/index.css` (OKLch color space).
- **Component variants:** Use `class-variance-authority` (CVA) with `VariantProps` typing.
- **Icons:** `lucide-react` exclusively.
- **Tables:** `@tanstack/react-table` with `createColumnHelper<T>()`, server-side sorting via query params.
- **No index files:** Import directly from the file (`@/components/ui/button`, not `@/components/ui`).
- **Entity status:** Use `StatusBadge` from `@/components/shared/status-badge` for draft/active/archived display.
- **Lifecycle operations:** Use `LifecycleActions` from `@/components/shared/lifecycle-actions` for activate/archive/delete/new-version buttons.
