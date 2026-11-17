/**
 * Lists over the head's members. The manifest is complete — there is no
 * server paging or sorting to ask for — so a list page filters, sorts and
 * pages in the browser, keeping that state in the URL (`useListState`) as
 * every list does.
 */

/** `rows` sorted on `field` through `value`; unsorted when no field is chosen. */
export function sortRows<T>(
  rows: readonly T[],
  field: string,
  order: "asc" | "desc" | "",
  value: (row: T, field: string) => string | number | null | undefined,
): T[] {
  if (!field) return [...rows]
  const dir = order === "desc" ? -1 : 1
  return [...rows].sort((a, b) => {
    const x = value(a, field)
    const y = value(b, field)
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1
    return dir * (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y)))
  })
}

/** Whether `text` (already lower-cased and trimmed) is in any of `fields`. */
export function matchesText(text: string, ...fields: (string | null | undefined)[]): boolean {
  return !text || fields.some((f) => f?.toLowerCase().includes(text))
}

/** An exact, case-insensitive tag match, as the 1.x server filter was. */
export function hasTag(tags: readonly string[], tag: string): boolean {
  const t = tag.trim().toLowerCase()
  return !t || tags.some((x) => x.toLowerCase() === t)
}
