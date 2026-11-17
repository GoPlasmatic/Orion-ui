/**
 * The channel list is the head's channel members over their definitions —
 * there is no server listing, so search, filters, sort and paging run in the
 * browser. A search covers name, member id and route; the protocol filter
 * offers what is deployed; a canary split is drawn on its row; a member this
 * node quarantined says so.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/lib/theme-provider"
import { TimeZoneProvider } from "@/lib/time-zone-provider"
import { deployedChannel, setDeployed } from "@/test/deployed-api"

vi.mock("@/api/deployments", async () => (await import("@/test/deployed-api")).deploymentsModule())
vi.mock("@/api/definitions", async () => (await import("@/test/deployed-api")).definitionsModule())
vi.mock("@/api/runtime", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/runtime")>()
  return {
    ...mod,
    runtimeApi: {
      capabilities: async () => ({
        api_version: 2,
        edition: "standard",
        deployment_head: { revision: 1, epoch: 1 },
        node_status: {
          applied_revision: 1,
          desired_revision: 1,
          quarantined_entities: [
            { entity: { kind: "channel", id: "billing-run", revision: 1 }, reason: "cron is disabled on this node" },
          ],
        },
      }),
    },
  }
})

import { ChannelsPage } from "@/pages/channels"

const REGISTRY = [
  deployedChannel({ channel_id: "orders-get", route_pattern: "/orders/{id}", workflow_id: "orders" }),
  deployedChannel({
    channel_id: "orders-list",
    name: "orders-index",
    route_pattern: "/orders",
    workflow_id: "orders",
    rollouts: [
      { workflow_revision: 1, start_bucket: 0, end_bucket: 90 },
      { workflow_revision: 2, start_bucket: 90, end_bucket: 100 },
    ],
  }),
  deployedChannel({
    channel_id: "billing-run",
    protocol: "cron",
    channel_type: "async",
    transport_config: { schedule: "0 0 * * * *" },
    workflow_id: "billing",
  }),
]

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <ThemeProvider>
          <TimeZoneProvider>
            <ChannelsPage />
          </TimeZoneProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  cleanup()
  setDeployed({ channels: REGISTRY })
})

describe("the channel list", () => {
  it("lists every deployed channel, its schedule in place of a route", async () => {
    renderAt("/channels")
    expect(await screen.findByText("orders-get")).toBeInTheDocument()
    expect(screen.getByText("orders-index")).toBeInTheDocument()
    expect(screen.getByText("0 0 * * * *")).toBeInTheDocument()
  })

  it("searches the name, the member id and the route", async () => {
    renderAt("/channels?q=orders-list")
    expect(await screen.findByText("orders-index")).toBeInTheDocument()
    expect(screen.queryByText("orders-get")).not.toBeInTheDocument()
    cleanup()
    renderAt("/channels?q=%2Forders%2F")
    expect(await screen.findByText("orders-get")).toBeInTheDocument()
    expect(screen.queryByText("orders-index")).not.toBeInTheDocument()
  })

  it("offers the protocols the head deploys and filters on one", async () => {
    renderAt("/channels?protocol=cron")
    expect(await screen.findByText("billing-run")).toBeInTheDocument()
    expect(screen.queryByText("orders-get")).not.toBeInTheDocument()
    const options = [...screen.getByRole("combobox", { name: "Filter by protocol" }).querySelectorAll("option")].map(
      (o) => o.textContent,
    )
    expect(options).toEqual(["All protocols", "CRON", "REST"])
  })

  it("draws a canary split and marks what this node quarantined", async () => {
    renderAt("/channels")
    expect(await screen.findByText("r1: 90%")).toBeInTheDocument()
    expect(screen.getByText("r2: 10%")).toBeInTheDocument()
    expect(await screen.findByText("quarantined")).toHaveAttribute("title", "cron is disabled on this node")
  })
})
