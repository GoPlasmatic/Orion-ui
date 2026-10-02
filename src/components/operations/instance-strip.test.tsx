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
  version: "1.12.0",
  generation: 1,
  load_issues: { channels: [], plugins: [], models: [], connectors: [] },
  capabilities: { cron: true, plugins: true, models: false },
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
    ["create_version", "soma-gate-start new version"],
    ["update_rollout", "soma-gate-start rollout changed"],
    ["status_active", "soma-gate-start activated"],
    ["some_new_action", "soma-gate-start some new action"],
  ])("reads the audit action %s as a verb", (action, text) => {
    expect(strip({ action })).toContain(text)
  })

  it("says what the node runs", () => {
    const text = strip({})
    expect(text).toContain("soma-qa-1")
    expect(text).toContain("1.12.0")
    expect(text).toContain("gen 1")
    expect(text).toContain("load issues 0")
    expect(text).toContain("models off")
  })

  it("an absent load-issue report is unknown, not zero", () => {
    expect(strip({ engine: engine({ load_issues: undefined }) })).toContain("load issues unknown")
  })
})
