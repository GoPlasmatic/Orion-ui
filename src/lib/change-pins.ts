import { auditVerb, isChangeAction } from "@/lib/audit-vocabulary"
import { formatRelative, parseJson, serverTime } from "@/lib/utils"
import type { AuditLog } from "@/api/types"
import type { SystemGraph } from "@/lib/system-graph"

/**
 * Change pins: the newest audit rows drawn on the node they touched, so "it
 * broke right after the deploy" can be read off the map instead of
 * cross-referenced from the audit page.
 *
 * The rows come from one query (`hooks/use-change-pins.ts`). A channel row
 * names the channel by its UUID; a workflow row by its slug, and lands on
 * every channel running that workflow, because the channel is what the map
 * draws. Which actions count as a change, and their words, are the audit
 * vocabulary's (`isChangeAction`, `auditVerb`).
 */

export const PIN_LIMIT = 50
export const PIN_WINDOW_MS = 24 * 3_600_000

export interface ChangeNote {
  id: string
  /** "activated", "new version" … */
  verb: string
  resource: "channel" | "workflow"
  version: number | null
  principal: string
  at: string
}

/** Channel name → its changes, newest first. */
export type ChangePins = ReadonlyMap<string, ChangeNote[]>

function versionOf(row: AuditLog): number | null {
  const parsed = parseJson(row.details ?? "")
  if (!parsed || typeof parsed !== "object") return null
  const v = (parsed as Record<string, unknown>).version
  return typeof v === "number" ? v : null
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}

export function buildChangePins(rows: AuditLog[], graph: SystemGraph): Map<string, ChangeNote[]> {
  const byUuid = new Map<string, string>()
  const byWorkflow = new Map<string, string[]>()
  for (const n of graph.nodes) {
    if (n.unresolved) continue
    byUuid.set(n.channelId, n.id)
    if (n.workflowId) push(byWorkflow, n.workflowId, n.id)
  }
  const out = new Map<string, ChangeNote[]>()
  const sorted = [...rows].sort((a, b) => (serverTime(b.created_at) ?? 0) - (serverTime(a.created_at) ?? 0))
  for (const row of sorted) {
    if (!isChangeAction(row.action)) continue
    let targets: string[] = []
    if (row.resource_type === "channel") {
      const name = byUuid.get(row.resource_id) ?? (graph.byId.has(row.resource_id) ? row.resource_id : null)
      if (name) targets = [name]
    } else if (row.resource_type === "workflow") {
      targets = byWorkflow.get(row.resource_id) ?? []
    }
    if (targets.length === 0) continue
    const note: ChangeNote = {
      id: row.id,
      verb: auditVerb(row.action),
      resource: row.resource_type as ChangeNote["resource"],
      version: versionOf(row),
      principal: row.principal,
      at: row.created_at,
    }
    for (const t of targets) push(out, t, note)
  }
  return out
}

/** "workflow activated v3 · 18h ago" */
export function changeText(note: ChangeNote, now?: number): string {
  const what = `${note.resource === "workflow" ? "workflow " : ""}${note.verb}${note.version != null ? ` v${note.version}` : ""}`
  const when = formatRelative(note.at, now)
  return when ? `${what} · ${when}` : what
}

/** The hover text for a pin: up to three changes, newest first. */
export function pinTitle(notes: ChangeNote[] | undefined, now?: number): string | null {
  if (!notes || notes.length === 0) return null
  const lines = notes.slice(0, 3).map((n) => changeText(n, now))
  if (notes.length > 3) lines.push(`+${notes.length - 3} more in the audit log`)
  return lines.join("\n")
}
