import type { ReactNode } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { TableHead } from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * A column header that sorts server-side. With no `field` it is a plain
 * header; with one it is a button that cycles the sort and announces the
 * current direction through `aria-sort` on the cell.
 */
export function SortableHead({
  field,
  sort,
  order,
  onSort,
  className,
  children,
}: {
  /** The server's `sort_by` value for this column; absent for an unsortable one. */
  field?: string
  /** The active sort field, empty for the server's default order. */
  sort: string
  order: string
  onSort?: () => void
  className?: string
  children: ReactNode
}) {
  if (!field || !onSort) return <TableHead className={className}>{children}</TableHead>
  const active = sort === field
  const Icon = !active ? ArrowUpDown : order === "asc" ? ArrowUp : ArrowDown
  return (
    <TableHead
      className={className}
      aria-sort={active ? (order === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "inline-flex items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
          active && "text-foreground",
        )}
        title={active ? `Sorted ${order === "asc" ? "ascending" : "descending"} — click to change` : "Sort by this column"}
      >
        {children}
        <Icon className={cn("h-3 w-3", !active && "opacity-40")} aria-hidden />
      </button>
    </TableHead>
  )
}
