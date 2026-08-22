import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PAGE_SIZE } from "@/lib/use-pagination"

interface PaginationFooterProps {
  offset: number
  pageSize?: number
  /** Rows on the current page — the only reliable signal when `total` is absent. */
  count: number
  /**
   * Rows matching the filter. `undefined` means the endpoint did not compute
   * it: the trace list omits `total` unless asked with `include_total=true`,
   * because the count is a full scan of the filtered set. Absent is "unknown",
   * never zero.
   */
  total?: number | null
  onPrev: () => void
  onNext: () => void
  /** Overrides the count-derived guess — pass `!!next_cursor` for keyset paging. */
  hasNext?: boolean
}

export function PaginationFooter({
  offset,
  pageSize = PAGE_SIZE,
  count,
  total,
  onPrev,
  onNext,
  hasNext,
}: PaginationFooterProps) {
  const knownTotal = total ?? undefined
  const hasPrev = offset > 0
  // Without a total, a full page is the only evidence another page may exist.
  const canGoNext =
    hasNext ?? (knownTotal !== undefined ? offset + pageSize < knownTotal : count >= pageSize)

  const label =
    count === 0
      ? "No results"
      : knownTotal !== undefined
        ? `${offset + 1}–${Math.min(offset + pageSize, knownTotal)} of ${knownTotal}`
        : `${offset + 1}–${offset + count}`

  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPrev}
          onClick={onPrev}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!canGoNext}
          onClick={onNext}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
