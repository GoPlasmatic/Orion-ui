import { useMemo, useState } from "react"
import type { PaginatedResponse, Workflow } from "@/api/types"
import { Select } from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface VersionCompareProps {
  versions?: PaginatedResponse<Workflow> | Workflow[]
  isLoading?: boolean
}

type DiffLine = { type: "same" | "add" | "del"; text: string }

/** Line-based LCS diff between two JSON snapshots. */
function diffLines(a: string, b: string): DiffLine[] {
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

/** Stable JSON view of a version, excluding volatile/status fields that aren't part of the definition. */
function definitionJson(wf: Workflow): string {
  const { status: _s, created_at: _c, updated_at: _u, ...rest } = wf
  void _s
  void _c
  void _u
  return JSON.stringify(rest, null, 2)
}

/**
 * Side-by-side(ish) compare of two workflow versions, rendered as a colored line
 * diff of their definitions. Reuses the version list already loaded for the
 * Versions tab — no extra fetch.
 */
export function VersionCompare({ versions, isLoading }: VersionCompareProps) {
  const list = useMemo(
    () => (Array.isArray(versions) ? versions : (versions?.data ?? [])),
    [versions]
  )
  const sorted = useMemo(() => [...list].sort((a, b) => b.version - a.version), [list])

  const [leftV, setLeftV] = useState<number | null>(null)
  const [rightV, setRightV] = useState<number | null>(null)

  // Default to the two most recent versions.
  const lv = leftV ?? sorted[1]?.version ?? sorted[0]?.version ?? null
  const rv = rightV ?? sorted[0]?.version ?? null

  const left = sorted.find((w) => w.version === lv)
  const right = sorted.find((w) => w.version === rv)

  const diff = useMemo(() => {
    if (!left || !right) return []
    return diffLines(definitionJson(left), definitionJson(right))
  }, [left, right])

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading versions…</p>
  if (sorted.length < 2) {
    return <p className="text-sm text-muted-foreground">Need at least two versions to compare.</p>
  }

  const changes = diff.filter((d) => d.type !== "same").length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Base</label>
          <Select value={lv ?? ""} onChange={(e) => setLeftV(Number(e.target.value))} className="w-32">
            {sorted.map((w) => (
              <option key={w.version} value={w.version}>
                v{w.version}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Compare</label>
          <Select value={rv ?? ""} onChange={(e) => setRightV(Number(e.target.value))} className="w-32">
            {sorted.map((w) => (
              <option key={w.version} value={w.version}>
                v{w.version}
              </option>
            ))}
          </Select>
        </div>
        <span className="self-end text-sm text-muted-foreground">
          {changes === 0 ? "No differences" : `${changes} changed line${changes !== 1 ? "s" : ""}`}
        </span>
      </div>

      <pre className="max-h-[40rem] overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
        {diff.map((d, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap px-1 font-mono",
              d.type === "add" && "bg-chart-2/15 text-chart-2",
              d.type === "del" && "bg-destructive/15 text-destructive"
            )}
          >
            <span className="select-none opacity-60">
              {d.type === "add" ? "+ " : d.type === "del" ? "- " : "  "}
            </span>
            {d.text}
          </div>
        ))}
      </pre>
    </div>
  )
}
