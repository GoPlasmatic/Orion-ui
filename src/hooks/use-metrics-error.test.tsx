import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { ApiError } from "@/api/client"

vi.mock("@/api/metrics", async (orig) => {
  const actual = await orig<typeof import("@/api/metrics")>()
  return { ...actual, fetchMetrics: vi.fn() }
})

const { fetchMetrics } = await import("@/api/metrics")
const { useChannelTraffic } = await import("@/hooks/use-metrics")

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe("useChannelTraffic state on a failed scrape", () => {
  it("reads a 401 as unreachable, not off", async () => {
    vi.mocked(fetchMetrics).mockRejectedValue(new ApiError(401, "Unauthorized"))
    const { result } = renderHook(() => useChannelTraffic(300), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.state).toBe("error")
  })
  it("reads a 404 as off", async () => {
    vi.mocked(fetchMetrics).mockRejectedValue(new ApiError(404, "Not Found"))
    const { result } = renderHook(() => useChannelTraffic(300), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.state).toBe("off")
  })
})

describe("metricsState while a first fetch waits", () => {
  it("reads pending-without-fetching (a retry paused in a background tab) as loading", async () => {
    const { metricsState } = await import("@/hooks/use-metrics")
    // isPending true, not fetching, no error, no sample.
    expect(metricsState({ available: false, hasRate: false }, true, false, null)).toBe("loading")
  })
})
