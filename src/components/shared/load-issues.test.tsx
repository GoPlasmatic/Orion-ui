/**
 * What a generation could not load (Orion 1.9).
 *
 * Two things are worth pinning. The four lists come from one collector on the
 * server, so `/health` and `GET admin/engine/status` answer identically — the
 * report renders whichever the page has. And the admin plane is the one that
 * always answers: `/health`'s copy is withheld from a caller the server does
 * not recognise as an admin, so a console on an instance with `admin_auth` on
 * can see coarse components with no detail at all and still need to say what
 * is quarantined.
 */
import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import type { EngineLoadIssues, HealthResponse } from "@/api/types"
import { LoadIssuesReport } from "./load-issues"
import { HealthComponents } from "./health-components"

afterEach(cleanup)

const renderIn = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

const issues: EngineLoadIssues = {
  channels: [
    {
      channel: "nightly-sweep",
      channel_id: "3f0c-uuid",
      workflow_id: "nightly",
      reason: "cron scheduler disabled on this node (cron.enabled = false)",
    },
  ],
  connectors: [
    {
      connector: "billing-api",
      connector_id: "9a1b-uuid",
      stage: "endpoint",
      reason: "url resolved to ftp://…",
    },
  ],
  plugins: [],
  models: [],
}

describe("load issues", () => {
  it("links a quarantined channel by its own id, not its name", () => {
    renderIn(<LoadIssuesReport issues={issues} />)
    // The quarantine is keyed by name, but `/channels/:id` routes on the id —
    // which 1.9 added precisely so the link does not need the channel list.
    expect(screen.getByRole("link", { name: "nightly-sweep" })).toHaveAttribute(
      "href",
      "/channels/3f0c-uuid"
    )
    expect(screen.getByRole("link", { name: "nightly" })).toHaveAttribute("href", "/workflows/nightly")
  })

  it("names the stage that refused a connector", () => {
    renderIn(<LoadIssuesReport issues={issues} />)
    expect(screen.getByRole("link", { name: "billing-api" })).toHaveAttribute(
      "href",
      "/connectors/9a1b-uuid"
    )
    expect(screen.getByText("endpoint")).toBeInTheDocument()
  })

  it("renders nothing when the generation refused nothing", () => {
    const { container } = renderIn(
      <LoadIssuesReport issues={{ channels: [], connectors: [], plugins: [], models: [] }} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("falls back to a pre-1.9 channel issue that carries no id", () => {
    renderIn(
      <LoadIssuesReport
        issues={{
          channels: [{ channel: "orders", reason: "env://ORDERS_KEY is unset" }],
          connectors: [],
          plugins: [],
          models: [],
        }}
      />
    )
    expect(screen.getByRole("link", { name: "orders" })).toHaveAttribute("href", "/channels")
  })
})

describe("the health report's load issues", () => {
  /** Coarse components, no admin detail — what an unauthenticated /health gives. */
  const withheld: HealthResponse = {
    status: "degraded",
    components: { database: "ok", engine: "ok", channels: "degraded" },
    connectors: {},
    workflows_loaded: 0,
    uptime_seconds: 1,
    version: "1.9.0",
  }

  it("uses the admin plane's answer when /health withheld its detail", () => {
    renderIn(<HealthComponents health={withheld} loadIssues={issues} />)
    expect(screen.getByText(/1 channel quarantined on this node/)).toBeInTheDocument()
  })

  it("falls back to /health's own lists when there is no engine answer", () => {
    const detailed: HealthResponse = {
      ...withheld,
      channels: { quarantined: issues.channels },
    }
    renderIn(<HealthComponents health={detailed} />)
    expect(screen.getByText(/1 channel quarantined on this node/)).toBeInTheDocument()
  })

  it("says nothing when a pre-1.9 server cannot tell us", () => {
    renderIn(<HealthComponents health={withheld} loadIssues={null} />)
    expect(screen.queryByText(/quarantined on this node/)).not.toBeInTheDocument()
  })
})
