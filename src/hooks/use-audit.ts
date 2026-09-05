import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { auditApi } from "@/api/audit"
import type { ListAuditLogsParams } from "@/api/types"

export function useAuditLogs(
  params: ListAuditLogsParams = {},
  options?: { refetchInterval?: number },
) {
  return useQuery({
    queryKey: ["audit-logs", params],
    queryFn: () => auditApi.list(params),
    placeholderData: keepPreviousData,
    refetchInterval: options?.refetchInterval,
  })
}
