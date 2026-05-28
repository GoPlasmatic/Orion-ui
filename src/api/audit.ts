import { api, buildQuery } from "./client"
import type { AuditLog, ListAuditLogsParams, PaginatedResponse } from "./types"

// The audit-logs endpoint nests paging under `pagination` (unlike other list
// endpoints, which are flat). Normalise to PaginatedResponse so the UI is uniform.
interface RawAuditResponse {
  data: AuditLog[]
  pagination?: { total: number; limit: number; offset: number }
}

export const auditApi = {
  list: (params: ListAuditLogsParams = {}): Promise<PaginatedResponse<AuditLog>> =>
    api
      .get<RawAuditResponse>(
        `admin/audit-logs${buildQuery(params as Record<string, string | number | undefined>)}`
      )
      .then((r) => ({
        data: r.data,
        total: r.pagination?.total ?? r.data.length,
        limit: r.pagination?.limit ?? params.limit ?? 0,
        offset: r.pagination?.offset ?? params.offset ?? 0,
      })),
}
