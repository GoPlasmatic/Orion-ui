import { api, buildQuery } from "./client"
import type { AuditLog, ListAuditLogsParams, PaginatedResponse } from "./types"

/**
 * Since 1.0 the audit list uses the same flat `{data, total, limit, offset}`
 * envelope as every other admin list — the old nested `{pagination}` shape and
 * the client-side filtering it forced are both gone. Filtering is server-side:
 * exact-match on action / resource_type / resource_id / principal, plus an
 * RFC 3339 time range.
 *
 * This endpoint takes no `sort_by`, and clamps `limit` to 1–1000.
 */
export const auditApi = {
  list: (params: ListAuditLogsParams = {}) =>
    api.get<PaginatedResponse<AuditLog>>(
      `admin/audit-logs${buildQuery(params as Record<string, string | number | undefined>)}`
    ),
}
