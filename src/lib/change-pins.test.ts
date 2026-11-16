// @vitest-environment node
import { describe, expect, it } from "vitest"
import { buildChangePins, changeText, pinTitle, type ChangeNote } from "@/lib/change-pins"
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

  // A 2.0 change is a deployment: one audit row for a whole revision, naming
  // the revision rather than the channels it changed. Pinning it means reading
  // that revision's diff against its parent — phase 6 of the port
  // (PLAN-2.0.md). Until then nothing is pinned rather than something wrong.
  it("pins nothing for a 2.0 deployment row yet", () => {
    const pins = buildChangePins(
      [
        row({ resource_type: "deployment", resource_id: "4", action: "v2_deployment_apply" }),
        row({ resource_type: "deployment", resource_id: "5", action: "v2_deployment_rollback" }),
        row({ resource_type: "channel", resource_id: "uuid-soma-c", action: "trigger" }),
      ],
      graph,
    )
    expect(pins.size).toBe(0)
  })
})

describe("change wording", () => {
  const note = (verb: string, at: string, over: Partial<ChangeNote> = {}): ChangeNote => ({
    id: at,
    verb,
    resource: "channel",
    version: null,
    principal: "ops",
    at,
    ...over,
  })

  it("words a pin and its hover, newest first", () => {
    const notes = [note("deployed", "2026-10-02T09:00:00Z", { version: 2 }), note("rolled back", "2026-10-02T08:00:00Z")]
    const now = Date.parse("2026-10-02T12:00:00Z")
    expect(changeText(notes[0], now)).toBe("deployed v2 · 3h ago")
    expect(pinTitle(notes, now)).toBe("deployed v2 · 3h ago\nrolled back · 4h ago")
    expect(pinTitle(undefined)).toBeNull()
  })
})
