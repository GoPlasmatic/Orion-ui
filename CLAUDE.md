# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run dev          # Start Vite dev server (proxies /api, /health, /metrics to ORION_URL)
npm run build        # TypeScript check + Vite production build
npm run lint         # ESLint
npm run preview      # Preview production build locally
```

No test framework is configured.

## Architecture

Orion UI is a React 19 admin dashboard for the Orion rules engine. It uses Vite 7, TypeScript (strict), Tailwind CSS v4, and TanStack Query/Table.

### Layers

- **`src/api/`** — Typed API client. `client.ts` wraps fetch with `/api/v1` base path. Domain modules (`rules.ts`, `jobs.ts`, etc.) export endpoint objects. All request types live in `types.ts`. Use `buildQuery()` to serialize params.
- **`src/hooks/`** — TanStack Query wrappers. One hook file per domain. Query keys are `["entity", params]` arrays. Mutations invalidate via `queryClient.invalidateQueries`.
- **`src/pages/`** — Route-level components. Named exports like `InvocationsPage`. Data fetching via hooks, not inline.
- **`src/components/ui/`** — Shadcn-style primitives (Button, Card, Badge, Table, etc.) using `React.forwardRef`, CVA variants, and `cn()` for class merging.
- **`src/components/{domain}/`** — Domain-specific composed components (rules workflow viz, etc.).
- **`src/lib/utils.ts`** — `cn()` (clsx + tailwind-merge), `formatDate()`, `truncate()`.

### Routing

React Router v7 in `src/app.tsx`. All routes nest under `AppLayout` (sidebar + header + `<Outlet />`).

### API Proxy

Dev server proxies `/api`, `/health`, `/metrics` to `process.env.ORION_URL` (default `http://localhost:8080`). The API client prepends `/api/v1` to all paths.

### Pagination

Server-side offset/limit pagination. API returns `PaginatedResponse<T>` (`{ data, total, limit, offset }`). Pages track `offset` in local state and pass it to hooks.

## Conventions

- **Imports:** Always use `@/` path alias (maps to `src/`).
- **File names:** kebab-case (`use-rules.ts`, `app-layout.tsx`). Exports are PascalCase for components, camelCase for functions/objects.
- **Styling:** Tailwind utility classes only. Use `cn()` for conditional/merged classes. Theme tokens defined as CSS variables in `src/index.css` (OKLch color space).
- **Component variants:** Use `class-variance-authority` (CVA) with `VariantProps` typing.
- **Icons:** `lucide-react` exclusively.
- **Tables:** `@tanstack/react-table` with `createColumnHelper<T>()`, server-side sorting via query params.
- **No index files:** Import directly from the file (`@/components/ui/button`, not `@/components/ui`).
