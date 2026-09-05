import { useCallback, useMemo } from "react"
import { useSearchParams } from "react-router"

/**
 * List filters that live in the URL, so a filtered list is linkable, survives
 * a reload, and can be handed over from another page (`/traces?channel=`,
 * `/audit?resource_type=`). A page names its keys once; every value reads as a
 * string, empty when absent.
 *
 * `set` takes a patch so several keys change in one navigation — a sort field
 * and its direction, say. Two calls in a row would each start from the params
 * of the last render and the second would undo the first. It replaces the
 * history entry rather than pushing one, so typing into a filter does not fill
 * the back button with one entry per keystroke, and drops a key whose value is
 * empty, so a default filter leaves the URL clean.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams()
  const values = useMemo(
    () => Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ""])) as Record<K, string>,
    [params, keys],
  )
  const set = useCallback(
    (patch: Partial<Record<K, string>>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(patch) as [K, string | undefined][]) {
            if (value) next.set(key, value)
            else next.delete(key)
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )
  return { values, set }
}

/**
 * The next sort state after a click on a column: unsorted → ascending →
 * descending → unsorted, so the server's default order is one more click
 * away rather than unreachable. `desc` first for a time column, where the
 * newest row is the one being looked for.
 */
export function nextSort(
  current: { sort: string; order: string },
  field: string,
  newestFirst = false,
): { sort: string; order: string } {
  const first = newestFirst ? "desc" : "asc"
  const second = newestFirst ? "asc" : "desc"
  if (current.sort !== field) return { sort: field, order: first }
  if (current.order === first) return { sort: field, order: second }
  return { sort: "", order: "" }
}
