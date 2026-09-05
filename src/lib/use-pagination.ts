import { useCallback, useState } from "react"

export const PAGE_SIZE = 20

/**
 * "Every channel" (or workflow, or connector) for a lookup — the map, the
 * pickers, a name → id join. One cap, so every caller means the same thing by
 * it; the server clamps `limit` at 1000.
 */
export const REGISTRY_LIMIT = 1000

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
