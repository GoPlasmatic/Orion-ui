// @vitest-environment node
import { describe, expect, it } from "vitest"
import { buildChangePins, changeText, pinTitle } from "@/components/graph/change-pins"
import { buildIndex } from "@/lib/topology"
import { buildSystemGraph } from "@/lib/system-graph"
import type { AuditLog, Channel, Workflow } from "@/api/types"

const channel = (name: string, workflow_id: string) =>
  ({ channel_id: `uuid-${name}`, name, workflow_id, status: "active", tags: [], config: {}, methods: [] }) as unknown as Channel
const workflow = (id: string) => ({ workflow_id: id, name: id, tasks: [], status: "active" }) as unknown as Workflow

const row = (over: Partial<AuditLog>): AuditLog => ({
  id: Math.random().toString(36),
  principal: "ops",
  action: "update",
  resource_type: "channel",
  resource_id: "",
  details: null,
  created_at: "2026-10-02T10:00:00",
  ...over,
})

describe("buildChangePins", () => {
  const graph = buildSystemGraph(
    buildIndex(
      [channel("soma-a", "wf-shared"), channel("soma-b", "wf-shared"), channel("soma-c", "wf-c")],
      [workflow("wf-shared"), workflow("wf-c")],
      [],
    ),
  )

  it("pins a channel row by UUID and a workflow row on every channel running it", () => {
    const pins = buildChangePins(
      [
        row({ resource_id: "uuid-soma-c", action: "status_active", details: '{"version":3}', created_at: "2026-10-02T09:00:00" }),
        row({ resource_type: "workflow", resource_id: "wf-shared", action: "create_version", created_at: "2026-10-02T11:00:00" }),
        row({ resource_id: "uuid-soma-c", action: "test" }),
        row({ resource_type: "connector", resource_id: "soma-db" }),
      ],
      graph,
    )
    expect([...pins.keys()].sort()).toEqual(["soma-a", "soma-b", "soma-c"])
    expect(pins.get("soma-c")).toHaveLength(1)
    expect(pins.get("soma-c")![0]).toMatchObject({ verb: "activated", version: 3, resource: "channel" })
    expect(pins.get("soma-a")![0]).toMatchObject({ verb: "new version", resource: "workflow" })
  })

  it("orders newest first and words the pin", () => {
    const pins = buildChangePins(
      [
        row({ resource_id: "uuid-soma-a", action: "update", created_at: "2026-10-02T08:00:00" }),
        row({ resource_id: "uuid-soma-a", action: "status_active", details: '{"version":2}', created_at: "2026-10-02T09:00:00" }),
      ],
      graph,
    )
    const notes = pins.get("soma-a")!
    expect(notes.map((n) => n.verb)).toEqual(["activated", "edited"])
    const now = Date.parse("2026-10-02T12:00:00Z")
    expect(changeText(notes[0], now)).toBe("activated v2 · 3h ago")
    expect(pinTitle(notes, now)).toBe("activated v2 · 3h ago\nedited · 4h ago")
    expect(pinTitle(undefined)).toBeNull()
  })
})
