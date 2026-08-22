import { useCallback, useState } from "react"

export const PAGE_SIZE = 20

export interface PaginationState {
  offset: number
  /** Reset to the first page — call whenever a filter or sort changes. */
  reset: () => void
  prev: () => void
  next: () => void
}

export function usePagination(pageSize = PAGE_SIZE): PaginationState {
  const [offset, setOffset] = useState(0)
  return {
    offset,
    reset: useCallback(() => setOffset(0), []),
    prev: useCallback(() => setOffset((o) => Math.max(0, o - pageSize)), [pageSize]),
    next: useCallback(() => setOffset((o) => o + pageSize), [pageSize]),
  }
}
