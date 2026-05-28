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

Targets the Orion **v0.2** API (dataflow-rs 3.0). Three primitives with Draft -> Active -> Archived lifecycle:
- **Channels** — Service endpoints (sync/async, REST/HTTP/Kafka) with config (rate limits, caching, dedup, CORS, **tracing**). Full CRUD in UI (create/edit forms + bulk import). Channel responses parse `config`/`transport_config` to objects; `methods` is `string[] | null`.
- **Workflows** — Task pipelines with JSONLogic conditions. **Visualization only** in UI (no editing). Uses `@goplasmatic/dataflow-ui` `WorkflowVisualizer` and `@goplasmatic/datalogic-ui` `DataLogicEditor`. Supports dry-run test (`{ matched, trace, output, errors }`) and validate (`{ valid, errors[], warnings[] }`, issues are `{ field, message }`).
- **Connectors** — External system connections (HTTP, DB, Kafka, Cache, Storage — no separate "mongo" type). Full CRUD in UI (create/edit forms + bulk import). Responses carry `config_json` (a JSON **string** with secrets masked by the server) and an `enabled` flag — parse `config_json` for display; connectors are keyed by `id` (a UUID, distinct from `name`).

### v0.2 wire contracts worth remembering

- **Envelope:** single items are wrapped `{ data: <obj> }` (channels, connectors, workflows, single-trace list rows); the `GET data/traces/{id}` detail is hand-built and **not** wrapped.
- **Errors:** non-2xx bodies are `{ error: { code, message } }`. `client.ts` parses this and throws `ApiError(status, message, code)`.
- **Trace detail:** `{ id, status, mode, created_at, started_at?, completed_at?, duration_ms?, message?, error?, task_trace_json? }` — `message` is the parsed workflow result `{ id, status, data, errors }` (completed only), `error` is a string (failed only), `task_trace_json` is the parsed per-task `ExecutionTrace` (only when the channel set `config.tracing.task_details = true`).
- **Channel `config` sub-fields:** `rate_limit.requests_per_second`, `cors.allowed_origins`, `deduplication.window_secs`, plus `tracing { mode: sync|async|batch|off, sample_rate, errors_only, task_details }`.
- **Bulk import:** `POST {channels|connectors|workflows}/import?dry_run=` returns `{ imported, failed, errors[], would_create?, would_fail?, dry_run? }`.
- **Profiling:** sync data requests with the `X-Orion-Profile: 1` header return `_orion.profile` (gated server-side by `tracing.debug_profile_enabled`). The Data Console exposes a Profile toggle.
- **Circuit breakers:** `GET admin/connectors/circuit-breakers` returns `{ enabled, breakers: Record<key, state> }`. There is no connectors-reload endpoint; the "reload" affordances call `admin/engine/reload`.

### Layers

- **`src/api/`** — Typed API client. `client.ts` wraps fetch with `/api/v1` base path, parses the structured error envelope, and exports `buildQuery()`. Domain modules: `channels.ts`, `workflows.ts`, `connectors.ts`, `traces.ts`, `engine.ts`, `audit.ts`, `backup.ts`, `data.ts`. All types in `types.ts`. Note `audit.ts` normalizes the audit-logs endpoint's nested `{ pagination }` envelope (it differs from the flat `{ data, total, limit, offset }` other lists use); audit entries use `created_at`/`principal` fields.
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
/workflows/:id      -> WorkflowDetailPage
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
- **`@goplasmatic/datalogic-ui`** — `DataLogicEditor` renders JSONLogic expressions as interactive flow diagrams. Used with `editable={false}` for read-only visualization. CSS imported in `main.tsx`.

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
