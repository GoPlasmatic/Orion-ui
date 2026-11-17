// @vitest-environment node
import { describe, expect, it } from "vitest"
import { buildChangePins, changeText, pinTitle, type ChangeNote } from "@/lib/change-pins"
import { buildIndex } from "@/lib/topology"
import { buildSystemGraph } from "@/lib/system-graph"
import type { Channel, DeploymentRevision, ManifestMember, Workflow } from "@/api/types"

const channel = (name: string, workflow_id: string, cacheConnector?: string) =>
  ({
    channel_id: `id-${name}`,
    name,
    workflow_id,
    tags: [],
    config: cacheConnector ? { cache: { enabled: true, connector: cacheConnector } } : {},
    methods: [],
    transport_config: {},
  }) as unknown as Channel
const workflow = (id: string) => ({ workflow_id: id, name: id, tasks: [] }) as unknown as Workflow

const member = (kind: ManifestMember["entity"]["kind"], id: string, revision: number, digest = `${id}-${revision}`): ManifestMember => ({
  entity: { kind, id, revision },
  definition_digest: `sha256:${digest}`,
})

const rev = (revision: number, parent: number | null, members: ManifestMember[], compacted = false): DeploymentRevision => ({
  revision,
  parent_revision: parent,
  manifest_digest: `m${revision}`,
  member_count: members.length,
  reason: "",
  created_by: "key-ops",
  members_compacted: compacted,
  created_at: `2026-11-17T0${revision}:00:00Z`,
  manifest: { schema_version: 2, providers: [], members: compacted ? [] : members },
})

describe("buildChangePins", () => {
  const graph = buildSystemGraph(
    buildIndex(
      [channel("soma-a", "wf-shared"), channel("soma-b", "wf-shared"), channel("soma-c", "wf-c", "cache-1")],
      [workflow("wf-shared"), workflow("wf-c")],
      [],
    ),
  )
  const base = [
    member("channel", "id-soma-a", 1),
    member("channel", "id-soma-b", 1),
    member("channel", "id-soma-c", 1),
    member("workflow", "wf-shared", 1),
    member("workflow", "wf-c", 1),
    member("connection", "cache-1", 1),
  ]
  const r1 = rev(1, null, base)
  const r2 = rev(2, 1, base.map((m) => (m.entity.id === "wf-shared" ? member("workflow", "wf-shared", 2) : m)))
  const r3 = rev(3, 2, r2.manifest.members.map((m) => (m.entity.id === "cache-1" ? member("connection", "cache-1", 2) : m)))
  const byRev = new Map([r1, r2, r3].map((r) => [r.revision, r]))

  it("lands a revision's changes on the channels they reach, newest first", () => {
    const pins = buildChangePins([r3, r2], (n) => byRev.get(n), graph)
    // A workflow change reaches every channel running it.
    expect(pins.get("soma-a")?.map((n) => [n.deployment, n.resource, n.verb, n.revision])).toEqual([[2, "workflow", "changed", 2]])
    expect(pins.get("soma-b")).toHaveLength(1)
    // A connection change reaches the channel whose config names it.
    expect(pins.get("soma-c")?.map((n) => [n.deployment, n.resource, n.member])).toEqual([[3, "connection", "cache-1"]])
  })

  it("pins nothing for a revision it cannot diff", () => {
    // The parent is not loaded: that is not "everything was added".
    expect(buildChangePins([r3], () => undefined, graph).size).toBe(0)
    const compacted = rev(2, 1, [], true)
    expect(buildChangePins([compacted], (n) => byRev.get(n), graph).size).toBe(0)
  })
})

describe("change wording", () => {
  const note = (over: Partial<ChangeNote>): ChangeNote => ({
    id: "x",
    deployment: 12,
    verb: "changed",
    resource: "workflow",
    member: "orders",
    revision: 3,
    principal: "key-ops",
    at: "2026-11-17T09:00:00Z",
    ...over,
  })

  it("words a pin and its hover, newest first", () => {
    const now = Date.parse("2026-11-17T12:00:00Z")
    expect(changeText(note({}), now)).toBe("workflow orders changed r3 · deployment 12 · 3h ago")
    expect(changeText(note({ resource: "channel", verb: "removed", at: "2026-11-17T08:00:00Z" }), now)).toBe(
      "removed · deployment 12 · 4h ago",
    )
    expect(pinTitle([note({}), note({ resource: "channel", verb: "added", revision: 1 })], now)).toBe(
      "workflow orders changed r3 · deployment 12 · 3h ago\nadded r1 · deployment 12 · 3h ago",
    )
    expect(pinTitle(undefined)).toBeNull()
  })
})
