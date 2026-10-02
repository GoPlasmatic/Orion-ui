/**
 * The trace timeline, drawn from the real failed run on QA (trace 64b46dde):
 * ten steps in 93 ms, then an 8.1 s hang in `bump_work.bump` before Redis
 * refused. What a person must be able to see: which step failed, how long
 * each took, and an axis that keeps the 9 µs steps readable.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { functionIndex, stepEffect } from "@/lib/function-effects"
import { buildTimeline } from "@/lib/trace-timeline"
import { TraceTimeline } from "./trace-timeline"
import { StepDetail } from "./step-detail"
import { CATALOGUE, COSTS, TRACE, WORKFLOW } from "./__fixtures__/trace-64b46dde"

afterEach(cleanup)

const timeline = buildTimeline(TRACE, WORKFLOW)!
const index = functionIndex(CATALOGUE)
const effects = timeline.steps.map((s) => (s.task ? stepEffect(s.task, index) : null))

function renderTimeline(onSelect = vi.fn(), selected: number | null = timeline.failed!.index) {
  render(
    <TraceTimeline
      timeline={timeline}
      effects={effects}
      costs={COSTS}
      selected={selected}
      onSelect={onSelect}
      mode="cron"
      loopBinding={{ as: "it", over: "temp_data.plan" }}
    />,
  )
  return onSelect
}

const rowFor = (taskId: string) => {
  const table = screen.getByRole("table", { name: "Step timeline" })
  return within(table)
    .getAllByRole("row")
    .find((r) => r.getAttribute("data-step") != null && within(r).queryByText(taskId, { exact: true }))!
}

describe("TraceTimeline", () => {
  it("marks the failing step, selected, in a row of its own", () => {
    renderTimeline()
    const row = rowFor("bump_work.bump")
    expect(row).toHaveAttribute("aria-selected", "true")
    expect(within(row).getByText(/Failed/)).toBeInTheDocument()
    expect(within(row).getByText("8.12 s")).toBeInTheDocument()
    expect(within(row).getByText("11,600×")).toBeInTheDocument()
    expect(rowFor("insert")).toHaveAttribute("aria-selected", "false")
    expect(within(rowFor("insert")).queryByText(/Failed/)).toBeNull()
  })

  it("renders every step's duration and what it uses", () => {
    renderTimeline()
    expect(within(rowFor("demand")).getByText("74.3 ms")).toBeInTheDocument()
    expect(within(rowFor("demand")).getByText("0.3×")).toBeInTheDocument()
    expect(within(rowFor("picked")).getByText("9 µs")).toBeInTheDocument()
    expect(within(rowFor("picked")).getByText("halts the run")).toBeInTheDocument()
    expect(within(rowFor("pick")).getByText("1.50 ms")).toBeInTheDocument()
    expect(within(rowFor("plan")).getByText("in memory")).toBeInTheDocument()
    expect(within(rowFor("bump_work.bump")).getByText("soma-cache")).toBeInTheDocument()
  })

  it("leads with the headline: the share in one step and the engine's own time", () => {
    renderTimeline()
    expect(screen.getByText("In one step")).toBeInTheDocument()
    expect(screen.getByText("97%")).toBeInTheDocument()
    expect(screen.getByText("bump_work.bump · 8.12 s")).toBeInTheDocument()
    expect(screen.getByText("Other 10 steps")).toBeInTheDocument()
    expect(screen.getByText("10 hand-offs")).toBeInTheDocument()
    expect(screen.getByText("trace + occurrence write", { selector: "p" })).toBeInTheDocument()
  })

  it("groups the loop: setup once, then the iteration with its binding", () => {
    renderTimeline()
    expect(screen.getByText("loop.setup", { selector: "span" })).toBeInTheDocument()
    expect(screen.getByText(/it = temp_data\.plan\[0\]/)).toBeInTheDocument()
    expect(screen.getByText("admission", { selector: "span" })).toBeInTheDocument()
  })

  it("opens on the split axis and switches to linear", () => {
    renderTimeline()
    const axis = () => screen.getByTestId("time-axis")
    expect(screen.getByRole("button", { name: "Split axis" })).toHaveAttribute("aria-pressed", "true")
    expect(within(axis()).getByText("100 ms")).toBeInTheDocument()
    expect(within(axis()).queryByText("2 s")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Linear" }))
    expect(screen.getByRole("button", { name: "Linear" })).toHaveAttribute("aria-pressed", "true")
    expect(within(axis()).getByText("2 s")).toBeInTheDocument()
    expect(within(axis()).queryByText("100 ms")).toBeNull()
    expect(within(axis()).getByText("8.36 s")).toBeInTheDocument()
  })

  it("follows the data until the person picks an axis", () => {
    // Re-polled mid-run: ten quick steps, then the hang lands on the next poll.
    const early = buildTimeline(
      {
        ...TRACE,
        status: "running",
        completed_at: "2026-10-02T05:41:15.936000",
        task_trace_json: { steps: (TRACE.task_trace_json as { steps: unknown[] }).steps.slice(0, 10) },
      },
      WORKFLOW,
    )!
    const props = { effects, costs: COSTS, selected: null, onSelect: vi.fn(), mode: "cron" }
    const { rerender } = render(<TraceTimeline timeline={early} {...props} />)
    const linear = () => screen.getByRole("button", { name: "Linear" })
    expect(linear()).toHaveAttribute("aria-pressed", "true")
    rerender(<TraceTimeline timeline={timeline} {...props} />)
    expect(screen.getByRole("button", { name: "Split axis" })).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(linear())
    rerender(<TraceTimeline timeline={buildTimeline(TRACE, WORKFLOW)!} {...props} />)
    expect(linear()).toHaveAttribute("aria-pressed", "true")
  })

  it("selects a step by pointer and by keyboard", () => {
    const onSelect = renderTimeline()
    fireEvent.click(rowFor("insert"))
    expect(onSelect).toHaveBeenLastCalledWith(8)
    fireEvent.keyDown(rowFor("demand"), { key: "Enter" })
    expect(onSelect).toHaveBeenLastCalledWith(2)
  })
})

describe("StepDetail", () => {
  const renderDetail = (i: number) =>
    render(
      <MemoryRouter>
        <StepDetail
          step={timeline.steps[i]}
          timeline={timeline}
          effect={effects[i]}
          costState="live"
          cost={COSTS.get(timeline.steps[i].taskId)}
          index={index}
          trace={TRACE}
          workflowId="soma-clock-pair-run"
          connectorId="c-cache"
        />
      </MemoryRouter>,
    )

  it("says what failed, what it normally takes and what already happened", () => {
    renderDetail(timeline.failed!.index)
    expect(screen.getByText(/Redis INCRBY failed/)).toBeInTheDocument()
    expect(screen.getByText("Normal (185 iterations)")).toBeInTheDocument()
    expect(screen.getByText("dropped · trace truncated")).toBeInTheDocument()
    expect(screen.getByText("Before this step")).toBeInTheDocument()
    expect(screen.getByText("insert")).toBeInTheDocument()
    expect(screen.getByText(/finished 793 µs earlier/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Show on workflow/ })).toHaveAttribute(
      "href",
      `/workflows/soma-clock-pair-run?lens=run&trace=${TRACE.id}`,
    )
    expect(screen.getByRole("link", { name: /Same step, other traces/ })).toHaveAttribute(
      "href",
      "/traces?channel=soma-clock-pair&status=failed",
    )
    expect(screen.getByRole("link", { name: /Open soma-cache/ })).toHaveAttribute("href", "/connectors/c-cache")
  })

  it("shows a step's writes and expands their values", () => {
    renderDetail(8)
    expect(screen.queryByText("Before this step")).toBeNull()
    expect(screen.getByText("temp_data.s.inserted")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show values" }))
    expect(screen.getAllByText("temp_data.s.inserted")).toHaveLength(2)
  })

  it("names the metrics state when there is no baseline", () => {
    render(
      <MemoryRouter>
        <StepDetail
          step={timeline.steps[0]}
          timeline={timeline}
          effect={effects[0]}
          costState="off"
          cost={undefined}
          index={index}
          trace={TRACE}
          workflowId={null}
          connectorId={null}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText("metrics off")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Show on workflow/ })).toBeNull()
  })
})
