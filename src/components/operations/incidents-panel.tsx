import { Link } from "react-router"
import type { LucideIcon } from "lucide-react"
import {
  Activity,
  AlertTriangle,
  Blocks,
  Boxes,
  CalendarClock,
  Check,
  CheckCircle2,
  Inbox,
  Plug,
  ShieldAlert,
  ZapOff,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { Incident, IncidentKind } from "@/lib/incidents"
import { cn, formatDate, formatRelative } from "@/lib/utils"

const KIND_ICON: Record<IncidentKind, LucideIcon> = {
  quarantine: ShieldAlert,
  connector: Plug,
  plugin: Blocks,
  model: Boxes,
  failing: AlertTriangle,
  failures: AlertTriangle,
  occurrences: CalendarClock,
  component: AlertTriangle,
  task: Activity,
  breaker: ZapOff,
  dlq: Inbox,
  backlog: CalendarClock,
}

/** Channels named inline before "+N more". */
const CHANNELS_SHOWN = 4
const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000))

/**
 * Incidents, not traces: one row per failure signature or live signal, open
 * ones first by severity, recovered ones in green for the hour before they
 * drop off, acknowledged ones folded to a muted line that can be undone.
 */
export function IncidentsPanel({
  incidents,
  isAcked,
  onAcknowledge,
  onUndo,
  label = (name) => name,
  now,
  loading = false,
  className,
}: {
  incidents: Incident[]
  isAcked: (i: Incident) => boolean
  onAcknowledge: (key: string) => void
  onUndo: (key: string) => void
  /** A channel's display name (the domain-short form on a large system). */
  label?: (name: string) => string
  now: number
  loading?: boolean
  className?: string
}) {
  const open = incidents.filter((i) => i.state === "open" && !isAcked(i))
  const resolved = incidents.filter((i) => i.state === "resolved" && !isAcked(i))
  const acked = incidents.filter((i) => isAcked(i))

  return (
    <Card className={cn("flex min-h-0 flex-col", className)}>
      <CardHeader className="flex h-[3.25rem] shrink-0 flex-row items-center justify-between pb-2">
        <CardTitle>Incidents</CardTitle>
        {!loading &&
          (open.length > 0 ? (
            <Badge variant="destructive">{open.length} open</Badge>
          ) : (
            <Badge variant="success">all clear</Badge>
          ))}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : incidents.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <p className="text-sm font-medium">All clear</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Nothing quarantined or refused at load, no channel failing, no failed trace or scheduled
              run in the last day that has not since run clean, no open breaker, nothing exhausted in
              the DLQ.
            </p>
          </div>
        ) : (
          // Bounded and scrolled: the card reports how much there is and shows
          // the worst of it, rather than growing until it owns the page.
          <ul className="max-h-[26rem] space-y-2 overflow-y-auto pr-1" aria-label="Incidents">
            {[...open, ...resolved].map((i) => (
              <IncidentRow
                key={i.key}
                incident={i}
                label={label}
                now={now}
                onAcknowledge={() => onAcknowledge(i.key)}
              />
            ))}
            {acked.map((i) => (
              <li
                key={i.key}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground"
              >
                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" title={i.title}>
                  Acknowledged · {i.title}
                  {i.state === "resolved" ? " · recovered" : ""}
                </span>
                <Button variant="ghost" size="xs" onClick={() => onUndo(i.key)}>
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function IncidentRow({
  incident: i,
  label,
  now,
  onAcknowledge,
}: {
  incident: Incident
  label: (name: string) => string
  now: number
  onAcknowledge: () => void
}) {
  const Icon = KIND_ICON[i.kind]
  const resolved = i.state === "resolved"
  const stripe = resolved ? "bg-success" : i.tone === "destructive" ? "bg-destructive" : "bg-warning"
  const iconTone = resolved ? "text-success" : i.tone === "destructive" ? "text-destructive" : "text-warning"
  const g = i.group
  const shown = i.channels.slice(0, CHANNELS_SHOWN)
  const more = i.channels.length - shown.length

  return (
    <li className="relative flex overflow-hidden rounded-lg border bg-card">
      <span className={cn("w-1 shrink-0", stripe)} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 gap-2.5">
          <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconTone)} aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <Link
              to={i.to}
              className="block truncate text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
              title={g?.sample ?? i.title}
            >
              {i.title}
            </Link>
            {g ? (
              <p className="text-xs text-muted-foreground">
                {i.detail && <span className="font-mono">{i.detail}</span>}
                {i.detail && " · "}
                {g.failures.toLocaleString()} failure{g.failures === 1 ? "" : "s"} on{" "}
                {i.channels.length} channel{i.channels.length === 1 ? "" : "s"} (
                {shown.map((c, n) => (
                  <span key={c.name}>
                    {n > 0 && ", "}
                    <Link
                      to={`/traces?channel=${encodeURIComponent(c.name)}&status=failed`}
                      className="text-foreground hover:underline"
                      title={c.name}
                    >
                      {label(c.name)}
                    </Link>
                    {c.failures > 1 && ` ×${c.failures}`}
                  </span>
                ))}
                {more > 0 && `, +${more} more`}) · first{" "}
                <time title={formatDate(g.first)}>{formatRelative(g.first, now)}</time>, last{" "}
                <time title={formatDate(g.last)}>{formatRelative(g.last, now)}</time>
              </p>
            ) : (
              <p className="line-clamp-2 text-xs text-muted-foreground" title={i.detail}>
                {i.detail}
              </p>
            )}
            {resolved && i.lastSeen != null && (
              <p className="text-xs text-success">
                Recovered · {minutes(now - i.lastSeen)} min clean
                <span className="text-muted-foreground">
                  {i.recoveredBecause ? ` — ${i.recoveredBecause}.` : "."}
                  {i.closesAt != null && ` Closes in ${minutes(i.closesAt - now)} min.`}
                </span>
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-6 sm:pl-0">
          {i.links.map((l) => (
            <Button key={l.label} variant="outline" size="xs" asChild>
              <Link to={l.to}>{l.label}</Link>
            </Button>
          ))}
          <Button
            variant={resolved ? "outline" : "secondary"}
            size="xs"
            onClick={onAcknowledge}
            title="Fold this incident away in this browser until it fails again"
          >
            Acknowledge
          </Button>
        </div>
      </div>
    </li>
  )
}
