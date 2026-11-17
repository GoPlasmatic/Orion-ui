import { connectionRoute, parseConnectionRef } from "@/lib/connections"

/**
 * Where an audit row's resource id leads. The row names the resource by the id
 * its own page is keyed on — in 2.0 a manifest member's id for a channel,
 * workflow or plugin, a revision number for a deployment — so
 * the id is a link wherever a page exists for it. A breaker is addressed by its
 * key; a DLQ entry and a package by their list.
 */
const ROUTES: Record<string, (id: string) => string> = {
  // 2.0: a connection row's id is `id@revision`; a workflow's `connector`
  // input names the connection by id, so "connector" resolves the same way.
  connection: (ref) => {
    const { id, revision } = parseConnectionRef(ref)
    return connectionRoute(id, revision)
  },
  connector: (id) => connectionRoute(id),
  connector_package: (digest) => `/provider-packages/${encodeURIComponent(digest)}`,
  // 2.0: a deployment row's id is the committed revision.
  deployment: (id) => `/deployments/${encodeURIComponent(id)}`,
  channel: (id) => `/channels/${encodeURIComponent(id)}`,
  workflow: (id) => `/workflows/${encodeURIComponent(id)}`,
  plugin: (id) => `/plugins/${encodeURIComponent(id)}`,
  cron_occurrence: (id) => `/schedules/occurrences/${id}`,
  cache_namespace: (id) => `/caches?namespace=${encodeURIComponent(id)}`,
  circuit_breaker: (id) => `/circuit-breakers?key=${encodeURIComponent(id)}`,
  trace_dlq: () => "/trace-dlq",
}

/**
 * The page for an entity by kind — `entityRoute("connector", id)`. The audit
 * route table generalised: the map's hubs, incident links and dependency cards
 * all build entity links through here rather than by hand.
 */
export function entityRoute(kind: string, id: string | null | undefined): string | null {
  return auditResourceRoute(kind, id)
}

export function auditResourceRoute(resourceType: string, id: string | null | undefined): string | null {
  const route = resourceType in ROUTES ? ROUTES[resourceType] : undefined
  return route && id ? route(id) : null
}
