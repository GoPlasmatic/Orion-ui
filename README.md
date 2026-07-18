<div align="center">
  <img src="https://avatars.githubusercontent.com/u/207296579?s=200&v=4" alt="Orion Logo" width="120" height="120">

  # Orion UI

  **The operations console for the [Orion](https://github.com/GoPlasmatic/Orion) services runtime.**

  Live dashboards, a system map of your channels and connectors, visual workflow
  inspection, trace drill-downs, and full channel/connector management — no CLI required.

  [![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
  [![React](https://img.shields.io/badge/react-19-blue.svg)](https://react.dev)
  [![TypeScript](https://img.shields.io/badge/typescript-5.9-blue.svg)](https://www.typescriptlang.org)
  [![Vite](https://img.shields.io/badge/vite-7-purple.svg)](https://vite.dev)
</div>

<table>
  <tr>
    <td width="50%" align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="media/ui-operations-dark.png">
        <img src="media/ui-operations-light.png" alt="Operations dashboard — request rate, error rate, latency, outcomes by channel, and recent traces">
      </picture>
      <em>Operations dashboard</em>
    </td>
    <td width="50%" align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="media/ui-system-map-dark.png">
        <img src="media/ui-system-map-light.png" alt="System Map — a channel traced through its workflow and connectors as a topology graph">
      </picture>
      <em>System Map</em>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="media/ui-workflow-dag-dark.png">
        <img src="media/ui-workflow-dag-light.png" alt="Workflow detail — task explorer with the selected task's JSONLogic rendered as a flow graph">
      </picture>
      <em>Workflow logic, visualized</em>
    </td>
    <td width="50%" align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="media/ui-console-dark.png">
        <img src="media/ui-console-light.png" alt="Data Console — send a test request to a channel and inspect the response, per-task timings, and trace">
      </picture>
      <em>Data Console</em>
    </td>
  </tr>
</table>

All screenshots are generated from a live instance by the
[recording pipeline](https://github.com/GoPlasmatic/Orion/tree/main/docs/recordings)
in the main repo — the ~50-second console walkthrough GIF there shows this UI taking
a service from nothing to live without writing code.

---

## Quick Start

### Run with Docker (recommended)

The UI ships as a production-ready container image (nginx, multi-arch amd64/arm64):

```bash
docker run -p 8081:8080 \
  -e ORION_URL=http://host.docker.internal:8080 \
  ghcr.io/goplasmatic/orion-ui:latest
```

Open `http://localhost:8081`. `ORION_URL` points at your Orion server; the bundled
nginx reverse-proxies all `/api/` requests to it.

### Run the full stack with Docker Compose

With the [Orion](https://github.com/GoPlasmatic/Orion) repo checked out as a sibling
directory, one command brings up the server and the UI together:

```bash
docker compose --profile prod up    # server + production UI on :8081
docker compose --profile dev up     # server + Vite dev server with HMR on :5173
```

### Run from source

```bash
# 1. Start the Orion backend (if not already running)
brew install GoPlasmatic/tap/orion-server && orion-server

# 2. Install and run the UI
npm install
npm run dev
```

Visit `http://localhost:5173` — the dev server proxies API requests to the backend
(default `http://localhost:8080`, override with `ORION_URL=http://your-backend:8080 npm run dev`).

---

## Features

| Feature | Description |
|---------|-------------|
| **Operations** | Live KPIs at a glance — requests/min, error rate, average and p95 latency, and a "what needs attention" feed |
| **System Map** | Topology view: trace any channel through its workflow, downstream channels, and connectors |
| **Channels** | Full lifecycle management — create, edit, version, activate/archive, bulk import, structured config editor |
| **Workflows** | Visual DAG of task pipelines (tree/flow/graph views), JSONLogic condition editing, dry-run testing, validation, version compare |
| **Connectors** | Create and manage database, cache, HTTP, and messaging connectors |
| **Circuit Breakers** | Monitor and reset per-connector circuit breakers |
| **Traces** | Execution history with per-task detail and latency/error analytics |
| **Audit Log** | Who changed what, when — across every admin operation |
| **Data Console** | Send test requests to any channel with optional profiling |
| **Polish** | Command palette (⌘K), light/dark themes, density modes, empty states, import wizards |

## Pages

| Route | Description |
|-------|-------------|
| `/` | Operations dashboard — live KPIs and attention feed |
| `/system-map` | Channel → workflow → connector topology graph |
| `/channels`, `/channels/new`, `/channels/:id`, `/channels/:id/edit` | Channel list, creation, detail, editing |
| `/workflows`, `/workflows/:id` | Workflow list and visual DAG detail with dry-run |
| `/connectors`, `/connectors/new`, `/connectors/:id`, `/connectors/:id/edit` | Connector management |
| `/circuit-breakers` | Circuit breaker status and reset |
| `/traces`, `/traces/:id` | Execution traces and per-task drill-down |
| `/audit` | Audit log |
| `/console` | Data console for test requests |
| `/settings` | Theme and density preferences |

## How It Works

```
┌────────────────────────────────────────────────────────┐
│                       Orion UI                         │
│                                                        │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────┐   │
│  │ Operations │  │ System Map │  │ Channels /      │   │
│  │ Dashboards │  │  Topology  │  │ Workflows /     │   │
│  │  & Traces  │  │   Graph    │  │ Connectors CRUD │   │
│  └──────┬─────┘  └─────┬──────┘  └────────┬────────┘   │
│         └──────────────┼──────────────────┘            │
│                 TanStack Query                         │
│                 (cache + fetch)                        │
└────────────────────────┼───────────────────────────────┘
                         │  /api/v1/*
                         ▼
                ┌────────────────┐
                │  Orion Server  │
                │  (Rust, :8080) │
                └────────────────┘
```

In production the container serves the built SPA with nginx and reverse-proxies
`/api/`, health, and metrics endpoints to the Orion server (`ORION_URL`).

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
│   ├── layout/     # App shell (sidebar, header, command palette)
│   ├── graph/      # Topology and relationship graphs
│   └── traces/     # Trace analytics and detail views
└── lib/            # Utilities, theme/density providers, topology builders
```

## Built With

| Library | Purpose |
|---------|---------|
| [React 19](https://react.dev) | UI framework |
| [React Router 7](https://reactrouter.com) | Client-side routing |
| [TanStack Query](https://tanstack.com/query) | Server state, caching, and mutations |
| [TanStack Table](https://tanstack.com/table) | Headless data tables with sorting and pagination |
| [Tailwind CSS v4](https://tailwindcss.com) | Utility-first styling with CSS variable theming |
| [@goplasmatic/dataflow-ui](https://github.com/GoPlasmatic/dataflow-rs) | Workflow DAG visualization (tree/flow/graph) |
| [@goplasmatic/datalogic-ui](https://github.com/GoPlasmatic/datalogic-rs) | JSONLogic condition editor |
| [Recharts](https://recharts.org) | Trace analytics charts |
| [Lucide React](https://lucide.dev) | Icons |

## Related

- **[Orion](https://github.com/GoPlasmatic/Orion)** — the services runtime this console operates
- **[Orion CLI](https://github.com/GoPlasmatic/Orion-cli)** — terminal + MCP-server companion
- **[Orion Documentation](https://goplasmatic.github.io/Orion/)** — concepts, API reference, tutorials

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
