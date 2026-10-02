/**
 * The audit vocabulary, written out once: what the server records as an
 * action or a resource type, how the audit filter labels it, and the
 * past-tense verb a feed reads ("soma-gate-start activated"). The Audit page's
 * dropdowns, the Operations "last change" line and the System Map's change
 * pins all read this table, so a new server action is added here and nowhere
 * else (plus a route in `lib/audit-routes.ts` for a new resource type).
 *
 * Both fields are open strings on the wire: `auditVerb` falls back to the raw
 * action with its underscores spaced, and the Audit page keeps an unlisted
 * value from the URL visible through `UnknownOption`.
 */
export interface AuditActionWords {
  value: string
  /** The filter dropdown's label. */
  label: string
  /** Past tense, for a feed line. */
  verb: string
  /** A change to an entity's definition or lifecycle — worth a pin on its node. */
  change?: boolean
}

export const AUDIT_ACTIONS: readonly AuditActionWords[] = [
  { value: "create", label: "Create", verb: "created", change: true },
  { value: "update", label: "Update", verb: "edited", change: true },
  { value: "delete", label: "Delete", verb: "deleted" },
  { value: "create_version", label: "Create version", verb: "new version", change: true },
  { value: "status_active", label: "Activate", verb: "activated", change: true },
  { value: "status_archived", label: "Archive", verb: "archived", change: true },
  { value: "update_rollout", label: "Update rollout", verb: "rollout changed", change: true },
  { value: "admit", label: "Admit (model)", verb: "re-admitted" },
  { value: "import", label: "Import", verb: "imported", change: true },
  { value: "test", label: "Test", verb: "tested" },
  { value: "trigger", label: "Trigger (cron)", verb: "triggered", change: true },
  { value: "retry", label: "Retry (occurrence)", verb: "retried" },
  { value: "cancel", label: "Cancel (occurrence)", verb: "cancelled" },
  { value: "invalidate", label: "Invalidate (cache)", verb: "invalidated" },
  { value: "reload", label: "Reload", verb: "reloaded" },
  { value: "reset", label: "Reset breaker", verb: "reset" },
  { value: "requeue", label: "Requeue (DLQ)", verb: "requeued" },
  { value: "purge", label: "Purge (DLQ)", verb: "purged" },
  { value: "package_staged", label: "Package staged", verb: "staged" },
  { value: "package_applied", label: "Package applied", verb: "applied" },
]

/** The resource types the server records. Routes live in `lib/audit-routes.ts`. */
export const AUDIT_RESOURCE_TYPES = [
  { value: "channel", label: "Channel" },
  { value: "workflow", label: "Workflow" },
  { value: "connector", label: "Connector" },
  { value: "plugin", label: "Plugin" },
  { value: "model", label: "Model" },
  { value: "cron_occurrence", label: "Cron occurrence" },
  { value: "cache_namespace", label: "Cache namespace" },
  { value: "engine", label: "Engine" },
  { value: "circuit_breaker", label: "Circuit breaker" },
  { value: "trace_dlq", label: "Trace DLQ" },
  { value: "package", label: "Package" },
  { value: "backup", label: "Backup" },
] as const

const BY_VALUE = new Map(AUDIT_ACTIONS.map((a) => [a.value, a]))

/** `status_active` → "activated"; an unlisted action reads with its underscores spaced. */
export function auditVerb(action: string): string {
  return BY_VALUE.get(action)?.verb ?? action.replace(/_/g, " ")
}

/** Whether an action changes an entity's definition or lifecycle. */
export function isChangeAction(action: string): boolean {
  return BY_VALUE.get(action)?.change === true
}
