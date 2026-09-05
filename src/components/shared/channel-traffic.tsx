import { Link } from "react-router"
import { ArrowUpRight } from "lucide-react"
import { useTraces } from "@/hooks/use-traces"
import {
  DEFAULT_TRAFFIC_WINDOW,
  trafficWindowLabel,
  useChannelTraffic,
} from "@/hooks/use-metrics"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { OutcomeBar, OutcomeLegend, TrafficSparklines } from "@/components/shared/outcome-bar"
import { traceStatusBadgeClass } from "@/lib/status"
import {
  compactNumber,
  formatMs,
  formatPct,
  healthOf,
  healthText,
} from "@/lib/traffic-encoding"
import { cn, formatDate, formatDuration, formatRelative } from "@/lib/utils"

/**
 * The channel's own traffic, on its own page. The dashboard and the map knew
 * a channel's rate, error share and p95; the page about the channel did not.
 */
export function ChannelTrafficCard({ channelName }: { channelName: string }) {
  const traffic = useChannelTraffic(DEFAULT_TRAFFIC_WINDOW)
  const t = traffic.byChannel.get(channelName)
  const series = traffic.seriesFor(channelName)
  const windowLabel = trafficWindowLabel(DEFAULT_TRAFFIC_WINDOW)
  const level = healthOf(t)
  const metricsOff = !traffic.isLoading && !traffic.available

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          Traffic
          <span className="text-xs font-normal text-muted-foreground">
            {metricsOff ? "metrics off" : traffic.hasRate ? `last ${windowLabel}` : "waiting for a second sample"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {metricsOff ? (
          <p className="text-sm text-muted-foreground">
            Metrics are off on this server (<code className="font-mono">[metrics]</code>), so
            there is no rate, error share or latency to show. Traces below still record every run.
          </p>
        ) : !t || t.windowed === 0 ? (
          <div className="text-sm text-muted-foreground">
            <p>No requests reached this channel in the last {windowLabel}.</p>
            {t && t.total > 0 && (
              <p className="mt-1 text-xs">{t.total.toLocaleString()} since the engine started.</p>
            )}
            {!t && (
              <p className="mt-1 text-xs">
                No series at all: either nothing has ever reached it, or it is reached only by{" "}
                <code className="font-mono">channel_call</code>, which the exporter does not count.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Rate</dt>
                <dd className="font-mono tabular-nums">{compactNumber(t.ratePerMin)}/min</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{level === "notice" ? "Rejected" : "Errors"}</dt>
                <dd className={cn("font-mono tabular-nums", healthText[level])}>
                  {level === "notice" ? formatPct(t.rejectedPct) : formatPct(t.errorPct)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">p95</dt>
                <dd className="font-mono tabular-nums">{formatMs(t.p95Ms)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Requests</dt>
                <dd className="font-mono tabular-nums">
                  {t.windowed.toLocaleString()}
                  <span className="ml-1 text-xs text-muted-foreground">
                    · {t.total.toLocaleString()} since start
                  </span>
                </dd>
              </div>
            </dl>
            <TrafficSparklines series={series} />
            <OutcomeBar traffic={t} />
            <OutcomeLegend traffic={t} inline />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** The channel's last few runs, failures first in colour, one click to each. */
export function ChannelRecentTraces({ channelName }: { channelName: string }) {
  const { data, isLoading } = useTraces(
    { channel: channelName, limit: 5, sort_by: "created_at", sort_order: "desc" },
    { refetchInterval: 15_000 },
  )
  const rows = data?.data ?? []
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          Recent traces
          <Button variant="ghost" size="xs" asChild>
            <Link to={`/traces?channel=${encodeURIComponent(channelName)}`}>
              All traces <ArrowUpRight />
            </Link>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No trace recorded for this channel yet.
          </p>
        ) : (
          <div className="space-y-1.5">
            {rows.map((trace) => (
              <Link
                key={trace.id}
                to={`/traces/${trace.id}`}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-sm transition-colors hover:border-border-strong hover:bg-muted/50"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Badge variant="outline" className={cn("shrink-0", traceStatusBadgeClass(trace.status))}>
                    {trace.status}
                  </Badge>
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {trace.mode}
                  </Badge>
                  {trace.error_message && (
                    <span className="truncate text-xs text-destructive" title={trace.error_message}>
                      {trace.error_message}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  <span title={formatDate(trace.created_at)}>
                    {formatRelative(trace.created_at) ?? formatDate(trace.created_at)}
                  </span>
                  {trace.duration_ms != null && <span className="ml-2">{formatDuration(trace.duration_ms)}</span>}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
