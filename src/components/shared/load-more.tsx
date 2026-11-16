import { Button } from "@/components/ui/button"
import { plural } from "@/lib/utils"

interface LoadMoreFooterProps {
  /** Rows loaded so far. */
  count: number
  /** Rows matching the filters, when the server counted them. */
  total?: number
  hasMore: boolean
  pending: boolean
  onLoadMore: () => void
  /** The row noun, singular ("trace"). */
  noun?: string
}

/**
 * The footer under a cursor-paged list: how much is loaded, and the button
 * that fetches the next page. Replaces the offset `PaginationFooter` as each
 * list moves to 2.0's cursors.
 */
export function LoadMoreFooter({ count, total, hasMore, pending, onLoadMore, noun = "row" }: LoadMoreFooterProps) {
  const label =
    count === 0
      ? "No results"
      : total !== undefined
        ? `${count.toLocaleString("en")} of ${plural(total, noun)}`
        : `${plural(count, noun)}${hasMore ? " loaded" : ""}`
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {label}
      </p>
      {hasMore && (
        <Button variant="outline" size="sm" disabled={pending} onClick={onLoadMore}>
          {pending ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  )
}
