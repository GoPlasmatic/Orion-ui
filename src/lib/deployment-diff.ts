import type { DeploymentRevision, EntityKind, EntityRef, ManifestMember, RolloutInterval } from "@/api/types"

/**
 * Reading deployment manifests: what changed between two revisions, which
 * members serve what, and an entity's history across revisions. Pure, so the
 * pages and the map read one answer.
 *
 * A member is keyed by `(kind, id)`. Its entity `revision` is the author's
 * (the CLI reuses it while the digest is unchanged and bumps it otherwise);
 * `definition_digest` is what it *is*. Both are compared: a revision bump with
 * the same digest is a renumbering, and the same revision over a different
 * digest is a change the numbering did not show.
 */

/** Display and sort order of member kinds: what serves traffic first. */
export const KIND_ORDER: readonly EntityKind[] = ["channel", "workflow", "connection", "plugin"]

export const memberKey = (e: { kind: string; id: string }) => `${e.kind}:${e.id}`

export const refLabel = (e: EntityRef) => `${e.kind} ${e.id} r${e.revision}`

const kindRank = (k: string) => {
  const i = KIND_ORDER.indexOf(k as EntityKind)
  return i === -1 ? KIND_ORDER.length : i
}

/** Members sorted by kind (channels first), then id. */
export function sortMembers<T extends { entity: { kind: string; id: string } }>(list: T[]): T[] {
  return sortBy(list, (m) => m.entity)
}

/** Anything with a kind and an id, in the same order. */
export function sortBy<T>(list: T[], of: (t: T) => { kind: string; id: string }): T[] {
  return [...list].sort((a, b) => kindRank(of(a).kind) - kindRank(of(b).kind) || of(a).id.localeCompare(of(b).id))
}

/** What differs about one member between two manifests. */
export type ChangedField = "revision" | "definition" | "requires" | "rollouts"

export interface MemberChange {
  kind: EntityKind
  id: string
  change: "added" | "removed" | "updated"
  before?: ManifestMember
  after?: ManifestMember
  /** For `updated`: what differs. */
  fields: ChangedField[]
}

const refs = (list: EntityRef[] | undefined) =>
  [...(list ?? [])].map(refLabel).sort().join(",")

const rollouts = (list: RolloutInterval[] | undefined) =>
  [...(list ?? [])]
    .sort((a, b) => a.start_bucket - b.start_bucket)
    .map((r) => `${r.start_bucket}-${r.end_bucket}:${r.workflow_revision}`)
    .join(",")

/**
 * The members `after` adds, removes and changes against `before` (an absent
 * `before` — the first revision — adds everything). Unchanged members are
 * left out. Sorted by kind, then id.
 */
export function diffManifests(before: ManifestMember[] | undefined, after: ManifestMember[]): MemberChange[] {
  const prev = new Map((before ?? []).map((m) => [memberKey(m.entity), m]))
  const next = new Map(after.map((m) => [memberKey(m.entity), m]))
  const out: MemberChange[] = []
  for (const [key, a] of next) {
    const b = prev.get(key)
    if (!b) {
      out.push({ kind: a.entity.kind, id: a.entity.id, change: "added", after: a, fields: [] })
      continue
    }
    const fields: ChangedField[] = []
    if (b.entity.revision !== a.entity.revision) fields.push("revision")
    if (b.definition_digest !== a.definition_digest) fields.push("definition")
    if (refs(b.requires) !== refs(a.requires)) fields.push("requires")
    if (rollouts(b.rollouts) !== rollouts(a.rollouts)) fields.push("rollouts")
    if (fields.length > 0) out.push({ kind: a.entity.kind, id: a.entity.id, change: "updated", before: b, after: a, fields })
  }
  for (const [key, b] of prev) {
    if (!next.has(key)) out.push({ kind: b.entity.kind, id: b.entity.id, change: "removed", before: b, fields: [] })
  }
  return sortBy(out, (c) => c)
}

export interface DiffSummary {
  added: number
  removed: number
  updated: number
}

export function summarizeDiff(changes: MemberChange[]): DiffSummary {
  return {
    added: changes.filter((c) => c.change === "added").length,
    removed: changes.filter((c) => c.change === "removed").length,
    updated: changes.filter((c) => c.change === "updated").length,
  }
}

/** "2 added · 1 changed · 1 removed", or "no changes". */
export function diffSentence(s: DiffSummary): string {
  const parts = [
    s.added && `${s.added} added`,
    s.updated && `${s.updated} changed`,
    s.removed && `${s.removed} removed`,
  ].filter(Boolean)
  return parts.length === 0 ? "no changes" : parts.join(" · ")
}

/** Who requires this member in the same manifest (the reverse of `requires`). */
export function dependents(members: ManifestMember[], target: { kind: string; id: string }): ManifestMember[] {
  return sortMembers(
    members.filter((m) => (m.requires ?? []).some((r) => r.kind === target.kind && r.id === target.id)),
  )
}

/** One distinct state of an entity across history: its revision and digest, and the deployments that carried it. */
export interface EntityHistoryEntry {
  revision: number
  digest: string
  /** Deployment revisions that deployed this state, newest first. */
  deployments: number[]
}

/**
 * An entity's states across the given deployment revisions (newest first).
 * Consecutive deployments carrying the same `(revision, digest)` collapse
 * into one entry. A compacted revision says nothing either way, so it is
 * skipped rather than read as "absent".
 */
export function entityHistory(
  revisions: DeploymentRevision[],
  target: { kind: string; id: string },
): EntityHistoryEntry[] {
  const out: EntityHistoryEntry[] = []
  for (const rev of [...revisions].sort((a, b) => b.revision - a.revision)) {
    if (rev.members_compacted) continue
    const m = rev.manifest.members.find((x) => x.entity.kind === target.kind && x.entity.id === target.id)
    if (!m) continue
    const last = out.at(-1)
    if (last && last.revision === m.entity.revision && last.digest === m.definition_digest) {
      last.deployments.push(rev.revision)
    } else {
      out.push({ revision: m.entity.revision, digest: m.definition_digest, deployments: [rev.revision] })
    }
  }
  return out
}

/** "sha256:1234abcd…" → "1234abcd" — enough to tell digests apart at a glance. */
export const shortDigest = (digest: string) => digest.replace(/^sha256:/, "").slice(0, 12)
