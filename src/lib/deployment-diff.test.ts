// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { DeploymentRevision, ManifestMember } from "@/api/types"
import { dependents, diffManifests, diffSentence, entityHistory, summarizeDiff } from "@/lib/deployment-diff"

const wf = (id: string, revision: number, digest: string): ManifestMember => ({
  entity: { kind: "workflow", id, revision },
  definition_digest: digest,
})
const ch = (id: string, revision: number, digest: string, workflowRev = 1, extra: Partial<ManifestMember> = {}): ManifestMember => ({
  entity: { kind: "channel", id, revision },
  definition_digest: digest,
  requires: [{ kind: "workflow", id, revision: workflowRev }],
  ...extra,
})

describe("diffManifests", () => {
  it("adds, removes and changes by (kind, id), channels first", () => {
    const before = [wf("orders", 1, "sha256:a"), ch("orders", 1, "sha256:c"), wf("old", 1, "sha256:o")]
    const after = [
      wf("orders", 2, "sha256:b"),
      ch("orders", 1, "sha256:c", 2),
      wf("fresh", 1, "sha256:f"),
    ]
    const changes = diffManifests(before, after)
    expect(changes.map((c) => [c.change, c.kind, c.id, c.fields])).toEqual([
      ["updated", "channel", "orders", ["requires"]],
      ["added", "workflow", "fresh", []],
      ["removed", "workflow", "old", []],
      ["updated", "workflow", "orders", ["revision", "definition"]],
    ])
    expect(diffSentence(summarizeDiff(changes))).toBe("1 added · 2 changed · 1 removed")
  })

  it("sees a rollout split change and ignores the order intervals are listed in", () => {
    const split = (a: number) => [
      { workflow_revision: 2, start_bucket: a, end_bucket: 100 },
      { workflow_revision: 1, start_bucket: 0, end_bucket: a },
    ]
    const b = [ch("orders", 1, "sha256:c", 1, { rollouts: split(90) })]
    const same = [ch("orders", 1, "sha256:c", 1, { rollouts: [...split(90)].reverse() })]
    const moved = [ch("orders", 1, "sha256:c", 1, { rollouts: split(50) })]
    expect(diffManifests(b, same)).toEqual([])
    expect(diffManifests(b, moved)[0].fields).toEqual(["rollouts"])
  })

  it("matches a workflow deployed at several revisions (a canary) revision by revision", () => {
    const before = [wf("orders", 1, "sha256:a")]
    const canary = [wf("orders", 1, "sha256:a"), wf("orders", 2, "sha256:b")]
    const promoted = [wf("orders", 2, "sha256:b")]
    expect(diffManifests(before, canary).map((c) => [c.change, c.after?.entity.revision])).toEqual([["added", 2]])
    expect(diffManifests(canary, promoted).map((c) => [c.change, c.before?.entity.revision])).toEqual([["removed", 1]])
    const keys = diffManifests(undefined, canary).map((c) => c.key)
    expect(new Set(keys).size).toBe(2)
  })

  it("reads the first revision as adding everything", () => {
    expect(summarizeDiff(diffManifests(undefined, [wf("a", 1, "x"), ch("a", 1, "y")]))).toEqual({
      added: 2,
      removed: 0,
      updated: 0,
    })
  })
})

describe("dependents", () => {
  it("is the reverse of requires", () => {
    const members = [wf("orders", 1, "a"), ch("orders", 1, "c"), ch("audit", 1, "d")]
    expect(dependents(members, { kind: "workflow", id: "orders" }).map((m) => m.entity.id)).toEqual(["orders"])
  })
})

describe("entityHistory", () => {
  const rev = (revision: number, members: ManifestMember[], compacted = false): DeploymentRevision => ({
    revision,
    manifest_digest: `m${revision}`,
    member_count: members.length,
    reason: "",
    created_by: "",
    members_compacted: compacted,
    created_at: "",
    manifest: { schema_version: 2, providers: [], members: compacted ? [] : members },
  })

  it("collapses deployments that carried the same state, newest first, and skips compacted ones", () => {
    const history = entityHistory(
      [
        rev(1, [wf("orders", 1, "a")]),
        rev(2, [wf("orders", 1, "a")]),
        rev(3, [wf("orders", 2, "b")], true),
        rev(4, [wf("orders", 2, "b")]),
        rev(5, []),
        rev(6, [wf("orders", 1, "a")]),
      ],
      { kind: "workflow", id: "orders" },
    )
    expect(history).toEqual([
      { revision: 1, digest: "a", deployments: [6] },
      { revision: 2, digest: "b", deployments: [4] },
      { revision: 1, digest: "a", deployments: [2, 1] },
    ])
  })

  it("keeps one entry per revision a canary serves at once", () => {
    const history = entityHistory(
      [rev(1, [wf("orders", 1, "a")]), rev(2, [wf("orders", 1, "a"), wf("orders", 2, "b")]), rev(3, [wf("orders", 2, "b")])],
      { kind: "workflow", id: "orders" },
    )
    expect(history).toEqual([
      { revision: 2, digest: "b", deployments: [3, 2] },
      { revision: 1, digest: "a", deployments: [2, 1] },
    ])
  })
})
