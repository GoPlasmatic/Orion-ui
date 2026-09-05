import { Link } from "react-router"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Sparkline } from "@/components/ui/sparkline"
import { cn } from "@/lib/utils"

/**
 * One figure with what it covers and, when there is one, where it leads. The
 * dashboard's KPI strip and the scheduler's numbers are the same tile, so the
 * two pages read as one console.
 */
export function KpiCard({
  title,
  value,
  unit,
  hint,
  series,
  colorClass,
  valueClass,
  to,
}: {
  title: string
  value: string
  unit?: string
  /** What the number covers — a window, or since start. */
  hint?: string
  series?: number[]
  colorClass?: string
  /** Colours the figure itself when it crosses a band; unset leaves it plain. */
  valueClass?: string
  /** Where the card leads; a KPI with nowhere to go is a dead end. */
  to?: string
}) {
  const card = (
    <Card interactive={!!to} className="h-full">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-2">
          <p className={cn("text-2xl font-bold tabular-nums", valueClass)}>
            {value}
            {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
          </p>
          {series && series.length >= 2 && (
            <Sparkline values={series} className={cn("w-24", colorClass)} />
          )}
        </div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
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
