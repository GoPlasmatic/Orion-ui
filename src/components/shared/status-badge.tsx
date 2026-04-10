import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { EntityStatus } from "@/api/types"

const statusStyles: Record<EntityStatus, string> = {
  draft: "bg-blue-50 text-blue-700 border-blue-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  archived: "bg-gray-100 text-gray-600 border-gray-200",
}

export function StatusBadge({ status }: { status: EntityStatus }) {
  return (
    <Badge variant="outline" className={cn(statusStyles[status])}>
      {status}
    </Badge>
  )
}
