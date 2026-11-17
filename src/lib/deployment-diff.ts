import type { DeploymentRevision, EntityKind, EntityRef, ManifestMember, RolloutInterval } from "@/api/types"

/**
 * Reading deployment manifests: what changed between two revisions, which
 * members serve what, and an entity's history across revisions. Pure, so the
 * pages and the map read one answer.
 *
 * A member is keyed by `(kind, id)` — except that a **workflow may appear at
 * several revisions** in one manifest (a channel's canary split names each
 * revision it routes to; the server refuses only a repeated revision), so a
 * workflow is one *group* of members. Its entity `revision` is the author's
 * (the CLI reuses it while the digest is unchanged and bumps it otherwise);
 * `definition_digest` is what it *is*. Both are compared: a revision bump with
 * the same digest is a renumbering, and the same revision over a different
 * digest is a change the numbering did not show.
 */

/** Display and sort order of member kinds: what serves traffic first. */
export const KIND_ORDER: readonly EntityKind[] = ["channel", "workflow", "connection", "plugin"]

/** The entity a member is: one channel, connection or plugin, or every revision of one workflow. */
export const memberKey = (e: { kind: string; id: string }) => `${e.kind}:${e.id}`

/** One member exactly — unique within a manifest, even for a workflow deployed at two revisions. */
export const memberRefKey = (e: EntityRef) => `${e.kind}:${e.id}@${e.revision}`

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
  /** Unique among the changes of one diff. */
  key: string
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

function memberFields(b: ManifestMember, a: ManifestMember): ChangedField[] {
  const fields: ChangedField[] = []
  if (b.entity.revision !== a.entity.revision) fields.push("revision")
  if (b.definition_digest !== a.definition_digest) fields.push("definition")
  if (refs(b.requires) !== refs(a.requires)) fields.push("requires")
  if (rollouts(b.rollouts) !== rollouts(a.rollouts)) fields.push("rollouts")
  return fields
}

function groupByEntity(list: ManifestMember[]): Map<string, ManifestMember[]> {
  const out = new Map<string, ManifestMember[]>()
  for (const m of list) {
    const key = memberKey(m.entity)
    const group = out.get(key)
    if (group) group.push(m)
    else out.set(key, [m])
  }
  return out
}

/**
 * The members `after` adds, removes and changes against `before` (an absent
 * `before` — the first revision — adds everything). Unchanged members are
 * left out. Sorted by kind, then id.
 *
 * An entity present once on each side is one member that changed or did not.
 * A workflow present at several revisions on either side (a canary) is
 * matched revision by revision: the revision a split starts routing to is
 * added, the one it stops routing to removed.
 */
export function diffManifests(before: ManifestMember[] | undefined, after: ManifestMember[]): MemberChange[] {
  const prev = groupByEntity(before ?? [])
  const next = groupByEntity(after)
  const out: MemberChange[] = []
  const added = (a: ManifestMember) =>
    out.push({ key: `+${memberRefKey(a.entity)}`, kind: a.entity.kind, id: a.entity.id, change: "added", after: a, fields: [] })
  const removed = (b: ManifestMember) =>
    out.push({ key: `-${memberRefKey(b.entity)}`, kind: b.entity.kind, id: b.entity.id, change: "removed", before: b, fields: [] })
  const compared = (b: ManifestMember, a: ManifestMember) => {
    const fields = memberFields(b, a)
    if (fields.length > 0) {
      out.push({ key: `~${memberRefKey(a.entity)}`, kind: a.entity.kind, id: a.entity.id, change: "updated", before: b, after: a, fields })
    }
  }

  for (const key of new Set([...prev.keys(), ...next.keys()])) {
    const bs = prev.get(key) ?? []
    const as = next.get(key) ?? []
    if (bs.length <= 1 && as.length <= 1) {
      if (bs[0] && as[0]) compared(bs[0], as[0])
      else if (as[0]) added(as[0])
      else if (bs[0]) removed(bs[0])
      continue
    }
    for (const a of as) {
      const b = bs.find((x) => x.entity.revision === a.entity.revision)
      if (b) compared(b, a)
      else added(a)
    }
    for (const b of bs) if (!as.some((x) => x.entity.revision === b.entity.revision)) removed(b)
  }
  return sortBy(out, (c) => c).sort(
    (x, y) =>
      kindRank(x.kind) - kindRank(y.kind) ||
      x.id.localeCompare(y.id) ||
      (x.after ?? x.before)!.entity.revision - (y.after ?? y.before)!.entity.revision,
  )
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
 * An entity's states across the given deployment revisions, newest first. A
 * run of consecutive deployments carrying the same `(revision, digest)` is
 * one entry, so A → B → A reads as three. A workflow a canary serves at two
 * revisions at once has an entry for each. A compacted revision says nothing
 * either way, so it is skipped rather than read as "absent".
 */
export function entityHistory(
  revisions: DeploymentRevision[],
  target: { kind: string; id: string },
): EntityHistoryEntry[] {
  const out: EntityHistoryEntry[] = []
  // The entries the last deployment read (the next-newer one) carried.
  let open = new Map<string, EntityHistoryEntry>()
  for (const rev of [...revisions].sort((a, b) => b.revision - a.revision)) {
    if (rev.members_compacted) continue
    const now = new Map<string, EntityHistoryEntry>()
    for (const m of rev.manifest.members) {
      if (m.entity.kind !== target.kind || m.entity.id !== target.id) continue
      const key = `${m.entity.revision}:${m.definition_digest}`
      let entry = open.get(key)
      if (entry) entry.deployments.push(rev.revision)
      else out.push((entry = { revision: m.entity.revision, digest: m.definition_digest, deployments: [rev.revision] }))
      now.set(key, entry)
    }
    open = now
  }
  return out
}

/** "sha256:1234abcd…" → "1234abcd" — enough to tell digests apart at a glance. */
export const shortDigest = (digest: string) => digest.replace(/^sha256:/, "").slice(0, 12)
