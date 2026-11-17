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
}

/**
 * Orion 2.0's actions. A change to what serves is a deployment (`v2_deployment_apply`,
 * `v2_deployment_rollback`), so those are the change pins; the per-entity
 * lifecycle actions of 1.x (`status_active`, `update_rollout`, `create_version`,
 * `reload`, …) are gone, and a 2.0 server starts on a fresh database, so no old
 * row carries them.
 */
export const AUDIT_ACTIONS: readonly AuditActionWords[] = [
  { value: "v2_deployment_apply", label: "Apply deployment", verb: "deployed" },
  { value: "v2_deployment_rollback", label: "Roll back deployment", verb: "rolled back" },
  { value: "v2_definition_upload", label: "Upload definition", verb: "uploaded" },
  { value: "v2_definition_test", label: "Test definition", verb: "tested" },
  { value: "v2_connection_create", label: "Create connection revision", verb: "revised" },
  { value: "v2_connection_probe", label: "Probe connection", verb: "probed" },
  { value: "v2_package_upload", label: "Upload provider package", verb: "uploaded" },
  { value: "v2_package_admit", label: "Admit provider package", verb: "admitted" },
  { value: "v2_package_revoke", label: "Revoke provider package", verb: "revoked" },
  { value: "trigger", label: "Trigger (cron)", verb: "triggered" },
  { value: "retry", label: "Retry (occurrence)", verb: "retried" },
  { value: "cancel", label: "Cancel (occurrence)", verb: "cancelled" },
  { value: "invalidate", label: "Invalidate (cache)", verb: "invalidated" },
  { value: "reset", label: "Reset breaker", verb: "reset" },
  { value: "requeue", label: "Requeue (DLQ)", verb: "requeued" },
  { value: "purge", label: "Purge (DLQ)", verb: "purged" },
  { value: "create", label: "Create (backup)", verb: "created" },
]

/** The resource types a 2.0 server records. Routes live in `lib/audit-routes.ts`. */
export const AUDIT_RESOURCE_TYPES = [
  { value: "deployment", label: "Deployment" },
  { value: "definition", label: "Definition" },
  { value: "connection", label: "Connection" },
  { value: "connector_package", label: "Provider package" },
  { value: "channel", label: "Channel" },
  { value: "cron_occurrence", label: "Cron occurrence" },
  { value: "cache_namespace", label: "Cache namespace" },
  { value: "circuit_breaker", label: "Circuit breaker" },
  { value: "trace_dlq", label: "Trace DLQ" },
  { value: "backup", label: "Backup" },
] as const

const BY_VALUE = new Map(AUDIT_ACTIONS.map((a) => [a.value, a]))

/** `v2_deployment_apply` → "deployed"; an unlisted action reads with its underscores spaced. */
export function auditVerb(action: string): string {
  return BY_VALUE.get(action)?.verb ?? action.replace(/_/g, " ")
}
