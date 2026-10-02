/**
 * Where an audit row's resource id leads. The row names the resource by the id
 * its own page is keyed on — a channel UUID, a workflow slug, a plugin or model id — so
 * the id is a link wherever a page exists for it. A breaker is addressed by its
 * key; a DLQ entry and a package by their list.
 */
const ROUTES: Record<string, (id: string) => string> = {
  channel: (id) => `/channels/${id}`,
  workflow: (id) => `/workflows/${id}`,
  connector: (id) => `/connectors/${id}`,
  plugin: (id) => `/plugins/${encodeURIComponent(id)}`,
  model: (id) => `/models/${encodeURIComponent(id)}`,
  cron_occurrence: (id) => `/schedules/occurrences/${id}`,
  cache_namespace: (id) => `/caches?namespace=${encodeURIComponent(id)}`,
  circuit_breaker: (id) => `/circuit-breakers?key=${encodeURIComponent(id)}`,
  trace_dlq: () => "/trace-dlq",
  package: () => "/packages",
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
