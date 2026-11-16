import { useInfiniteQuery, keepPreviousData, type QueryKey } from "@tanstack/react-query"
import type { Page } from "@/api/types"

export interface CursorList<T> {
  /** Every row loaded so far, newest first, across the pages fetched. */
  rows: T[]
  /** Rows matching the filters when the server counted them (`include_total=true`); `undefined` is unknown, never zero. */
  total: number | undefined
  /** Whether the server has another page (`next_cursor` was set). */
  hasMore: boolean
  loadMore: () => void
  isLoading: boolean
  isFetchingMore: boolean
  error: unknown
  refetch: () => void
}

/**
 * A 2.0 cursor-paged list, loaded a page at a time ("Load more"). Paging is
 * cursor-only and newest first, so there is no page N to jump to and no
 * "previous" — the console accumulates what it has fetched instead. The
 * filters belong in the query key (and the URL, through `useListState`); the
 * depth loaded does not, because a cursor is opaque and short-lived.
 *
 * `fetchPage(cursor)` is called with `undefined` for the first page. Keep
 * `include_total` for lists that show a count: it is a full scan.
 */
export function useCursorList<T>(
  key: QueryKey,
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  options: { enabled?: boolean; refetchInterval?: number | false } = {}
): CursorList<T> {
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: options.enabled,
    refetchInterval: options.refetchInterval,
    placeholderData: keepPreviousData,
  })
  const pages = q.data?.pages ?? []
  const counted = pages.find((p) => typeof p.total === "number")?.total
  return {
    rows: pages.flatMap((p) => p.data),
    total: typeof counted === "number" ? counted : undefined,
    hasMore: q.hasNextPage,
    loadMore: () => {
      if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage()
    },
    isLoading: q.isLoading,
    isFetchingMore: q.isFetchingNextPage,
    error: q.error,
    refetch: () => void q.refetch(),
  }
}
