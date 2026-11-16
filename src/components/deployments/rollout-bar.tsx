import type { RolloutInterval } from "@/api/types"
import { cn } from "@/lib/utils"

const FILLS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"]

/**
 * A channel's rollout: which workflow revision serves each slice of its 100
 * routing buckets. Drawn to scale, one colour per workflow revision, with the
 * shares written out beside it so the bar is never the only carrier.
 */
export function RolloutBar({ rollouts, workflow }: { rollouts: RolloutInterval[]; workflow: string }) {
  const sorted = [...rollouts].sort((a, b) => a.start_bucket - b.start_bucket)
  const revisions = [...new Set(sorted.map((r) => r.workflow_revision))].sort((a, b) => a - b)
  const fill = (rev: number) => FILLS[revisions.indexOf(rev) % FILLS.length]
  const share = new Map<number, number>()
  for (const r of sorted) share.set(r.workflow_revision, (share.get(r.workflow_revision) ?? 0) + r.end_bucket - r.start_bucket)
  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Rollout of ${workflow}`}>
        {sorted.map((r) => (
          <div
            key={`${r.start_bucket}-${r.workflow_revision}`}
            className={cn("h-full", fill(r.workflow_revision))}
            style={{ width: `${r.end_bucket - r.start_bucket}%` }}
            title={`buckets ${r.start_bucket}–${r.end_bucket - 1}: ${workflow} r${r.workflow_revision}`}
          />
        ))}
      </div>
      <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {revisions.map((rev) => (
          <span key={rev} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", fill(rev))} aria-hidden />
            {workflow} r{rev}: {share.get(rev)}%
          </span>
        ))}
      </p>
    </div>
  )
}
