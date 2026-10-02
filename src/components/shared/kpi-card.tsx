import type { ReactNode } from "react"
import { Link } from "react-router"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Sparkline } from "@/components/ui/sparkline"
import { cn } from "@/lib/utils"

/**
 * One figure with what it covers and, when there is one, where it leads. The
 * dashboard's golden signals and the scheduler's numbers are the same tile, so
 * the two pages read as one console.
 *
 * A tile shows a trend (`series`, a sparkline) or a level (`meter`, a filled
 * bar for a gauge with a ceiling — a pool's busy connections over its size),
 * never both. `loading` holds the tile's shape while its source has not
 * answered, so a figure never reads "—" for "not loaded yet".
 */
export function KpiCard({
  title,
  value,
  unit,
  hint,
  hintTitle,
  series,
  meter,
  colorClass,
  valueClass,
  loading = false,
  to,
}: {
  title: string
  value: string
  unit?: string
  /** What the number covers — a window, or since start — or what explains it. */
  hint?: ReactNode
  /** The hint's long form, for a hover. */
  hintTitle?: string
  series?: number[]
  /** A level against a ceiling; drawn as a bar where a sparkline would go. */
  meter?: { value: number; max: number; label: string }
  colorClass?: string
  /** Colours the figure itself when it crosses a band; unset leaves it plain. */
  valueClass?: string
  loading?: boolean
  /** Where the card leads; a KPI with nowhere to go is a dead end. */
  to?: string
}) {
  const fill = meter && meter.max > 0 ? Math.min(100, (meter.value / meter.max) * 100) : 0
  const card = (
    <Card interactive={!!to} className="h-full">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between gap-2">
              <p className={cn("text-2xl font-bold tabular-nums", valueClass)}>
                {value}
                {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
              </p>
              {meter ? (
                <div
                  className="mb-2 h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted"
                  role="meter"
                  aria-label={meter.label}
                  aria-valuemin={0}
                  aria-valuemax={meter.max}
                  aria-valuenow={meter.value}
                  title={meter.label}
                >
                  <div className={cn("h-full rounded-full bg-current", colorClass)} style={{ width: `${fill}%` }} />
                </div>
              ) : (
                series &&
                series.length >= 2 && <Sparkline values={series} className={cn("w-24 shrink-0", colorClass)} />
              )}
            </div>
            {hint && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={hintTitle}>
                {hint}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
  return to ? (
    <Link to={to} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
      {card}
    </Link>
  ) : (
    card
  )
}
