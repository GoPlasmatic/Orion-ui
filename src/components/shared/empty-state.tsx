import type { ReactNode } from "react"
import { SearchX, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}

/**
 * Teaching empty state: an icon, a one-line explanation of the primitive, and the
 * primary call-to-action. Used in list pages in place of bare "No X found" rows.
 */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground">
        <Icon className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
    </div>
  )
}

/**
 * The empty state of a *filtered* list, which is a different fact from an
 * empty one: the registry holds rows, these filters select none of them. A
 * list that answers a narrowed filter with its first-run pitch ("No channels
 * yet — create your first one") tells an operator the system is empty when it
 * is not, so every list page picks between the two on `hasFilters`.
 */
export function NoMatches({ noun, onClear }: { noun: string; onClear: () => void }) {
  return (
    <EmptyState
      icon={SearchX}
      title={`No ${noun} match these filters`}
      description="The list is not empty — the filters above select nothing in it."
      action={
        <Button variant="outline" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  )
}
