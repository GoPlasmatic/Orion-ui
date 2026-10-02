/**
 * The trace page's step section around the timeline: the selection lives in
 * `?step=`, and a run with no step data says why instead of drawing nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import type { Channel, TraceDetail } from "@/api/types"
import { CATALOGUE, COSTS, TRACE, WORKFLOW } from "./__fixtures__/trace-64b46dde"
import { TraceSteps } from "./trace-steps"

vi.mock("@/hooks/use-workflows", () => ({
  useActiveWorkflow: () => ({ workflow: WORKFLOW, isLoading: false }),
}))
vi.mock("@/hooks/use-ops-metrics", () => ({
  useWorkflowCost: () => ({ state: "live", tasks: COSTS }),
}))
vi.mock("@/hooks/use-functions", () => ({ useFunctions: () => ({ data: CATALOGUE }) }))
vi.mock("@/hooks/use-connectors", () => ({
  useConnectors: () => ({ data: { data: [{ id: "c-cache", name: "soma-cache" }] } }),
}))

afterEach(cleanup)

const trace = { ...TRACE, created_at: TRACE.started_at!, channel_id: "ch-1" } as TraceDetail
const channel = (tracing: Record<string, unknown>, status = "active") =>
  ({
    channel_id: "ch-1",
    name: "soma-clock-pair",
    workflow_id: "soma-clock-pair-run",
    status,
    config: { tracing },
  }) as unknown as Channel

const renderAt = (url: string, t: TraceDetail, ch?: Channel) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <TraceSteps trace={t} channel={ch} />
    </MemoryRouter>,
  )

describe("TraceSteps", () => {
  it("selects the failing step by default and opens its connector", () => {
    renderAt("/traces/x", trace, channel({ task_details: true }))
    const detail = screen.getByRole("region", { name: "Step bump_work.bump" })
    expect(within(detail).getByRole("link", { name: /Open soma-cache/ })).toHaveAttribute("href", "/connectors/c-cache")
    expect(screen.getByText(/Snapshots from step 11 \(bump_work.bump\) on were dropped/)).toBeInTheDocument()
    expect(screen.getByText("Not reached: after.")).toBeInTheDocument()
  })

  it("reads the selection from ?step=", () => {
    renderAt("/traces/x?step=2", trace, channel({ task_details: true }))
    expect(screen.getByRole("region", { name: "Step demand" })).toBeInTheDocument()
  })

  it("explains a channel that keeps no steps, with a way to change it", () => {
    renderAt("/traces/x", { ...trace, task_trace_json: undefined }, channel({ task_details: false }))
    expect(screen.getByText(/does not keep step data/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Open the channel/ })).toHaveAttribute("href", "/channels/ch-1")
  })

  it("explains errors_only on a run that succeeded", () => {
    renderAt(
      "/traces/x",
      { ...trace, status: "completed", error: undefined, task_trace_json: undefined },
      channel({ task_details: true, errors_only: true }, "draft"),
    )
    expect(screen.getByText(/keeps step data for failed runs only/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Edit the channel's tracing/ })).toHaveAttribute("href", "/channels/ch-1/edit")
  })
})
