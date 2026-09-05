import { useCallback, useMemo } from "react"
import type { SortOrder } from "@/api/types"
import { PAGE_SIZE } from "@/lib/use-pagination"
import { nextSort, useUrlFilters } from "@/lib/use-url-filters"

/** The keys every list keeps beside its own filters. */
const LIST_KEYS = ["sort", "order", "offset"] as const
type ListKey<K extends string> = K | (typeof LIST_KEYS)[number]
type Patch<K extends string> = Partial<Record<ListKey<K>, string>>

/** What a sortable header row needs: the column → server-field map and the current sort. */
export interface ListSort {
  fields: Record<string, string>
  sortBy: string
  sortOrder: SortOrder | ""
  onSort: (field: string) => void
}

/**
 * A list page's whole view state — its filters, its sort and its page — as
 * URL search params, so a filtered, sorted, paged list is a link that opens
 * the same view. Any filter or sort change re-anchors to the first page;
 * paging keeps the filters. `sortFields` maps a column id to the server's
 * `sort_by` value, and a column in `newestFirst` opens descending, since the
 * newest row is the one being looked for.
 */
export function useListState<K extends string>(
  keys: readonly K[],
  sortFields: Record<string, string> = {},
  newestFirst: readonly string[] = ["updated_at", "created_at"],
) {
  const allKeys = useMemo(() => [...keys, ...LIST_KEYS] as readonly ListKey<K>[], [keys])
  const { values, set } = useUrlFilters(allKeys)
  const filters = values as Record<K, string>

  const sortBy = Object.values(sortFields).includes(values.sort) ? values.sort : ""
  const sortOrder: SortOrder | "" =
    values.order === "asc" || values.order === "desc" ? values.order : ""
  const rawOffset = Number(values.offset)
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0

  /** A filter or sort change: apply it and go back to the first page. */
  const update = useCallback((patch: Patch<K>) => set({ ...patch, offset: "" } as Patch<K>), [set])
  const onSort = useCallback(
    (field: string) =>
      update(nextSort({ sort: sortBy, order: sortOrder }, field, newestFirst.includes(field)) as Patch<K>),
    [update, sortBy, sortOrder, newestFirst],
  )
  const prev = useCallback(
    () => set({ offset: offset > PAGE_SIZE ? String(offset - PAGE_SIZE) : "" } as Patch<K>),
    [set, offset],
  )
  const next = useCallback(() => set({ offset: String(offset + PAGE_SIZE) } as Patch<K>), [set, offset])

  return {
    filters,
    update,
    sortBy,
    sortOrder,
    /** The list request's sort arguments; absent when the server's default order stands. */
    sortQuery: {
      sort_by: sortBy || undefined,
      sort_order: sortBy ? sortOrder || undefined : undefined,
    },
    sort: { fields: sortFields, sortBy, sortOrder, onSort } satisfies ListSort,
    offset,
    prev,
    next,
  }
}
