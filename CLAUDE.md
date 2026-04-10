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

Three primitives with Draft -> Active -> Archived lifecycle:
- **Channels** — Service endpoints (sync/async, HTTP/REST/Kafka) with config (rate limits, caching, dedup, CORS). Full CRUD in UI.
- **Workflows** — Task pipelines with JSONLogic conditions. **Visualization only** in UI (no editing). Uses `@goplasmatic/dataflow-ui` `WorkflowVisualizer` and `@goplasmatic/datalogic-ui` `DataLogicEditor`.
- **Connectors** — External system connections (HTTP, DB, Kafka, Cache, MongoDB, Storage). Full CRUD in UI.

### Layers

- **`src/api/`** — Typed API client. `client.ts` wraps fetch with `/api/v1` base path and exports `buildQuery()`. Domain modules: `channels.ts`, `workflows.ts`, `connectors.ts`, `traces.ts`, `engine.ts`, `audit.ts`, `backup.ts`, `data.ts`. All types in `types.ts`.
- **`src/hooks/`** — TanStack Query wrappers. One hook file per domain (`use-channels.ts`, `use-workflows.ts`, etc.). Query keys are `["entity", params]` arrays. Mutations invalidate via `queryClient.invalidateQueries`.
- **`src/pages/`** — Route-level components. Named exports like `ChannelsPage`, `WorkflowDetailPage`. Data fetching via hooks, not inline.
- **`src/components/ui/`** — Shadcn-style primitives (Button, Card, Badge, Table, Tabs, etc.) using `React.forwardRef`, CVA variants, and `cn()` for class merging.
- **`src/components/shared/`** — Shared composed components: `StatusBadge`, `LifecycleActions`, `VersionHistory`, `JsonViewer`, `PageHeader`, `ConfirmDialog`.
- **`src/components/layout/`** — `AppLayout`, `Sidebar`, `Header`.
- **`src/lib/utils.ts`** — `cn()` (clsx + tailwind-merge), `formatDate()`, `truncate()`.
- **`src/lib/workflow-mapper.ts`** — Maps API `Workflow` (has `workflow_id`) to `@goplasmatic/dataflow-ui` `Workflow` type (has `id`).

### Routing

React Router v7 in `src/app.tsx`. All routes nest under `AppLayout` (sidebar + header + `<Outlet />`).

```
/                   -> DashboardPage
/channels           -> ChannelsPage
/channels/:id       -> ChannelDetailPage
/workflows          -> WorkflowsPage
/workflows/:id      -> WorkflowDetailPage
/connectors         -> ConnectorsPage
/connectors/:id     -> ConnectorDetailPage
/traces             -> TracesPage
/traces/:id         -> TraceDetailPage
/audit              -> AuditPage
/console            -> ConsolePage
/settings           -> SettingsPage
```

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
