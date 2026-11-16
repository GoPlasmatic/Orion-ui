import { useMemo, useState } from "react"
import type { PaginatedResponse } from "@/api/types"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { diffLines } from "@/lib/line-diff"
import { JsonDiffLines } from "@/components/shared/json-diff"

/** Any versioned entity — a workflow, a channel, a plugin. */
interface Versioned {
  version: number
}

interface VersionCompareProps<T extends Versioned> {
  versions?: PaginatedResponse<T> | T[]
  isLoading?: boolean
}

/** Fields the database owns rather than the author: they differ between any two versions and say nothing. */
const VOLATILE = ["status", "created_at", "updated_at", "content_hash"]

/** Stable JSON view of a version, excluding the volatile fields that aren't part of the definition. */
function definitionJson(entity: Versioned): string {
  const rest: Record<string, unknown> = { ...(entity as unknown as Record<string, unknown>) }
  for (const key of VOLATILE) delete rest[key]
  return JSON.stringify(rest, null, 2)
}

/**
 * Side-by-side(ish) compare of two versions of any versioned entity, rendered
 * as a colored line diff of their definitions. Reuses the version list already
 * loaded for the Versions tab — no extra fetch. A channel's auth secrets come
 * back masked, so two versions with different keys diff as equal there; that
 * is the server's masking, not a missing change.
 */
export function VersionCompare<T extends Versioned>({ versions, isLoading }: VersionCompareProps<T>) {
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
          <Label className="text-xs text-muted-foreground">Base</Label>
          <Select value={lv ?? ""} onChange={(e) => setLeftV(Number(e.target.value))} className="w-32">
            {sorted.map((w) => (
              <option key={w.version} value={w.version}>
                v{w.version}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Compare</Label>
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

      <JsonDiffLines lines={diff} />
    </div>
  )
}
