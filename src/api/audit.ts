import { api, buildQuery } from "./client"
import type { AuditLog, ListAuditLogsParams, Page } from "./types"

/**
 * Newest first, cursor-paged (2.0): `{data, limit, next_cursor?, total?}`,
 * `total` only with `include_total=true`. Filtering is server-side: exact
 * match on action / resource_type / resource_id / principal, plus an RFC 3339
 * time range (a trailing `Z` is accepted here, unlike the cron ledger's
 * bounds). No `sort_by`; `limit` is clamped to 1–1000.
 */
export const auditApi = {
  list: (params: ListAuditLogsParams = {}) =>
    api.get<Page<AuditLog>>(
      `admin/audit-logs${buildQuery(params as Record<string, string | number | undefined>)}`
    ),
}
