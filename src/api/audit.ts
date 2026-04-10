import { api, buildQuery } from "./client"
import type { AuditLog, ListAuditLogsParams, PaginatedResponse } from "./types"

export const auditApi = {
  list: (params: ListAuditLogsParams = {}) =>
    api.get<PaginatedResponse<AuditLog>>(
      `admin/audit-logs${buildQuery(params as Record<string, string | number | undefined>)}`
    ),
}
