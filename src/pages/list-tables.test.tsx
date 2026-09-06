/**
 * Render guard for the five list pages built on `@tanstack/react-table`.
 *
 * These pages share one table contract — `columnHelper.columns()`, `useTable({
 * features })`, `getHeaderGroups()`, `row.getAllCells()` and `flexRender()` —
 * and nothing else in the unit suite mounts a page, so a breaking change in
 * that library would otherwise only surface in the e2e run (which needs a live
 * server). Each case asserts the headers render and that real row data reaches
 * the cells.
 *
 * The API modules are mocked at `list`; the query hooks, column definitions and
 * render path all run for real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ReactElement } from "react"
import { render, screen, cleanup } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/lib/theme-provider"
import { TimeZoneProvider } from "@/lib/time-zone-provider"
import type {
  AuditLog,
  Channel,
  ConnectorListItem,
  PaginatedResponse,
  Trace,
  Workflow,
} from "@/api/types"

const page = <T,>(rows: T[]): PaginatedResponse<T> => ({
  data: rows,
  total: rows.length,
  limit: 25,
  offset: 0,
})

const auditRows: AuditLog[] = [
  {
    id: "au-1",
    principal: "alice",
    action: "activate",
    resource_type: "channel",
    resource_id: "chan-42",
    created_at: "2026-01-02T03:04:05Z",
  },
]

const channelRows: Channel[] = [
  {
    channel_id: "ch-1",
    name: "payments-intake",
    description: null,
    channel_type: "sync",
    protocol: "rest",
    route_pattern: "/payments",
    methods: ["POST"],
    topic: null,
    consumer_group: null,
    transport_config: {},
    workflow_id: "wf-1",
    config: {},
    status: "active",
    version: 7,
    priority: 0,
    tags: [],
    content_hash: "sha256:aaa",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  },
]

const connectorRows: ConnectorListItem[] = [
  {
    id: "co-1",
    name: "ledger-http",
    connector_type: "http",
    config: {},
    config_json: "{}",
    enabled: true,
    tags: [],
    content_hash: "sha256:bbb",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    load_status: "loaded",
  },
]

const traceRows: Trace[] = [
  {
    id: "tr-1",
    channel: "payments-intake",
    status: "completed",
    mode: "sync",
    error_message: null,
    duration_ms: 42,
    created_at: "2026-01-02T03:04:05Z",
    started_at: null,
    completed_at: null,
    updated_at: "2026-01-02T03:04:05Z",
  },
]

const workflowRows: Workflow[] = [
  {
    workflow_id: "wf-1",
    name: "settle-payment",
    description: null,
    priority: 0,
    tags: ["billing"],
    status: "active",
    version: 3,
    tasks: [{ id: "t1", name: "validate", function: { name: "validate" } }],
    content_hash: "sha256:ccc",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  },
]

vi.mock("@/api/audit", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/audit")>()
  return { ...mod, auditApi: { ...mod.auditApi, list: async () => page(auditRows) } }
})
vi.mock("@/api/channels", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/channels")>()
  return { ...mod, channelsApi: { ...mod.channelsApi, list: async () => page(channelRows) } }
})
vi.mock("@/api/connectors", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/connectors")>()
  return {
    ...mod,
    connectorsApi: { ...mod.connectorsApi, list: async () => page(connectorRows) },
  }
})
vi.mock("@/api/traces", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/traces")>()
  return { ...mod, tracesApi: { ...mod.tracesApi, list: async () => page(traceRows) } }
})
vi.mock("@/api/workflows", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/workflows")>()
  return { ...mod, workflowsApi: { ...mod.workflowsApi, list: async () => page(workflowRows) } }
})

import { AuditPage } from "@/pages/audit"
import { ChannelsPage } from "@/pages/channels"
import { ConnectorsPage } from "@/pages/connectors"
import { TracesPage } from "@/pages/traces"
import { WorkflowsPage } from "@/pages/workflows"

function renderPage(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ThemeProvider>
          <TimeZoneProvider>{ui}</TimeZoneProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

/** Column headers live in <th>; asserting on the role avoids matching a cell
 *  that happens to carry the same word (e.g. "Status"/"Type"). */
function expectHeaders(headers: string[]) {
  const rendered = screen.getAllByRole("columnheader").map((el) => el.textContent?.trim())
  for (const h of headers) expect(rendered).toContain(h)
}

beforeEach(cleanup)

describe("list page tables", () => {
  it("audit renders headers and row cells", async () => {
    renderPage(<AuditPage />)
    expect(await screen.findByText("activate")).toBeInTheDocument()
    expectHeaders(["Time", "Action", "Resource Type", "Resource ID", "User"])
    expect(screen.getByText("chan-42")).toBeInTheDocument()
    expect(screen.getByText("alice")).toBeInTheDocument()
  })

  it("channels renders headers and row cells", async () => {
    renderPage(<ChannelsPage />)
    expect(await screen.findByText("payments-intake")).toBeInTheDocument()
    expectHeaders(["Name", "Type", "Protocol", "Route", "Status", "Version", "Updated"])
    expect(screen.getByText("/payments")).toBeInTheDocument()
  })

  it("connectors renders headers and row cells", async () => {
    renderPage(<ConnectorsPage />)
    expect(await screen.findByText("ledger-http")).toBeInTheDocument()
    expectHeaders(["Name", "Type", "Status", "Load", "Updated"])
    expect(screen.getByText("Loaded")).toBeInTheDocument()
  })

  it("traces renders headers and row cells", async () => {
    renderPage(<TracesPage />)
    expect(await screen.findByText("payments-intake")).toBeInTheDocument()
    expectHeaders(["Status", "Channel", "Mode", "Created", "Duration"])
    expect(screen.getByText("completed")).toBeInTheDocument()
  })

  it("workflows renders headers and row cells", async () => {
    renderPage(<WorkflowsPage />)
    expect(await screen.findByText("settle-payment")).toBeInTheDocument()
    expectHeaders(["Name", "Tags", "Status", "Version", "Tasks", "Updated"])
    expect(screen.getByText("billing")).toBeInTheDocument()
  })
})
