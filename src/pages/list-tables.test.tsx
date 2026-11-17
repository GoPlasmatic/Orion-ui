/**
 * Render guard for the six list pages built on `@tanstack/react-table`.
 *
 * These pages share one table contract — `columnHelper.columns()`, `useTable({
 * features })`, `getHeaderGroups()`, `row.getAllCells()` and `flexRender()` —
 * and nothing else in the unit suite mounts a page, so a breaking change in
 * that library would otherwise only surface in the e2e run (which needs a live
 * server). Each case asserts the headers render and that real row data reaches
 * the cells.
 *
 * The API modules are mocked at `list` (the deployed entities at the head
 * manifest and its definitions); the query hooks, column definitions and
 * render path all run for real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { deployedChannel, deployedWorkflow, setDeployed } from "@/test/deployed-api"
import type { ReactElement } from "react"
import { render, screen, cleanup } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/lib/theme-provider"
import { TimeZoneProvider } from "@/lib/time-zone-provider"
import type {
  AuditLog,
  ConnectionRevision,
  ConnectorPackageSummary,
  Page,
  Trace,
} from "@/api/types"

const page = <T,>(rows: T[]): Page<T> => ({ data: rows, total: rows.length, limit: 25 })

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

const channelRows = [
  deployedChannel({
    channel_id: "ch-1",
    name: "payments-intake",
    route_pattern: "/payments",
    methods: ["POST"],
    workflow_id: "wf-1",
    revision: 7,
  }),
]

const connectionRows: ConnectionRevision[] = [
  {
    connection_id: "ledger-http",
    revision: 2,
    provider_digest: "sha256:http",
    public_config: { url: "https://ledger.example" },
    secret_locators: { "auth.token": "env://LEDGER_TOKEN" },
    bindings: {},
    configuration_digest: "sha256:cfg2",
  },
  {
    connection_id: "ledger-http",
    revision: 1,
    provider_digest: "sha256:http",
    public_config: { url: "https://old.example" },
    secret_locators: {},
    bindings: {},
    configuration_digest: "sha256:cfg1",
  },
]

const packageRows: ConnectorPackageSummary[] = [
  {
    publisher: "acme",
    provider_id: "acme.echo",
    version: "1.2.0",
    digest: "sha256:feb3512751903c850e3b68800acf77c20e00ce6046c673a00b0c58a67a862f3f",
    implementation: "workflow",
    tier: "standard",
    admitted: false,
    revoked: false,
    artifact_state: "active",
    manifest: {},
    distribution: {},
    inventory: {},
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

const workflowRows = [
  deployedWorkflow({
    workflow_id: "wf-1",
    name: "settle-payment",
    tags: ["billing"],
    revision: 3,
    tasks: [{ id: "t1", name: "validate", function: { name: "validation" } }],
  }),
]

vi.mock("@/api/audit", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/audit")>()
  return { ...mod, auditApi: { ...mod.auditApi, list: async () => page(auditRows) } }
})
vi.mock("@/api/deployments", async () => (await import("@/test/deployed-api")).deploymentsModule())
vi.mock("@/api/definitions", async () => (await import("@/test/deployed-api")).definitionsModule())
vi.mock("@/api/connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/connections")>()
  return { ...mod, connectionsApi: { ...mod.connectionsApi, list: async () => ({ data: connectionRows, limit: 200 }) } }
})
vi.mock("@/api/connector-packages", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/connector-packages")>()
  return {
    ...mod,
    connectorPackagesApi: { ...mod.connectorPackagesApi, list: async () => ({ data: packageRows, limit: 50 }) },
  }
})
vi.mock("@/api/runtime", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/runtime")>()
  return {
    ...mod,
    runtimeApi: {
      capabilities: async () => ({
        edition: "community",
        provider_backends: [{ kind: "rust", driver_id: "org.orion.http", package_digest: "sha256:http" }],
        node_status: { applied_revision: 1, quarantined_entities: [] },
      }),
    },
  }
})
vi.mock("@/api/traces", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/traces")>()
  return { ...mod, tracesApi: { ...mod.tracesApi, list: async () => page(traceRows) } }
})
import { AuditPage } from "@/pages/audit"
import { ChannelsPage } from "@/pages/channels"
import { ConnectionsPage } from "@/pages/connections"
import { TracesPage } from "@/pages/traces"
import { WorkflowsPage } from "@/pages/workflows"
import { ProviderPackagesPage } from "@/pages/provider-packages"

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

beforeEach(() => {
  cleanup()
  setDeployed({ channels: channelRows, workflows: workflowRows })
})

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
    expectHeaders(["Name", "Type", "Protocol", "Route", "Workflow", "Revision"])
    expect(screen.getByText("/payments")).toBeInTheDocument()
    expect(screen.getByText("r7")).toBeInTheDocument()
  })

  it("connections renders one row per connection over its revisions", async () => {
    renderPage(<ConnectionsPage />)
    expect(await screen.findByText("ledger-http")).toBeInTheDocument()
    expectHeaders(["Connection", "Provider", "Deployed", "Revisions", "Required by", "Last probe"])
    // Two revisions, one row; the provider digest resolves to the built-in driver.
    expect(screen.getAllByText("ledger-http")).toHaveLength(1)
    expect(await screen.findByText("org.orion.http")).toBeInTheDocument()
    expect(screen.getByText("not deployed")).toBeInTheDocument()
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
    expectHeaders(["Name", "Tags", "Revision", "Runs on", "Tasks"])
    expect(screen.getByText("billing")).toBeInTheDocument()
    expect(screen.getByText("r3")).toBeInTheDocument()
    // The channel requires it, so the list says what runs it.
    expect(screen.getByText("payments-intake")).toBeInTheDocument()
  })

  it("provider packages renders headers and row cells", async () => {
    renderPage(<ProviderPackagesPage />)
    expect(await screen.findByText("acme.echo")).toBeInTheDocument()
    expectHeaders(["Provider", "Version", "Implementation", "Tier", "State", "Connections", "Digest"])
    expect(screen.getByText("not admitted")).toBeInTheDocument()
    // A Standard package on a Community node: stored, not admissible here.
    expect(await screen.findByText(/needs edition/)).toBeInTheDocument()
  })
})
