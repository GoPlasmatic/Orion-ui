/** Only `off` may tell an operator to enable [metrics]; every other state says what it is. */
import { describe, expect, it, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import type { ChannelTraffic, MetricsState, TrafficWindow } from "@/hooks/use-metrics"
import type { SubsystemMetrics } from "@/hooks/use-ops-metrics"
import { GoldenSignals } from "@/components/operations/golden-signals"
import { MetricsStatePill } from "@/components/operations/metrics-state"

afterEach(cleanup)

const channel = (over: Partial<ChannelTraffic>): ChannelTraffic => ({
  channel: "soma-clock-pair",
  ratePerMin: null,
  windowed: 0,
  ok: 0,
  failed: 0,
  rejected: 0,
  duplicate: 0,
  errorPct: null,
  rejectedPct: null,
  dominantIssue: null,
  byStatus: {},
  p95Ms: null,
  total: 0,
  ...over,
})

function traffic(state: MetricsState, over: Partial<TrafficWindow> = {}): TrafficWindow {
  const available = state === "live" || state === "warming"
  const channels = available
    ? [
        channel({
          windowed: 240,
          ok: 236,
          rejected: 4,
          byStatus: { ok: 236, unauthorized: 4 },
          errorPct: 0,
          p95Ms: 306,
          total: 12_340,
          ratePerMin: state === "live" ? 48 : null,
        }),
      ]
    : []
  return {
    isLoading: state === "loading",
    isError: state === "error",
    state,
    available,
    spanSec: state === "live" ? 300 : 0,
    spanLabel: "",
    activeInBuffer: new Set(),
    hasRate: state === "live",
    lastUpdated: available ? Date.now() : null,
    channels,
    byChannel: new Map(channels.map((c) => [c.channel, c])),
    totalRatePerMin: state === "live" ? 412 : null,
    activeCount: channels.length,
    windowed: available ? 240 : 0,
    errorPct: available ? 0 : null,
    p95Ms: available ? 43 : null,
    meanMs: available ? 20 : null,
    series: { rate: [], errorPct: [], meanMs: [] },
    seriesFor: () => ({ rate: [], errorPct: [] }),
    ...over,
  }
}

const subsystems = (state: MetricsState): SubsystemMetrics => ({
  state,
  spanSec: 0,
  instances: ["soma-qa-1"],
  build: { version: "1.12.0", gitHash: null },
  cache: {
    seen: false,
    hits: null,
    misses: null,
    coalesced: null,
    hitPct: null,
    invalidations: null,
    byChannel: new Map(),
  },
  rateLimit: { rejections: null, keyUnavailable: null, byScope: new Map() },
  dbPool: { size: 6, idle: 6, busy: 0 },
  traces: {
    queueDepth: 0,
    queueBytes: 0,
    workersActive: 4,
    workersTotal: 4,
    persistenceQueueDepth: 0,
    rejected: null,
    dropped: new Map(),
    dlqDepth: 0,
  },
  breakers: { trips: null, rejections: null },
  errors: new Map(),
  reloads: { total: 0, failed: 0 },
  auditDropped: null,
  kafkaDegraded: null,
})

function renderSignals(state: MetricsState) {
  return render(
    <MemoryRouter>
      <GoldenSignals traffic={traffic(state)} subsystems={subsystems(state)} windowLabel="5 min" />
    </MemoryRouter>,
  )
}

const pageText = () => document.body.textContent ?? ""

describe("golden signals by metrics state", () => {
  it("loading shows the tiles' shape and never asks to enable metrics", () => {
    renderSignals("loading")
    expect(screen.getByText("Throughput")).toBeInTheDocument()
    expect(document.querySelectorAll('[aria-busy="true"]').length).toBe(4)
    expect(pageText()).not.toMatch(/enable/i)
    expect(pageText()).not.toMatch(/offline|unavailable|metrics off/i)
  })

  it("warming shows real totals and says when rates arrive", () => {
    renderSignals("warming")
    expect(pageText()).toContain("12,340")
    expect(pageText()).toContain("rates after the next sample")
    expect(pageText()).not.toMatch(/enable/i)
  })

  it("live shows rates, the rejected count and the slowest channel", () => {
    renderSignals("live")
    expect(pageText()).toContain("412")
    expect(pageText()).toContain("4 rejected (401)")
    expect(pageText()).toContain("slowest: soma-clock-pair 306ms")
    expect(pageText()).toContain("0 / 6")
  })

  it("off is the only state that says to enable [metrics]", () => {
    renderSignals("off")
    expect(pageText()).toMatch(/Enable \[metrics\]/)
    expect(screen.queryByText("Throughput")).toBeNull()
  })

  it("error says unreachable, not off", () => {
    renderSignals("error")
    expect(pageText()).toMatch(/The last metrics scrape failed/)
    expect(pageText()).not.toMatch(/enable/i)
  })
})

describe("metrics state pill", () => {
  const now = Date.now()
  it.each([
    ["loading", "loading metrics"],
    ["warming", "rates after the next sample"],
    ["off", "metrics off"],
    ["error", "metrics unreachable"],
  ] as const)("%s reads %s", (state, text) => {
    render(<MetricsStatePill state={state} lastUpdated={null} now={now} paused={false} stale={false} />)
    expect(screen.getByRole("status")).toHaveTextContent(text)
  })

  it("live names the last update; a failed refetch over a held sample says so", () => {
    const { rerender } = render(
      <MetricsStatePill state="live" lastUpdated={now - 4_000} now={now} paused={false} stale={false} />,
    )
    expect(screen.getByRole("status")).toHaveTextContent("live · updated just now")
    rerender(<MetricsStatePill state="live" lastUpdated={now - 40_000} now={now} paused={false} stale />)
    expect(screen.getByRole("status")).toHaveTextContent("last scrape failed · showing 40s ago")
  })
})
