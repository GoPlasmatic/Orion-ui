/**
 * Where an audit row's resource id leads. The row names the resource by the id
 * its own page is keyed on — a channel UUID, a workflow slug, a plugin id — so
 * the id is a link wherever a page exists for it. A breaker is addressed by its
 * key; a DLQ entry and a package by their list.
 */
const ROUTES: Record<string, (id: string) => string> = {
  channel: (id) => `/channels/${id}`,
  workflow: (id) => `/workflows/${id}`,
  connector: (id) => `/connectors/${id}`,
  plugin: (id) => `/plugins/${encodeURIComponent(id)}`,
  cron_occurrence: (id) => `/schedules/occurrences/${id}`,
  circuit_breaker: (id) => `/circuit-breakers?key=${encodeURIComponent(id)}`,
  trace_dlq: () => "/trace-dlq",
  package: () => "/packages",
}

export function auditResourceRoute(resourceType: string, id: string | null | undefined): string | null {
  const route = resourceType in ROUTES ? ROUTES[resourceType] : undefined
  return route && id ? route(id) : null
}
