import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { auditApi } from "@/api/audit"
import type { ListAuditLogsParams } from "@/api/types"
import { useCursorList } from "@/hooks/use-cursor-list"

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

/** The audit page's list: newest first, a page at a time. */
export function useAuditLogList(params: Omit<ListAuditLogsParams, "cursor">) {
  return useCursorList(["audit-logs", "list", params], (cursor) => auditApi.list({ ...params, cursor }))
}
