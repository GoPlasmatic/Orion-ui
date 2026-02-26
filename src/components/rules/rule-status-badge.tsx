import { Badge } from "@/components/ui/badge"
import type { RuleStatus } from "@/api/types"
import { cn } from "@/lib/utils"

const statusConfig: Record<RuleStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  paused: { label: "Paused", className: "bg-amber-50 text-amber-700 border-amber-200" },
  archived: { label: "Archived", className: "bg-gray-100 text-gray-600 border-gray-200" },
}

export function RuleStatusBadge({ status }: { status: RuleStatus }) {
  const config = statusConfig[status]
  return (
    <Badge variant="outline" className={cn(config.className)}>
      {config.label}
    </Badge>
  )
}
