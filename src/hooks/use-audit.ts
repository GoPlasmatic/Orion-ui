import { useQuery } from "@tanstack/react-query"
import { auditApi } from "@/api/audit"
import type { ListAuditLogsParams } from "@/api/types"

export function useAuditLogs(params: ListAuditLogsParams = {}) {
  return useQuery({
    queryKey: ["audit-logs", params],
    queryFn: () => auditApi.list(params),
  })
}
