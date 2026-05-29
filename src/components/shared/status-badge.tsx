import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { entityStatusClass } from "@/lib/status"
import type { EntityStatus } from "@/api/types"

export function StatusBadge({ status }: { status: EntityStatus }) {
  return (
    <Badge variant="outline" className={cn(entityStatusClass[status])}>
      {status}
    </Badge>
  )
}
