/**
 * The workflow page's lens switcher: the lens lives in `?lens=`, switching
 * changes what is drawn, Structure opens on the whole pipeline rather than an
 * empty explorer, and `?trace=` pins the run the Last run lens lays over the
 * steps. Driven by QA's "Clock: pair" and its failed trace 64b46dde.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { useState } from "react"
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach } from "vitest"
import type { Channel } from "@/api/types"
import { clockPair, clockPairCatalogue, clockPairCost, failedRun } from "@/lib/workflow-lens.fixture"
import { deployedChannel, deployedPlugin, setDeployed } from "@/test/deployed-api"

const channel: Channel = deployedChannel({
  channel_id: "c-1",
  name: "soma-clock-pair",
  channel_type: "async",
  protocol: "cron",
  transport_config: { schedule: "*/15 * * * * *" },
  workflow_id: "soma-clock-pair-run",
  config: { tracing: { task_details: true, errors_only: true } },
})

// A stand-in for the dataflow-ui visualizer with its starting state: nothing
// selected (an empty pane) unless the host asks for `initialSelection`.
vi.mock("@goplasmatic/dataflow-ui", () => ({
  WorkflowVisualizer: ({
    workflows,
    initialSelection,
  }: {
    workflows: { name: string }[]
    initialSelection?: string
  }) => {
    const [selected] = useState<string | null>(initialSelection === "first-workflow" ? workflows[0].name : null)
    return <p>{selected ? `flow diagram: ${selected}` : "Select an item from the explorer"}</p>
  },
}))

vi.mock("@/api/functions", () => ({ functionsApi: { list: async () => clockPairCatalogue } }))
vi.mock("@/hooks/use-ops-metrics", () => {
  const cost = { ...clockPairCost, state: "live", workflow: "soma-clock-pair-run", taskMsPerRun: 124.9 }
  return { useWorkflowCost: () => cost }
})
// The head: this workflow, its cron channel, the plugin and the two connections it requires.
vi.mock("@/api/deployments", async () => (await import("@/test/deployed-api")).deploymentsModule())
vi.mock("@/api/definitions", async () => (await import("@/test/deployed-api")).definitionsModule())
vi.mock("@/api/traces", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/api/traces")>()
  const row = {
    id: failedRun.id,
    channel: "soma-clock-pair",
    status: "failed",
    mode: "cron",
    error_message: failedRun.error,
    duration_ms: 8362,
    created_at: failedRun.created_at,
    started_at: failedRun.started_at,
    completed_at: failedRun.completed_at,
    updated_at: failedRun.created_at,
  }
  return {
    ...mod,
    tracesApi: {
      ...mod.tracesApi,
      list: async (params: { status?: string }) => ({ data: params.status && params.status !== "failed" ? [] : [row], limit: 3, offset: 0 }),
      get: async () => failedRun,
    },
  }
})

import { WorkflowLenses } from "@/components/workflow/workflow-lenses"

/** The read-outs under a lens, as whole sentences (each is split across code and bold runs). */
const readouts = (label: string) =>
  within(screen.getByRole("list", { name: label }))
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "")

function Search() {
  return <output data-testid="search">{useLocation().search}</output>
}

function renderAt(url: string, runsOn: Channel[] = [channel]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <WorkflowLenses workflow={clockPair} runsOn={runsOn} />
        <Search />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(cleanup)
beforeEach(() =>
  setDeployed({
    channels: [channel],
    workflows: [clockPair],
    plugins: [deployedPlugin({ plugin_id: "tb.pairing", revision: 2, functions: ["tb.pairing.pair"] })],
    connections: ["soma-db", "soma-cache"],
  }),
)

describe("WorkflowLenses", () => {
  it("opens on Structure, with the whole pipeline selected rather than an empty pane", async () => {
    renderAt("/workflows/soma-clock-pair-run")
    expect(screen.getByRole("button", { name: "Structure" })).toHaveAttribute("aria-pressed", "true")
    expect(await screen.findByText("flow diagram: Clock: pair")).toBeInTheDocument()
    expect(screen.queryByText("Select an item from the explorer")).not.toBeInTheDocument()
  })

  it("respects ?lens= and switches lenses through the URL", async () => {
    renderAt("/workflows/soma-clock-pair-run?lens=cost")
    expect(screen.getByRole("button", { name: "Cost" })).toHaveAttribute("aria-pressed", "true")
    expect(await screen.findByText("Share of a run")).toBeInTheDocument()
    expect(screen.getByText(/demand is 68% of a typical run/)).toBeInTheDocument()
    expect(screen.getByText("engine overhead")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Dependencies" }))
    expect(screen.getByTestId("search")).toHaveTextContent("lens=deps")
    expect(screen.queryByText("Share of a run")).not.toBeInTheDocument()
    const table = screen.getByRole("table", { name: "What each step touches" })
    expect(within(table).getByText("soma-db")).toBeInTheDocument()
    expect(within(table).getAllByText("read")).toHaveLength(3)
    expect(await screen.findByText("3 read · 1 write")).toBeInTheDocument()
    expect(await screen.findByText(/serves only this workflow/)).toBeInTheDocument()
    expect(readouts("Dependency read-outs")[0]).toMatch(/^soma-cache is used once, by the last step, bump_work.bump, after insert/)
    expect(screen.getByRole("link", { name: /Open in System Map/ })).toHaveAttribute(
      "href",
      "/system-map?select=soma-clock-pair",
    )

    fireEvent.click(screen.getByRole("button", { name: "Structure" }))
    expect(screen.getByTestId("search")).toHaveTextContent(/^$/)
  })

  it("lays the trace named in ?trace= over the steps", async () => {
    renderAt(`/workflows/soma-clock-pair-run?lens=run&trace=${failedRun.id}`)
    expect(await screen.findByText("Trace 64b46dde")).toBeInTheDocument()
    expect(screen.getByText("from the link")).toBeInTheDocument()
    const [healthy, failure] = readouts("Last run read-outs")
    expect(healthy).toBe("10 steps ran in 92.9 ms, each inside its p95.")
    expect(failure).toMatch(/8.12 s in bump_work.bump, about 11,600× its p95/)
    expect(screen.getByText("failed", { selector: "span" })).toBeInTheDocument()
    expect(screen.getByText("temp_data.s.inserted")).toBeInTheDocument()
  })

  it("finds the newest failed run with step data when no trace is named", async () => {
    renderAt("/workflows/soma-clock-pair-run?lens=run")
    expect(await screen.findByText("Trace 64b46dde")).toBeInTheDocument()
    expect(screen.getByText("newest failed run with step data")).toBeInTheDocument()
  })

  it("says why there is no run to show when the channel records no steps", async () => {
    renderAt("/workflows/soma-clock-pair-run?lens=run", [{ ...channel, config: { tracing: { task_details: false } } }])
    expect(await screen.findByText(/tracing.task_details is off/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "soma-clock-pair" })).toHaveAttribute("href", "/channels/c-1")
  })
})
