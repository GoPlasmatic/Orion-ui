// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { ManifestMember, StoredDefinition } from "@/api/types"
import { buildRegistry, channelsRunning, revisionBundle, workflowShares } from "@/lib/deployed-registry"
import { withoutComponentBytes } from "@/hooks/use-deployments"

const wf = (id: string, revision: number, digest: string, requires: ManifestMember["requires"] = []): ManifestMember => ({
  entity: { kind: "workflow", id, revision },
  definition_digest: digest,
  requires,
})

const defs: Record<string, StoredDefinition> = {
  "sha256:ch": {
    kind: "channel",
    definition: {
      name: "orders-api",
      description: null,
      channel_type: "sync",
      protocol: "REST",
      methods: ["POST"],
      route_pattern: "/orders",
      transport_config: {},
      config: { cache: { enabled: true } },
      priority: 2,
      tags: ["shop"],
    },
  },
  "sha256:w1": { kind: "workflow", definition: { name: "Orders v1", tasks: [{ id: "a", function: { name: "map" } }], on_failure: "fail" } },
  "sha256:w2": { kind: "workflow", definition: { name: "Orders v2", tasks: [], on_failure: "continue", loop: null } },
  "sha256:pl": {
    kind: "plugin",
    definition: { manifest: { abi: "orion:plugin@1.0.0", version: "0.3.0", functions: [{ name: "acme.codec.decode" }] }, tags: [] },
    component: { size_bytes: 12, digest: "sha256:comp" },
  },
}

const members: ManifestMember[] = [
  {
    entity: { kind: "channel", id: "orders", revision: 4 },
    definition_digest: "sha256:ch",
    requires: [
      { kind: "workflow", id: "orders", revision: 1 },
      { kind: "workflow", id: "orders", revision: 2 },
      { kind: "connection", id: "db", revision: 3 },
    ],
    rollouts: [
      { workflow_revision: 1, start_bucket: 0, end_bucket: 80 },
      { workflow_revision: 2, start_bucket: 80, end_bucket: 100 },
    ],
  },
  wf("orders", 1, "sha256:w1"),
  wf("orders", 2, "sha256:w2"),
  { entity: { kind: "plugin", id: "acme.codec", revision: 1 }, definition_digest: "sha256:pl" },
  { entity: { kind: "connection", id: "db", revision: 3 }, definition_digest: "sha256:cfg" },
  wf("orphan", 1, "sha256:missing"),
]

describe("buildRegistry", () => {
  const registry = buildRegistry(members, (d) => defs[d])

  it("takes identity from the member and everything else from the definition, as the server's rows do", () => {
    const [ch] = registry.channels
    expect(ch).toMatchObject({
      channel_id: "orders",
      name: "orders-api",
      revision: 4,
      digest: "sha256:ch",
      protocol: "rest",
      workflow_id: "orders",
      route_pattern: "/orders",
      priority: 2,
      tags: ["shop"],
    })
    expect(ch.rollouts).toHaveLength(2)
  })

  it("keeps every revision of a canary workflow and names the larger share primary", () => {
    expect(registry.workflowRevisions.map((w) => w.revision)).toEqual([2, 1])
    expect(registry.workflows).toHaveLength(1)
    expect(registry.workflows[0]).toMatchObject({ workflow_id: "orders", revision: 1, name: "Orders v1" })
    expect(registry.workflowRevisions[0].on_failure).toBe("continue")
    expect(registry.workflowRevisions[0].loop).toBeUndefined()
  })

  it("reads a plugin's functions from its manifest and its component facts from the stripped definition", () => {
    expect(registry.plugins[0]).toMatchObject({
      plugin_id: "acme.codec",
      functions: ["acme.codec.decode"],
      plugin_version: "0.3.0",
      component_digest: "sha256:comp",
      component_bytes: 12,
    })
  })

  it("keeps connections aside and reports a member whose definition has not loaded", () => {
    expect(registry.connections.map((m) => m.entity.id)).toEqual(["db"])
    expect(registry.unresolved.map((m) => m.entity.id)).toEqual(["orphan"])
  })

  it("shares a channel's buckets across the workflow revisions it routes to", () => {
    expect(workflowShares(registry.channels)).toEqual(
      new Map([
        ["orders@1", 80],
        ["orders@2", 20],
      ]),
    )
    expect(channelsRunning(registry, "orders").map((c) => c.channel_id)).toEqual(["orders"])
    expect(channelsRunning(registry, "orphan")).toEqual([])
  })
})

describe("withoutComponentBytes", () => {
  it("replaces a plugin's base64 with its size and sha256, and leaves other kinds alone", async () => {
    // "abc" — the SHA-256 test vector.
    const stored = await withoutComponentBytes({ kind: "plugin", definition: { manifest: {}, component: "YWJj" } })
    expect(stored.component).toEqual({
      size_bytes: 3,
      digest: "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    })
    expect(stored.definition.component).toMatch(/^sha256:ba7816bf.* · 3 bytes \(base64 omitted\)$/)
    const workflow: StoredDefinition = { kind: "workflow", definition: { name: "w", tasks: [] } }
    expect(await withoutComponentBytes(workflow)).toBe(workflow)
  })
})

describe("revisionBundle", () => {
  it("carries the manifest and each definition once, connections as the manifest alone", async () => {
    const fetched: string[] = []
    const bundle = await revisionBundle(
      { revision: 7, manifest_digest: "sha256:m", manifest: { members: [...members, wf("again", 1, "sha256:w1")] } },
      async (d) => {
        fetched.push(d)
        return defs[d] ?? { kind: "workflow", definition: {} }
      },
    )
    expect(bundle.revision).toBe(7)
    expect(Object.keys(bundle.definitions).sort()).toEqual(["sha256:ch", "sha256:missing", "sha256:pl", "sha256:w1", "sha256:w2"])
    expect(fetched).not.toContain("sha256:cfg")
    expect(fetched.filter((d) => d === "sha256:w1")).toHaveLength(1)
  })
})
