export type DiffLine = { type: "same" | "add" | "del"; text: string }

/** Line-based LCS diff between two texts — two JSON documents, pretty-printed. */
export function diffLines(a: string, b: string): DiffLine[] {
  const left = a.split("\n")
  const right = b.split("\n")
  const n = left.length
  const m = right.length
  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = left[i] === right[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      out.push({ type: "same", text: left[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "del", text: left[i] })
      i++
    } else {
      out.push({ type: "add", text: right[j] })
      j++
    }
  }
  while (i < n) out.push({ type: "del", text: left[i++] })
  while (j < m) out.push({ type: "add", text: right[j++] })
  return out
}

/**
 * Stable pretty JSON: object keys sorted at every depth, so two documents
 * that differ only in key order diff as equal — a stored definition is
 * canonical, but one assembled in the browser need not be.
 */
export function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v
  return JSON.stringify(sort(value), null, 2)
}
