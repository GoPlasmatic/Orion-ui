/**
 * Render guard for the 2.0 `/health` report.
 *
 * The component keys changed with the deployment model: `engine_reload` now
 * means the last build of the desired revision failed, `cron` is the scheduler,
 * and 1.x's `models`, `packages`, `kafka`, `config_propagation` and
 * `cluster_redis` are gone. The load issues are the same three lists the engine
 * reports, rendered once through `LoadIssuesReport`.
 */
import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import type { HealthResponse } from "@/api/types"
import { HealthComponents } from "./health-components"

afterEach(cleanup)

const health: HealthResponse = {
  status: "degraded",
  components: {
    database: "ok",
    engine: "ok",
    connectors: "degraded",
    channels: "ok",
    background_tasks: "ok",
    engine_reload: "degraded",
    plugins: "disabled",
    cron: "ok",
  },
  connectors: {
    failed_to_load: [
      { connector: "orders-db", connector_id: "orders-db", stage: "secret_resolution", reason: "no secret" },
    ],
  },
  cron: { scheduled_channels: 2, oldest_pending_age_secs: 12, reconcile_age_secs: 5 },
  workflows_loaded: 3,
  uptime_seconds: 60,
  version: "2.0.0",
}

const renderReport = () =>
  render(
    <MemoryRouter>
      <HealthComponents health={health} />
    </MemoryRouter>
  )

describe("the 2.0 health report", () => {
  it("names the components this server serves", () => {
    renderReport()
    for (const name of ["engine_reload", "background_tasks", "plugins", "cron"]) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    // 1.x's components are not on a 2.0 node.
    expect(screen.queryByText("models")).not.toBeInTheDocument()
    expect(screen.queryByText("packages")).not.toBeInTheDocument()
  })

  it("renders a failed connection load as a link to its connection", () => {
    renderReport()
    const link = screen.getByRole("link", { name: "orders-db" })
    expect(link).toHaveAttribute("href", "/connections/orders-db")
    expect(screen.getByText(/secret_resolution/)).toBeInTheDocument()
  })

  it("reads the scheduler's own numbers", () => {
    renderReport()
    expect(screen.getByText("Scheduler")).toBeInTheDocument()
    expect(screen.getByText("Scheduled channels")).toBeInTheDocument()
    expect(screen.getByText(/5s ago/)).toBeInTheDocument()
  })
})
