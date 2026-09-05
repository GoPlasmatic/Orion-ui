import { useMemo, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import type { LucideIcon } from "lucide-react"
import { useEngineStatus } from "@/hooks/use-engine"
import { useTraces } from "@/hooks/use-traces"
import { useTraceDlq } from "@/hooks/use-trace-dlq"
import { useAuditLogs } from "@/hooks/use-audit"
import { useChannels } from "@/hooks/use-channels"
import { useConnectors } from "@/hooks/use-connectors"
import { useWorkflows } from "@/hooks/use-workflows"
import { useCronStatus } from "@/hooks/use-cron"
import {
  DEFAULT_TRAFFIC_WINDOW,
  TRAFFIC_WINDOWS,
  useCronMetrics,
} from "@/hooks/use-metrics"
import { useAttentionItems, type AttentionItem, type AttentionKind } from "@/hooks/use-attention"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { GettingStarted } from "@/components/shared/getting-started"
import { isFirstRun } from "@/lib/onboarding"
import { Sparkline } from "@/components/ui/sparkline"
import { formatDate, formatDuration, formatRelative, serverTime, cn } from "@/lib/utils"
import {
  traceStatusBadgeClass,
  statusChartColor,
  occurrenceStatusBadgeClass,
} from "@/lib/status"
import { errorLevel, healthText } from "@/lib/traffic-encoding"
import { auditResourceRoute } from "@/lib/audit-routes"
import { buildIndex } from "@/lib/topology"
import { buildSystemGraph } from "@/lib/system-graph"
import {
  Activity,
  RefreshCw,
  AlertTriangle,
  Blocks,
  CalendarClock,
  ZapOff,
  CircleOff,
  CheckCircle2,
  ChevronRight,
  Network,
  Plug,
  ShieldAlert,
} from "lucide-react"

/** Rows the outcome chart will draw before it starts saying "top N of M". */
const OUTCOME_ROWS = 8
/** Rows a summary table shows before deferring to its own page. */
const TABLE_ROWS = 8
/** Stack order for the outcome chart: what ran first, what did not after. */
const OUTCOME_ORDER = ["ok", "error", "timeout", "unauthorized", "duplicate"]
/** Schedules due within this long make the "next runs" strip. */
const UPCOMING_MS = 24 * 60 * 60 * 1000

const KIND_ICON: Record<AttentionKind, LucideIcon> = {
  quarantine: ShieldAlert,
  connector: Plug,
  plugin: Blocks,
  erroring: AlertTriangle,
  occurrence: CalendarClock,
  component: AlertTriangle,
  task: Activity,
  breaker: ZapOff,
  trace: AlertTriangle,
}

/** A short span for a label: "48 s", "4 m 20 s", "1 h 5 m". */
function formatSpan(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return rem ? `${m} m ${rem} s` : `${m} m`
  const h = Math.floor(m / 60)
  return `${h} h ${m % 60} m`
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function KpiCard({
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

export function OperationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // The window every windowed figure on this page shares, in the URL like the
  // map's so a link carries it.
  const [params, setParams] = useSearchParams()
  const requestedWindow = Number(params.get("window"))
  const windowSec = TRAFFIC_WINDOWS.some((w) => w.value === requestedWindow)
    ? requestedWindow
    : DEFAULT_TRAFFIC_WINDOW

  const { items: alerts, traffic, metrics, breakers, hasCron, channelIdByName, windowLabel, now } =
    useAttentionItems(windowSec)
  const { data: engine } = useEngineStatus()
  // `orion_workflow_duration_seconds{workflow}` labels by workflow *id* (the
  // authored id, never a caller-supplied value — that is what bounds the label
  // cardinality). Join against the list so the table reads as names.
  const { data: workflowList } = useWorkflows({ limit: 1000 })
  const { data: channelList } = useChannels({ limit: 1000 })
  const { data: connectorList } = useConnectors({ limit: 1000 })
  const { data: recentTraces } = useTraces(
    { limit: 6, sort_by: "created_at", sort_order: "desc" },
    { refetchInterval: 15_000 },
  )
  const { data: recentChanges } = useAuditLogs({ limit: 6 }, { refetchInterval: 30_000 })
  // Backlogs. An async failure queue is the most important number an operator
  // is not shown anywhere else on the front page.
  const { data: dlq } = useTraceDlq({ limit: 1 }, { refetchInterval: 30_000 })
  const { data: dlqExhausted } = useTraceDlq({ limit: 1, exhausted: true }, { refetchInterval: 30_000 })
  const { data: schedules } = useCronStatus({ enabled: hasCron })
  const cron = useCronMetrics()
  const [recentTab, setRecentTab] = useState("traces")

  // The call graph, for the coverage line: a channel reached only by
  // `channel_call` has no ingress series and can never "serve a request" as
  // the exporter counts it, so it is reported as internal rather than idle.
  const graph = useMemo(() => {
    const channels = channelList?.data ?? []
    if (channels.length === 0) return null
    return buildSystemGraph(buildIndex(channels, workflowList?.data ?? [], connectorList?.data ?? []))
  }, [channelList?.data, workflowList?.data, connectorList?.data])

  // Nothing live yet: the checklist leads, everything else waits below it.
  const firstRun =
    !!engine && !!channelList && !!workflowList && isFirstRun({ activeChannels: engine.channels.length })
  const firstRunState = {
    workflows: workflowList?.total ?? workflowList?.data.length ?? 0,
    activeWorkflows: engine?.active_workflows ?? 0,
    channels: channelList?.total ?? channelList?.data.length ?? 0,
    activeChannels: engine?.channels.length ?? 0,
    traces: recentTraces?.data.length ?? 0,
  }

  const windowed = traffic.hasRate
  // The buffer holds only what this page has seen: a dashboard opened a minute
  // ago does not have five minutes of history, and the label must not imply
  // it does. The same "so far" the map's window selector shows.
  const spanShort = windowed && traffic.spanSec < windowSec
  const covered = spanShort ? ` · ${formatSpan(traffic.spanSec)} so far` : ""
  // Two spellings of the same span: a label ("last 5 min") and a clause that
  // reads inside a sentence ("in the last 5 min" / "since the engine started").
  const basis = windowed ? `last ${windowLabel}${covered}` : "since the engine started"
  const inBasis = windowed
    ? `in the last ${windowLabel}${spanShort ? ` (${formatSpan(traffic.spanSec)} buffered so far)` : ""}`
    : "since the engine started"
  const openBreakers = breakers?.enabled
    ? Object.values(breakers.breakers ?? {}).filter((s) => s !== "closed").length
    : 0

  /**
   * Busiest channels in the window, anything with errors first.
   *
   * A straight top-8 by volume once let the KPI strip report a 10% error rate
   * above a table where every visible row read 0.0% — the one failing channel
   * sat at rank 9 and never appeared. A summary table that hides the exception
   * is worse than no table.
   */
  const topChannels = (
    windowed
      ? traffic.channels
          .filter((c) => c.windowed > 0)
          .map((c) => ({
            channel: c.channel,
            rate: c.ratePerMin,
            errorPct: c.errorPct ?? 0,
            p95Ms: c.p95Ms,
            requests: c.windowed,
          }))
      : metrics.channels.map((c) => ({
          channel: c.channel,
          rate: c.ratePerMin,
          errorPct: c.errorPct,
          p95Ms: c.p95Ms,
          requests: c.total,
        }))
  )
    .sort(
      (a, b) =>
        Number(a.errorPct <= 0) - Number(b.errorPct <= 0) ||
        b.requests - a.requests ||
        a.channel.localeCompare(b.channel),
    )
    .slice(0, TABLE_ROWS)
  const promotedErrors = topChannels.some((c) => c.errorPct > 0)

  // Coverage, as a statistic rather than an alert. Three numbers, because "6
  // of 62 have served a request" was true and misleading: most of the rest are
  // reached inside the engine and the exporter cannot see them at all.
  const servingChannels = new Set(metrics.channels.filter((c) => c.total > 0).map((c) => c.channel))
  const totalChannels = engine?.channels.length ?? 0
  const coverage = (() => {
    if (!graph) return null
    let serving = 0
    let internal = 0
    let idle = 0
    for (const n of graph.nodes) {
      if (n.unresolved || n.status !== "active") continue
      if (servingChannels.has(n.id)) serving++
      else if (n.callers.length > 0) internal++
      else idle++
    }
    return { serving, internal, idle }
  })()

  // ---- Outcome distribution ----
  //
  // Each channel's *share* of outcomes inside the window rather than raw
  // counts: with counts the busiest channel set the scale and a 1% error
  // segment on it was a hairline, while a small channel failing every request
  // was a short bar that read as "quiet". The count is in the tooltip.
  const outcomeSource = windowed
    ? traffic.channels
        .filter((c) => c.windowed > 0)
        .map((c) => ({
          channel: c.channel,
          segments: Object.entries(c.byStatus).map(([status, value]) => ({ status, value })),
        }))
    : metrics.outcomeByChannel.filter((c) => c.channel)
  const workflowNames = new Map((workflowList?.data ?? []).map((w) => [w.workflow_id, w.name]))
  const outcomeStatuses = Array.from(
    new Set(outcomeSource.flatMap((c) => c.segments.map((s) => s.status))),
  ).sort((a, b) => {
    const ia = OUTCOME_ORDER.indexOf(a)
    const ib = OUTCOME_ORDER.indexOf(b)
    return (ia === -1 ? OUTCOME_ORDER.length : ia) - (ib === -1 ? OUTCOME_ORDER.length : ib) || a.localeCompare(b)
  })
  const outcomeData = outcomeSource.map((c) => {
    const row: Record<string, number | string> = { channel: c.channel }
    let total = 0
    let failed = 0
    for (const s of c.segments) {
      total += s.value
      if (s.status === "error" || s.status === "timeout") failed += s.value
      row[`__count_${s.status}`] = s.value
    }
    for (const s of c.segments) row[s.status] = total > 0 ? (s.value / total) * 100 : 0
    row.__total = total
    row.__failed = failed
    return row
  })
  const shownOutcomes = [...outcomeData]
    .sort(
      (a, b) =>
        Number((b.__failed as number) > 0) - Number((a.__failed as number) > 0) ||
        (b.__total as number) - (a.__total as number),
    )
    .slice(0, OUTCOME_ROWS)

  // Schedules due soon, soonest first.
  const upcoming = (schedules ?? [])
    .map((s) => ({ ...s, at: serverTime(s.next_fire_at) }))
    .filter((s): s is typeof s & { at: number } => s.at != null && s.at - now <= UPCOMING_MS)
    .sort((a, b) => a.at - b.at)
  const nextRun = upcoming[0]
  const cronPending = cron.pending ?? (schedules ?? []).reduce((n, s) => n + (s.pending ?? 0), 0)

  const handleRefresh = () => {
    for (const key of [
      "metrics",
      "engine",
      "health",
      "traces",
      "connectors",
      "channels",
      "cron",
      "trace-dlq",
      "audit-logs",
    ]) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
  }

  const errorRateLevel = errorLevel(traffic.errorPct)

  const recentCard = (
    <Card className="flex flex-col">
      <Tabs value={recentTab} onValueChange={setRecentTab} defaultValue="traces">
        <CardHeader className="flex h-[3.25rem] shrink-0 flex-row items-center justify-between pb-2">
          <TabsList className="h-8">
            <TabsTrigger value="traces">Recent traces</TabsTrigger>
            <TabsTrigger value="changes">Recent changes</TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(recentTab === "traces" ? "/traces" : "/audit")}
          >
            View all
          </Button>
        </CardHeader>
        <CardContent className="flex-1">
          {recentTab === "traces" ? (
            recentTraces?.data && recentTraces.data.length > 0 ? (
              <div className="space-y-2" role="list">
                {recentTraces.data.map((trace) => (
                  <button
                    key={trace.id}
                    type="button"
                    role="listitem"
                    className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors outline-none hover:border-border-strong hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60"
                    onClick={() => navigate(`/traces/${trace.id}`)}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Badge variant="outline" className={traceStatusBadgeClass(trace.status)}>
                        {trace.status}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{trace.channel}</p>
                        {trace.status === "failed" && trace.error_message && (
                          <p className="truncate text-xs text-destructive" title={trace.error_message}>
                            {trace.error_message}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {trace.mode}
                      </Badge>
                    </div>
                    <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      <span title={formatDate(trace.created_at)}>
                        {formatRelative(trace.created_at, now) ?? formatDate(trace.created_at)}
                      </span>
                      {trace.duration_ms != null && (
                        <span className="block">{formatDuration(trace.duration_ms)}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">No recent traces</p>
            )
          ) : recentChanges?.data && recentChanges.data.length > 0 ? (
            // "What changed?" is the first question after an incident; the
            // audit log used to be four clicks from here.
            <div className="space-y-2" role="list">
              {recentChanges.data.map((entry) => {
                const to = auditResourceRoute(entry.resource_type, entry.resource_id)
                return (
                  <div
                    key={entry.id}
                    role="listitem"
                    className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Badge variant="outline" className="shrink-0">
                        {entry.action}
                      </Badge>
                      <span className="shrink-0 text-xs text-muted-foreground">{entry.resource_type}</span>
                      {to ? (
                        <Link to={to} className="truncate font-mono text-xs text-primary hover:underline">
                          {entry.resource_id}
                        </Link>
                      ) : (
                        <span className="truncate font-mono text-xs">{entry.resource_id}</span>
                      )}
                    </div>
                    <span className="shrink-0 text-right text-xs text-muted-foreground">
                      <span className="block">{entry.principal}</span>
                      <span title={formatDate(entry.created_at)}>
                        {formatRelative(entry.created_at, now) ?? formatDate(entry.created_at)}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">No changes recorded</p>
          )}
        </CardContent>
      </Tabs>
    </Card>
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Operations" description="Live engine activity and what needs attention">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {traffic.available
              ? `live · updated ${formatRelative(traffic.lastUpdated, now) ?? "—"}`
              : "metrics offline"}
          </span>
          <Select
            value={String(windowSec)}
            onChange={(e) =>
              setParams(
                e.target.value === String(DEFAULT_TRAFFIC_WINDOW) ? {} : { window: e.target.value },
                { replace: true },
              )
            }
            className="w-28"
            aria-label="Traffic window"
            title="Every windowed figure on this page covers this long"
          >
            {TRAFFIC_WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </Select>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </PageHeader>

      {firstRun && <GettingStarted state={firstRunState} />}

      {/* Health strip */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4 text-sm">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            {engine ? (
              <Badge
                variant="outline"
                className={traceStatusBadgeClass(alerts.length === 0 ? "completed" : "failed")}
              >
                {alerts.length === 0 ? "all clear" : `${alerts.length} to look at`}
              </Badge>
            ) : (
              <Skeleton className="h-5 w-16" />
            )}
          </div>
          <Strip label="Version" value={engine?.version ?? "—"} mono />
          <Strip label="Uptime" value={engine ? formatUptime(engine.uptime_seconds) : "—"} />
          <Strip
            label="Workflows"
            value={engine ? `${engine.active_workflows}/${engine.workflows_count} active` : "—"}
          />
          <Strip label="Channels" value={engine ? String(engine.channels.length) : "—"} />
          {breakers?.instance_id && (
            <Strip
              label="Node"
              value={breakers.instance_id.slice(0, 8)}
              mono
              title={`${breakers.instance_id} — breaker state and plugin load state are per replica`}
            />
          )}
        </CardContent>
      </Card>

      {/* KPI strip — every figure over the selected window */}
      {traffic.available ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="Requests / min"
            value={traffic.totalRatePerMin == null ? "—" : Math.round(traffic.totalRatePerMin).toLocaleString()}
            hint={windowed ? basis : "waiting for a second sample"}
            series={traffic.series.rate}
            colorClass="text-chart-1"
            to="/system-map"
          />
          <KpiCard
            title="Error rate"
            value={traffic.errorPct == null ? "—" : traffic.errorPct.toFixed(1)}
            unit={traffic.errorPct == null ? undefined : "%"}
            hint={traffic.errorPct == null ? `no traffic ${inBasis}` : basis}
            series={traffic.series.errorPct}
            colorClass="text-destructive"
            // The same bands the map paints — a figure past them reads in ink.
            valueClass={
              errorRateLevel === "warning" || errorRateLevel === "critical"
                ? healthText[errorRateLevel]
                : undefined
            }
            to="/traces?status=failed"
          />
          <KpiCard
            title="Avg latency"
            value={traffic.meanMs == null ? "—" : formatDuration(traffic.meanMs)}
            hint={traffic.meanMs == null ? undefined : basis}
            series={traffic.series.meanMs}
            colorClass="text-chart-3"
          />
          <KpiCard
            title="Latency p95"
            value={traffic.p95Ms == null ? "—" : formatDuration(traffic.p95Ms)}
            hint={traffic.p95Ms == null ? undefined : basis}
          />
        </div>
      ) : (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Metrics are unavailable. Enable <code className="font-mono">[metrics]</code> on the
            Orion engine to see live request rate, error rate, latency, outcomes and per-channel
            traffic. Health, backlogs, traces and the attention list below do not depend on it.
          </CardContent>
        </Card>
      )}

      {/* Backlogs — what is waiting on a person, and what is due */}
      <div className={cn("grid gap-4 sm:grid-cols-2", hasCron ? "lg:grid-cols-4" : "lg:grid-cols-2")}>
        <KpiCard
          title="Trace DLQ"
          value={dlq?.total == null ? "—" : dlq.total.toLocaleString()}
          hint={
            dlq?.total == null
              ? "async failures waiting on a retry"
              : `${(dlqExhausted?.total ?? 0).toLocaleString()} exhausted · async failures waiting on a retry`
          }
          valueClass={(dlqExhausted?.total ?? 0) > 0 ? "text-destructive" : undefined}
          to="/trace-dlq"
        />
        <KpiCard
          title="Open breakers"
          value={breakers ? String(openBreakers) : "—"}
          hint={breakers && !breakers.enabled ? "breakers are disabled on this engine" : "this node only"}
          valueClass={openBreakers > 0 ? "text-warning" : undefined}
          to="/circuit-breakers"
        />
        {hasCron && (
          <KpiCard
            title="Cron backlog"
            value={cronPending.toLocaleString()}
            hint={
              cron.lagP95Sec != null
                ? `lag p95 ${cron.lagP95Sec.toFixed(1)}s · ${cron.leaseRenewalFailures} lease renewals lost`
                : "occurrences waiting for a worker"
            }
            valueClass={cronPending > 0 ? "text-warning" : undefined}
            to="/schedules"
          />
        )}
        {hasCron && (
          <KpiCard
            title="Next scheduled run"
            value={nextRun ? (formatRelative(nextRun.at, now) ?? "—") : "—"}
            hint={
              nextRun
                ? `${nextRun.channel_name}${nextRun.last_status ? ` · last run ${nextRun.last_status}` : ""}`
                : "nothing due in the next 24 h"
            }
            to="/schedules"
          />
        )}
      </div>

      {/* Paired cards stretch rather than start-align: with each list bounded and
          scrolling inside its own card, equal heights remove the dead column a
          tall card used to leave beside a short one. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Needs attention — the list lives in hooks/use-attention.ts, which the
            sidebar counts too, so the badge and this card cannot disagree. */}
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="flex h-[3.25rem] shrink-0 flex-row items-center justify-between pb-2">
            <CardTitle>Needs attention</CardTitle>
            {alerts.length > 0 && (
              <Badge variant="outline" className={traceStatusBadgeClass("failed")}>
                {alerts.length}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            {alerts.length === 0 ? (
              // Centred rather than top-aligned: paired cards stretch to equal
              // heights, and a one-line all-clear pinned to the top of a tall
              // card reads as something failing to load.
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
                <CheckCircle2 className="h-5 w-5 text-success" />
                <p className="text-sm font-medium">All clear</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Nothing quarantined, no connector or plugin failed to load, no channel failing{" "}
                  {inBasis}, no scheduled run failed in the last day, no background task
                  restarted, no open circuit breakers, no failed traces in the last hour.
                </p>
              </div>
            ) : (
              // Bounded and scrolled: a dashboard card reports how much there is
              // and shows the worst of it. It does not grow until it owns the page.
              <div className="max-h-[19rem] space-y-2 overflow-y-auto pr-1" role="list">
                {alerts.map((a) => (
                  <AttentionRow
                    key={a.key}
                    item={a}
                    onOpen={() => navigate(a.to)}
                    onMap={
                      a.channel
                        ? () => navigate(`/system-map?select=${encodeURIComponent(a.channel as string)}`)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              <CircleOff className="h-3.5 w-3.5" />
              {!traffic.available ? (
                <span>
                  <span className="font-medium tabular-nums text-foreground">{totalChannels}</span>{" "}
                  channels loaded · which of them serve needs{" "}
                  <code className="font-mono">[metrics]</code>
                </span>
              ) : coverage ? (
                <span>
                  <span className="font-medium tabular-nums text-foreground">{coverage.serving}</span>{" "}
                  serving ·{" "}
                  <span
                    className="font-medium tabular-nums text-foreground"
                    title="Reached only by channel_call — dispatched inside the engine, so the exporter carries no series for them"
                  >
                    {coverage.internal}
                  </span>{" "}
                  internal (unmetered) ·{" "}
                  <span className="font-medium tabular-nums text-foreground">{coverage.idle}</span>{" "}
                  idle since the engine started
                </span>
              ) : (
                <span>
                  <span className="font-medium tabular-nums text-foreground">
                    {servingChannels.size}
                  </span>{" "}
                  of {totalChannels} channels have served a request since the engine started
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => navigate("/system-map")}
              >
                System Map
              </Button>
            </div>
          </CardContent>
        </Card>

        {traffic.available ? (
          <Card className="flex min-h-0 flex-col">
            <CardHeader className="flex h-[3.25rem] shrink-0 flex-row items-center justify-between pb-2">
              <CardTitle>Outcomes by channel</CardTitle>
              <span className="text-xs text-muted-foreground">
                {outcomeData.length > OUTCOME_ROWS ? `top ${OUTCOME_ROWS} of ${outcomeData.length} · ` : ""}
                {basis}
              </span>
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
              {outcomeData.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No message activity {inBasis}.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={Math.max(140, shownOutcomes.length * 34)}>
                    <BarChart
                      data={shownOutcomes}
                      layout="vertical"
                      margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
                    >
                      <XAxis type="number" hide domain={[0, 100]} />
                      <YAxis
                        type="category"
                        dataKey="channel"
                        width={110}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                      />
                      <Tooltip
                        cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                        contentStyle={{
                          background: "var(--popover)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        formatter={(value, name, item) => {
                          const row = (item as { payload?: Record<string, unknown> }).payload
                          const count = row?.[`__count_${String(name)}`]
                          const share = `${Number(value).toFixed(1)}%`
                          return [
                            typeof count === "number" ? `${share} · ${count.toLocaleString()}` : share,
                            String(name),
                          ]
                        }}
                      />
                      {outcomeStatuses.map((s, i) => (
                        <Bar
                          key={s}
                          dataKey={s}
                          stackId="a"
                          fill={statusChartColor(s)}
                          radius={i === outcomeStatuses.length - 1 ? [0, 4, 4, 0] : 0}
                          className="cursor-pointer"
                          onClick={(entry) => {
                            const rec = entry as unknown as { payload?: { channel?: unknown }; channel?: unknown }
                            const channel = rec?.payload?.channel ?? rec?.channel
                            if (typeof channel === "string") {
                              navigate(`/traces?channel=${encodeURIComponent(channel)}`)
                            }
                          }}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {outcomeStatuses.map((s) => (
                      <span key={s} className="inline-flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: statusChartColor(s) }}
                        />
                        {s}
                      </span>
                    ))}
                    <span className="ml-auto">share of each channel's outcomes</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          recentCard
        )}
      </div>

      {traffic.available && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Top channels */}
          <Card className="flex flex-col">
            <CardHeader className="flex h-[3.25rem] shrink-0 flex-row items-center justify-between pb-2">
              <CardTitle>Top channels</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{basis}</span>
                <Button variant="ghost" size="sm" onClick={() => navigate("/channels")}>
                  View all
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              {topChannels.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No channel traffic {inBasis}.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Channel</TableHead>
                      <TableHead className="text-right">Req / min</TableHead>
                      <TableHead className="text-right">Error %</TableHead>
                      <TableHead className="text-right">p95</TableHead>
                      <TableHead className="text-right">{windowed ? "Requests" : "Total"}</TableHead>
                      <TableHead className="w-px" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topChannels.map((c) => {
                      const id = channelIdByName.get(c.channel)
                      const mapTo = `/system-map?select=${encodeURIComponent(c.channel)}`
                      return (
                        <TableRow
                          key={c.channel}
                          className="cursor-pointer"
                          tabIndex={0}
                          onClick={() => navigate(id ? `/channels/${id}` : mapTo)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && e.target === e.currentTarget) e.currentTarget.click()
                          }}
                        >
                          <TableCell className="min-w-32 max-w-0 truncate font-medium" title={c.channel}>
                            {c.channel}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c.rate == null ? "—" : Math.round(c.rate)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span
                              className={c.errorPct > 0 ? "text-destructive" : "text-muted-foreground"}
                            >
                              {c.errorPct.toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {formatDuration(c.p95Ms)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {c.requests.toLocaleString()}
                          </TableCell>
                          <TableCell className="pl-0">
                            <Link
                              to={mapTo}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                              aria-label={`Open ${c.channel} in the System Map`}
                              title="Open in the System Map"
                            >
                              <Network className="h-3.5 w-3.5" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                {promotedErrors ? "Channels with errors are listed first, then by volume. " : ""}
                Every column is {inBasis}. Channels reached only by{" "}
                <code className="font-mono">channel_call</code> carry no series and are not listed.
              </p>
            </CardContent>
          </Card>

          {recentCard}
        </div>
      )}

      {/* Due soon. A nightly job that fails never enters the DLQ and may leave
          no trace, so its place on the front page is here and in the list above. */}
      {hasCron && (
        <Card>
          <CardHeader className="flex h-[3.25rem] flex-row items-center justify-between pb-2">
            <CardTitle>Scheduled in the next 24 h</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/schedules")}>
              View all
            </Button>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {(schedules ?? []).length === 0
                  ? "No active cron channel."
                  : "Nothing is due in the next 24 hours."}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {upcoming.slice(0, 8).map((s) => (
                  <Link
                    key={s.channel_id}
                    to={`/schedules?channel_id=${encodeURIComponent(s.channel_id)}`}
                    className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors hover:border-border-strong hover:bg-muted/50"
                    title={`${s.schedule} ${s.timezone} · next ${formatDate(s.next_fire_at as string)}`}
                  >
                    <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{s.channel_name}</span>
                    <span className="text-xs text-muted-foreground">{formatRelative(s.at, now)}</span>
                    {s.last_status && (
                      <Badge
                        variant="outline"
                        className={cn("text-xs", occurrenceStatusBadgeClass(s.last_status))}
                        title="Last run"
                      >
                        {s.last_status}
                      </Badge>
                    )}
                    {s.pending > 0 && (
                      <span className="text-xs text-warning" title="Occurrences waiting for a worker">
                        {s.pending} pending
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Workflow cost — new in Orion 1.2. `orion_workflow_duration_seconds`
          measures a whole run and `orion_task_duration_seconds` its task
          bodies, so the difference is the engine's own overhead. Cumulative:
          the histograms are windowable, but the overhead subtraction across
          two of them is not worth the noise at short windows. */}
      {traffic.available && (
        <Card>
          <CardHeader className="flex h-[3.25rem] flex-row items-center justify-between pb-2">
            <CardTitle>Workflow cost</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">since the engine started</span>
              <Button variant="ghost" size="sm" onClick={() => navigate("/workflows")}>
                View all
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {metrics.workflows.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No workflow runs recorded yet. A workflow skipped by its condition or rollout gate is
                not measured.
              </p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Workflow</TableHead>
                      <TableHead className="text-right">Runs</TableHead>
                      <TableHead className="text-right">Mean</TableHead>
                      <TableHead className="text-right">p95</TableHead>
                      <TableHead className="text-right">Engine</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metrics.workflows.slice(0, TABLE_ROWS).map((w) => (
                      <TableRow
                        key={w.workflow}
                        className={workflowNames.has(w.workflow) ? "cursor-pointer" : undefined}
                        tabIndex={workflowNames.has(w.workflow) ? 0 : undefined}
                        onClick={
                          workflowNames.has(w.workflow)
                            ? () => navigate(`/workflows/${w.workflow}`)
                            : undefined
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.click()
                        }}
                      >
                        <TableCell className="font-medium" title={w.workflow}>
                          {workflowNames.get(w.workflow) ?? w.workflow}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {w.runs.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatDuration(w.meanMs)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatDuration(w.p95Ms)}
                        </TableCell>
                        <TableCell
                          className="text-right tabular-nums text-muted-foreground"
                          title={
                            w.taskMs == null
                              ? undefined
                              : `${formatDuration(w.taskMs)} in ${w.taskCount} task${w.taskCount === 1 ? "" : "s"}, ${formatDuration(w.overheadMs)} in the engine`
                          }
                        >
                          {formatDuration(w.overheadMs)}
                          {w.overheadPct != null && (
                            <span className="ml-1 text-xs">({w.overheadPct.toFixed(0)}%)</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-3 text-xs text-muted-foreground">
                  <span className="font-medium">Engine</span> is the run minus its task bodies —
                  condition evaluation, group gating, loop bookkeeping and audit writes.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Strip({
  label,
  value,
  mono,
  title,
}: {
  label: string
  value: string
  mono?: boolean
  title?: string
}) {
  return (
    <div className="flex flex-col" title={title}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("font-medium", mono && "font-mono")}>{value}</span>
    </div>
  )
}

function AttentionRow({
  item,
  onOpen,
  onMap,
}: {
  item: AttentionItem
  onOpen: () => void
  onMap?: () => void
}) {
  const Icon = KIND_ICON[item.kind]
  const iconTone = item.tone === "destructive" ? "text-destructive" : "text-warning"
  return (
    <div
      role="listitem"
      className={cn(
        "flex items-stretch rounded-lg border transition-colors",
        // A quarantined channel and a warm circuit breaker are not the same
        // news; the row said they were.
        item.tone === "destructive"
          ? "border-destructive/30 hover:border-destructive/50"
          : "border-warning/30 hover:border-warning/50",
      )}
    >
      <button
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-l-lg px-3 py-2 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <Icon className={cn("h-4 w-4 shrink-0", iconTone)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={item.label}>
            {item.label}
          </p>
          {/* Two lines, not one: the detail is the remedy, and a quarantine
              reason cut off at the card edge is a remedy withheld. */}
          <p className="line-clamp-2 text-xs text-muted-foreground" title={item.detail}>
            {item.detail}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {onMap && (
        <button
          onClick={onMap}
          className="flex shrink-0 items-center gap-1 border-l border-inherit px-2.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          title={`Open ${item.label} in the System Map`}
        >
          <Network className="h-3.5 w-3.5" />
          Map
        </button>
      )}
    </div>
  )
}
