import { diffManifests, type MemberChange } from "@/lib/deployment-diff"
import { formatRelative } from "@/lib/utils"
import type { DeploymentRevision } from "@/api/types"
import type { SystemGraph } from "@/lib/system-graph"

/**
 * Change pins: the recent deployments drawn on the channels they touched, so
 * "it broke right after the deploy" can be read off the map instead of
 * cross-referenced from the deployment history.
 *
 * A 2.0 change is a deployment revision, and what it changed is its diff
 * against its parent (`diffManifests`). Each changed member lands on the
 * channels it reaches: a channel on itself, a workflow on every channel that
 * runs it, a connection on every channel whose config or workflow names it.
 * A compacted revision (or one whose parent is) cannot be diffed, so it pins
 * nothing rather than something wrong.
 */

/** How many of the newest revisions are read, and how far back a pin reaches. */
export const PIN_REVISIONS = 10
export const PIN_WINDOW_MS = 24 * 3_600_000

export interface ChangeNote {
  /** Unique per deployment and member. */
  id: string
  /** The deployment revision that made the change — what a pin links to. */
  deployment: number
  /** "changed", "added", "removed" — what the revision did to the member. */
  verb: string
  resource: "channel" | "workflow" | "connection" | "plugin"
  /** The member's id. */
  member: string
  /** The member's revision after the change (before it, for a removal). */
  revision: number | null
  principal: string
  at: string
}

/** Channel name → its changes, newest first. */
export type ChangePins = ReadonlyMap<string, ChangeNote[]>

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}

const VERB: Record<MemberChange["change"], string> = { added: "added", removed: "removed", updated: "changed" }

/**
 * Pins from `revisions` (each with its parent available through `parentOf`).
 * Newest first per channel; revisions outside the window are the caller's to
 * leave out.
 */
export function buildChangePins(
  revisions: DeploymentRevision[],
  parentOf: (revision: number) => DeploymentRevision | undefined,
  graph: SystemGraph,
): Map<string, ChangeNote[]> {
  const byChannelId = new Map<string, string>()
  const byWorkflow = new Map<string, string[]>()
  const byConnection = new Map<string, string[]>()
  for (const n of graph.nodes) {
    if (n.unresolved) continue
    byChannelId.set(n.channelId, n.id)
    if (n.workflowId) push(byWorkflow, n.workflowId, n.id)
    for (const c of n.connectors) push(byConnection, c, n.id)
  }
  const out = new Map<string, ChangeNote[]>()
  for (const rev of [...revisions].sort((a, b) => b.revision - a.revision)) {
    if (rev.members_compacted) continue
    const parent = rev.parent_revision != null ? parentOf(rev.parent_revision) : undefined
    // A parent named but not loaded (or compacted) is not "nothing before".
    if (rev.parent_revision != null && (!parent || parent.members_compacted)) continue
    for (const change of diffManifests(parent?.manifest.members, rev.manifest.members)) {
      let targets: string[] = []
      if (change.kind === "channel") {
        const name = byChannelId.get(change.id)
        if (name) targets = [name]
      } else if (change.kind === "workflow") targets = byWorkflow.get(change.id) ?? []
      else if (change.kind === "connection") targets = byConnection.get(change.id) ?? []
      if (targets.length === 0) continue
      const member = change.after ?? change.before
      const note: ChangeNote = {
        id: `${rev.revision}:${change.key}`,
        deployment: rev.revision,
        verb: VERB[change.change],
        resource: change.kind,
        member: change.id,
        revision: member?.entity.revision ?? null,
        principal: rev.created_by,
        at: rev.created_at,
      }
      for (const t of new Set(targets)) push(out, t, note)
    }
  }
  return out
}

/** "workflow orders changed r3 · rev 12 · 18h ago" */
export function changeText(note: ChangeNote, now?: number): string {
  const subject = note.resource === "channel" ? "" : `${note.resource} ${note.member} `
  const what = `${subject}${note.verb}${note.revision != null && note.verb !== "removed" ? ` r${note.revision}` : ""}`
  const when = formatRelative(note.at, now)
  return [what, `deployment ${note.deployment}`, when].filter(Boolean).join(" · ")
}

/** The hover text for a pin: up to three changes, newest first. */
export function pinTitle(notes: ChangeNote[] | undefined, now?: number): string | null {
  if (!notes || notes.length === 0) return null
  const lines = notes.slice(0, 3).map((n) => changeText(n, now))
  if (notes.length > 3) lines.push(`+${notes.length - 3} more in the deployment history`)
  return lines.join("\n")
}
