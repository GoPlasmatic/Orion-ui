/**
 * The channel list opens on what is serving. With no `?status=` it asks the
 * server for active channels only, says how many archived ones that hides,
 * and `?status=all` is the explicit everything. A name search — which the
 * server cannot do — runs over the registry in the browser.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/lib/theme-provider"
import { TimeZoneProvider } from "@/lib/time-zone-provider"
import type { Channel, ListChannelsParams, PaginatedResponse } from "@/api/types"

const channel = (name: string, status: Channel["status"]): Channel => ({
  channel_id: `id-${name}`,
  name,
  description: null,
  channel_type: "sync",
  protocol: "rest",
  route_pattern: `/${name}`,
  methods: ["GET"],
  topic: null,
  consumer_group: null,
  transport_config: {},
  workflow_id: null,
  config: {},
  status,
  version: 1,
  priority: 0,
  tags: [],
  content_hash: "sha256:x",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
})

const REGISTRY = [
  channel("orders-get", "active"),
  channel("orders-list", "active"),
  channel("orders-old", "archived"),
  channel("billing-run", "draft"),
]

const calls: ListChannelsParams[] = []

vi.mock("@/api/channels", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/channels")>()
  return {
    ...mod,
    channelsApi: {
      ...mod.channelsApi,
      list: async (params: ListChannelsParams = {}): Promise<PaginatedResponse<Channel>> => {
        calls.push(params)
        const rows = REGISTRY.filter((c) => !params.status || c.status === params.status)
        return { data: rows.slice(0, params.limit ?? 25), total: rows.length, limit: params.limit ?? 25, offset: 0 }
      },
    },
  }
})

import { ChannelsPage } from "@/pages/channels"

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
    </QueryClientProvider>
  )
}

/** The page request — the one with the list's page size, not a one-row count. */
const pageCalls = () => calls.filter((c) => c.limit !== 1 && c.limit !== 1000)

beforeEach(() => {
  cleanup()
  calls.length = 0
})

describe("channels status default", () => {
  it("asks for active channels when the URL names no status", async () => {
    renderAt("/channels")
    expect(await screen.findByText("orders-get")).toBeInTheDocument()
    expect(pageCalls().every((c) => c.status === "active")).toBe(true)
    expect(screen.queryByText("orders-old")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Filter by status")).toHaveValue("active")
  })

  it("says how many archived channels the default hides", async () => {
    renderAt("/channels")
    expect(await screen.findByText(/1 archived hidden/)).toBeInTheDocument()
  })

  it("shows every status for ?status=all", async () => {
    renderAt("/channels?status=all")
    expect(await screen.findByText("orders-old")).toBeInTheDocument()
    expect(screen.getByText("billing-run")).toBeInTheDocument()
    expect(pageCalls().some((c) => c.status === undefined)).toBe(true)
    expect(screen.getByLabelText("Filter by status")).toHaveValue("all")
    expect(screen.queryByText(/archived hidden/)).not.toBeInTheDocument()
  })

  it("honours an explicit status", async () => {
    renderAt("/channels?status=archived")
    expect(await screen.findByText("orders-old")).toBeInTheDocument()
    expect(screen.queryByText("orders-get")).not.toBeInTheDocument()
  })

  it("searches names in the browser, within the status filter", async () => {
    renderAt("/channels?q=ORDERS")
    expect(await screen.findByText("orders-get")).toBeInTheDocument()
    expect(screen.getByText("orders-list")).toBeInTheDocument()
    // Archived is outside the default status; billing does not match.
    expect(screen.queryByText("orders-old")).not.toBeInTheDocument()
    expect(screen.queryByText("billing-run")).not.toBeInTheDocument()
    await waitFor(() => expect(calls.some((c) => c.limit === 1000)).toBe(true))
  })
})
