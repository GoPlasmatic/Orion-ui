/**
 * What a list page says when it has no rows to show.
 *
 * Two different facts share one slot. An empty registry wants the first-run
 * state — what the primitive is, and a button that creates one. A list the
 * filters narrowed to nothing wants the opposite: the registry is not empty,
 * these filters select none of it, and here is the way back. Showing the
 * first-run pitch over a filtered list told an operator the system was empty
 * when it was not, which is why every page picks between the two here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ReactElement } from "react"
import { render, screen, cleanup } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/lib/theme-provider"
import { TimeZoneProvider } from "@/lib/time-zone-provider"
import type { PaginatedResponse } from "@/api/types"

const empty = <T,>(): PaginatedResponse<T> => ({ data: [], total: 0, limit: 20, offset: 0 })

vi.mock("@/api/audit", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/audit")>()
  return { ...mod, auditApi: { ...mod.auditApi, list: async () => empty() } }
})
vi.mock("@/api/channels", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/channels")>()
  return { ...mod, channelsApi: { ...mod.channelsApi, list: async () => empty() } }
})
vi.mock("@/api/connectors", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/connectors")>()
  return { ...mod, connectorsApi: { ...mod.connectorsApi, list: async () => empty() } }
})
vi.mock("@/api/traces", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/traces")>()
  return { ...mod, tracesApi: { ...mod.tracesApi, list: async () => empty() } }
})
vi.mock("@/api/workflows", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/workflows")>()
  return { ...mod, workflowsApi: { ...mod.workflowsApi, list: async () => empty() } }
})
vi.mock("@/api/models", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/models")>()
  return { ...mod, modelsApi: { ...mod.modelsApi, list: async () => empty() } }
})
vi.mock("@/api/plugins", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/plugins")>()
  return { ...mod, pluginsApi: { ...mod.pluginsApi, list: async () => empty() } }
})
vi.mock("@/api/trace-dlq", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/trace-dlq")>()
  return { ...mod, traceDlqApi: { ...mod.traceDlqApi, list: async () => empty() } }
})

import { AuditPage } from "@/pages/audit"
import { ChannelsPage } from "@/pages/channels"
import { ConnectorsPage } from "@/pages/connectors"
import { ModelsPage } from "@/pages/models"
import { PluginsPage } from "@/pages/plugins"
import { TraceDlqPage } from "@/pages/trace-dlq"
import { TracesPage } from "@/pages/traces"
import { WorkflowsPage } from "@/pages/workflows"

function renderAt(ui: ReactElement, url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <ThemeProvider>
          <TimeZoneProvider>{ui}</TimeZoneProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

interface Case {
  name: string
  ui: ReactElement
  route: string
  /** A filter that cannot match, as it appears in the URL. */
  filter: string
  /** What this page calls its rows in the filtered-empty state. */
  noun: string
  /** The headline of its first-run state. */
  firstRun: string
}

const PAGES: Case[] = [
  { name: "channels", ui: <ChannelsPage />, route: "/channels", filter: "tag=nothing-carries-this", noun: "channels", firstRun: "No channels yet" },
  { name: "workflows", ui: <WorkflowsPage />, route: "/workflows", filter: "tag=nothing-carries-this", noun: "workflows", firstRun: "No workflows yet" },
  { name: "connectors", ui: <ConnectorsPage />, route: "/connectors", filter: "tag=nothing-carries-this", noun: "connectors", firstRun: "No connectors yet" },
  { name: "plugins", ui: <PluginsPage />, route: "/plugins", filter: "tag=nothing-carries-this", noun: "plugins", firstRun: "No plugins yet" },
  { name: "models", ui: <ModelsPage />, route: "/models", filter: "admission=failed", noun: "models", firstRun: "No models yet" },
  { name: "traces", ui: <TracesPage />, route: "/traces", filter: "channel=nothing-is-called-this", noun: "traces", firstRun: "No traces found" },
  { name: "audit", ui: <AuditPage />, route: "/audit", filter: "principal=nobody", noun: "audit rows", firstRun: "No audit rows yet" },
  { name: "trace DLQ", ui: <TraceDlqPage />, route: "/trace-dlq", filter: "exhausted=true", noun: "entries", firstRun: "Nothing in the dead-letter queue" },
]

beforeEach(cleanup)

describe("an empty list page", () => {
  for (const { name, ui, route, filter, noun, firstRun } of PAGES) {
    it(`${name}: teaches when the registry is empty`, async () => {
      renderAt(ui, route)
      expect(await screen.findByText(firstRun)).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument()
    })

    it(`${name}: says the filters select nothing when they do`, async () => {
      renderAt(ui, `${route}?${filter}`)
      expect(await screen.findByText(`No ${noun} match these filters`)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument()
      expect(screen.queryByText(firstRun)).not.toBeInTheDocument()
    })
  }
})
