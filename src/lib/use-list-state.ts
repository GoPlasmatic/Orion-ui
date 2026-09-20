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

export interface ListStateOptions<K extends string> {
  /**
   * Columns that open descending, since the newest row is the one being
   * looked for. Defaults to the two timestamps.
   */
  newestFirst?: readonly string[]
  /**
   * The values a filter key accepts. A URL carrying anything else reads as
   * unset — the control, the request and the rows then agree, where an
   * unchecked value left the control reading "All statuses" over a list the
   * server had filtered down to nothing. A key left out here takes free text
   * (a tag, a channel name) and is passed through as typed.
   */
  values?: Partial<Record<K, readonly string[]>>
}

/**
 * A list page's whole view state — its filters, its sort and its page — as
 * URL search params, so a filtered, sorted, paged list is a link that opens
 * the same view. Any filter or sort change re-anchors to the first page;
 * paging keeps the filters. `sortFields` maps a column id to the server's
 * `sort_by` value.
 */
export function useListState<K extends string>(
  keys: readonly K[],
  sortFields: Record<string, string> = {},
  { newestFirst = ["updated_at", "created_at"], values: allowed }: ListStateOptions<K> = {},
) {
  const allKeys = useMemo(() => [...keys, ...LIST_KEYS] as readonly ListKey<K>[], [keys])
  const { values, set } = useUrlFilters(allKeys)

  /**
   * The filters as the page should read them: a value outside its declared set
   * is dropped rather than sent. The URL keeps what it was given — rewriting it
   * would mean navigating during a render — but nothing downstream sees it.
   */
  const filters = useMemo(() => {
    const read = {} as Record<K, string>
    for (const key of keys) {
      const raw = values[key]
      const accepted = allowed?.[key]
      read[key] = !raw || !accepted || accepted.includes(raw) ? raw : ""
    }
    return read
  }, [keys, values, allowed])

  /** Whether any filter is narrowing the list — what tells an empty list from an empty registry. */
  const hasFilters = useMemo(() => keys.some((k) => filters[k] !== ""), [keys, filters])

  const sortBy = Object.values(sortFields).includes(values.sort) ? values.sort : ""
  const sortOrder: SortOrder | "" =
    values.order === "asc" || values.order === "desc" ? values.order : ""
  const rawOffset = Number(values.offset)
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0

  /** A filter or sort change: apply it and go back to the first page. */
  const update = useCallback((patch: Patch<K>) => set({ ...patch, offset: "" } as Patch<K>), [set])
  /** Drop every filter, keeping the sort: the way out of a filtered-empty list. */
  const clear = useCallback(
    () => update(Object.fromEntries(keys.map((k) => [k, ""])) as Patch<K>),
    [update, keys],
  )
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
    clear,
    hasFilters,
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
