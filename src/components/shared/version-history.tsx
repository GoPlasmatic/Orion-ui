import { StatusBadge } from "@/components/shared/status-badge"
import { formatDate } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import type { EntityStatus, PaginatedResponse } from "@/api/types"

interface VersionEntry {
  version: number
  status: EntityStatus
  created_at: string
}

interface VersionHistoryProps {
  versions: PaginatedResponse<VersionEntry> | VersionEntry[] | undefined
  isLoading: boolean
}

export function VersionHistory({ versions, isLoading }: VersionHistoryProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  const items = versions
    ? Array.isArray(versions) ? versions : versions.data
    : []

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No version history available.</p>
  }

  return (
    <div className="space-y-2">
      {items.map((v) => (
        <div
          key={v.version}
          className="flex items-center justify-between rounded-lg border p-3"
        >
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">v{v.version}</span>
            <StatusBadge status={v.status} />
          </div>
          <span className="text-xs text-muted-foreground">{formatDate(v.created_at)}</span>
        </div>
      ))}
    </div>
  )
}
