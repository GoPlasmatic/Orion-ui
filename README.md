<div align="center">
  <img src="https://avatars.githubusercontent.com/u/207296579?s=200&v=4" alt="Orion Logo" width="120" height="120">

  # Orion UI

  **The admin dashboard for the [Orion](https://github.com/GoPlasmatic/Orion) rules engine.**

  Manage rules, connectors, channels, and invocations from a single interface.
  Visualize rule workflows, inspect audit trails, and monitor engine health — no CLI required.

  [![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
  [![React](https://img.shields.io/badge/react-19-blue.svg)](https://react.dev)
  [![TypeScript](https://img.shields.io/badge/typescript-5.9-blue.svg)](https://www.typescriptlang.org)
  [![Vite](https://img.shields.io/badge/vite-7-purple.svg)](https://vite.dev)
</div>

---

## Quick Start

**1. Start the Orion backend** (if not already running):

```bash
brew install GoPlasmatic/tap/orion   # or: curl installer, cargo install
orion-server
```

**2. Install and run the UI:**

```bash
npm install
npm run dev
```

**3. Open the dashboard:**

Visit `http://localhost:5173` — the dev server proxies all API requests to the Orion backend automatically.

By default the backend is expected at `http://localhost:8080`. Override with:

```bash
ORION_URL=http://your-backend:8080 npm run dev
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Dashboard** | Engine status, health checks, active rule counts, and uptime at a glance |
| **Rule Workflows** | Visual DAG of task pipelines with condition nodes, powered by React Flow |
| **Invocations** | Paginated, sortable job list with status badges and computed durations |
| **Audit Trails** | Drill into any invocation to see a step-by-step timeline of changes |
| **Connectors** | Browse and inspect connector configurations |
| **Channels** | Channel overview with associated rules |
| **Data Processing** | Send test payloads directly from the UI |

## How It Works

```
┌──────────────────────────────────────────────────────┐
│                     Orion UI                         │
│                                                      │
│   ┌───────────┐  ┌────────────┐  ┌──────────────┐   │
│   │ Dashboard │  │   Rules    │  │ Invocations  │   │
│   │  Health   │  │  Workflow  │  │ Audit Trails │   │
│   └─────┬─────┘  └─────┬──────┘  └──────┬───────┘   │
│         │              │                │            │
│         └──────────┬───┘────────────────┘            │
│                    │                                 │
│              TanStack Query                          │
│              (cache + fetch)                         │
│                    │                                 │
└────────────────────┼─────────────────────────────────┘
                     │  /api/v1/*
                     ▼
            ┌────────────────┐
            │  Orion Server  │
            │  (Rust, :8080) │
            └────────────────┘
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with HMR |
| `npm run build` | Type-check with `tsc` then bundle |
| `npm run lint` | Run ESLint |
| `npm run preview` | Serve the production build locally |

## Project Structure

```
src/
├── api/            # Typed fetch client and per-domain endpoint modules
├── hooks/          # TanStack Query wrappers (one file per domain)
├── pages/          # Route-level page components
├── components/
│   ├── ui/         # Reusable primitives (Button, Card, Badge, Table, …)
│   ├── layout/     # App shell (sidebar, header)
│   └── rules/      # Rule-specific components (workflow graph, nodes)
└── lib/            # Utilities (cn, formatDate, truncate)
```

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — engine status, health, rule counts |
| `/invocations` | Job list with sortable columns and pagination |
| `/invocations/:id` | Job detail with audit trail timeline |
| `/channels` | Channel overview |
| `/connectors` | Connector list |
| `/connectors/:id` | Connector detail and configuration |
| `/data` | Data processing interface |

## Built With

| Library | Purpose |
|---------|---------|
| [React 19](https://react.dev) | UI framework |
| [React Router 7](https://reactrouter.com) | Client-side routing |
| [TanStack Query](https://tanstack.com/query) | Server state, caching, and mutations |
| [TanStack Table](https://tanstack.com/table) | Headless data tables with sorting and pagination |
| [Tailwind CSS v4](https://tailwindcss.com) | Utility-first styling with CSS variable theming |
| [React Flow](https://reactflow.dev) | Rule workflow DAG visualization |
| [Lucide React](https://lucide.dev) | Icons |
| [CVA](https://cva.style) | Type-safe component variants |

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/GoPlasmatic/Orion-ui).

```bash
npm install              # Install dependencies
npm run dev              # Development server
npm run build            # Type-check and build
npm run lint             # Lint
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
