import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import type { AuditLog, EngineStatus } from "@/api/types"
import { InstanceStrip } from "@/components/operations/instance-strip"

afterEach(cleanup)

const NOW = Date.parse("2026-10-02T12:00:00Z")

const engine = (over: Partial<EngineStatus> = {}): EngineStatus => ({
  workflows_count: 60,
  active_workflows: 60,
  channels: ["soma-gate-start"],
  uptime_seconds: 41 * 60,
  version: "2.0.0",
  generation: 1,
  load_issues: { channels: [], plugins: [], connectors: [] },
  capabilities: { cron: true, plugins: true },
  ...over,
})

const change = (action: string): AuditLog => ({
  id: "a1",
  principal: "admin",
  action,
  resource_type: "channel",
  resource_id: "c-1",
  created_at: "2026-10-01T18:00:00",
})

function strip(props: { engine?: EngineStatus; action?: string }) {
  render(
    <MemoryRouter>
      <InstanceStrip
        engine={props.engine ?? engine()}
        instances={["soma-qa-1"]}
        gitHash={null}
        nodeId={null}
        lastChange={props.action ? change(props.action) : null}
        resourceName={() => "soma-gate-start"}
        now={NOW}
      />
    </MemoryRouter>,
  )
  return document.body.textContent ?? ""
}

describe("instance strip", () => {
  it.each([
    ["v2_deployment_apply", "soma-gate-start deployed"],
    ["v2_deployment_rollback", "soma-gate-start rolled back"],
    ["v2_package_admit", "soma-gate-start admitted"],
    ["some_new_action", "soma-gate-start some new action"],
  ])("reads the audit action %s as a verb", (action, text) => {
    expect(strip({ action })).toContain(text)
  })

  it("says what the node runs", () => {
    const text = strip({})
    expect(text).toContain("soma-qa-1")
    expect(text).toContain("2.0.0")
    expect(text).toContain("gen 1")
    expect(text).toContain("load issues 0")
    expect(text).toContain("cron on")
    expect(text).toContain("plugins on")
    expect(text).not.toContain("models")
  })

  it("counts the quarantined entities the generation reported", () => {
    expect(
      strip({
        engine: engine({
          load_issues: {
            channels: [{ channel: "orders", channel_id: "uuid-orders", reason: "no secret" }],
            connectors: [],
            plugins: [],
          },
        }),
      }),
    ).toContain("load issues 1")
  })
})
