import type { ReactNode } from "react"
import { useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { useEngineStatus } from "@/hooks/use-engine"
import { useHealth } from "@/hooks/use-health"
import { useMetrics } from "@/hooks/use-metrics"
import { useTraces } from "@/hooks/use-traces"
import { useCircuitBreakers } from "@/hooks/use-connectors"
import { useWorkflows } from "@/hooks/use-workflows"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { Sparkline } from "@/components/ui/sparkline"
import { formatDate, formatDuration, cn } from "@/lib/utils"
import { traceStatusBadgeClass, statusChartColor } from "@/lib/status"
import {
  Activity,
  RefreshCw,
  AlertTriangle,
  ZapOff,
  CircleOff,
  CheckCircle2,
  ChevronRight,
  Plug,
  ShieldAlert,
} from "lucide-react"

/** Rows the outcome chart will draw before it starts saying "top N of M". */
const OUTCOME_ROWS = 8
/** Rows a summary table shows before deferring to its own page. */
const TABLE_ROWS = 8
/** Failure share at which a channel is worth naming on the dashboard. */
const ERRORING_PCT = 1

/** One actionable item in "Needs attention", ordered by how bad it is. */
interface Alert {
  key: string
  /** 0 is worst. Sorted on, so the list order is stable across polls. */
  severity: number
  tone: "destructive" | "warning"
  icon: ReactNode
  label: string
  detail: string
  onClick: () => void
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function relativeTime(ts: number | null): string {
  if (!ts) return "—"
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  return `${m}m ago`
}

function KpiCard({
  title,
  value,
  unit,
  series,
  colorClass,
}: {
  title: string
  value: string
  unit?: string
  series?: number[]
  colorClass?: string
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-2">
          <p className="text-2xl font-bold tabular-nums">
            {value}
            {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
          </p>
          {series && series.length >= 2 && (
            <Sparkline values={series} className={cn("w-24", colorClass)} />
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function OperationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: engine } = useEngineStatus()
  const { data: health } = useHealth()
  const metrics = useMetrics()
  // `orion_workflow_duration_seconds{workflow}` labels by workflow *id* (the
  // authored id, never a caller-supplied value — that is what bounds the label
  // cardinality). Join against the list so the table reads as names.
  const { data: workflowList } = useWorkflows({ limit: 200 })
  const { data: breakers } = useCircuitBreakers({ refetchInterval: 15_000 })
  const { data: recentTraces } = useTraces(
    { limit: 6, sort_by: "created_at", sort_order: "desc" },
    { refetchInterval: 15_000 },
  )
  const { data: failedTraces } = useTraces(
    { limit: 5, status: "failed", sort_by: "created_at", sort_order: "desc" },
    { refetchInterval: 15_000 },
  )

  const isHealthy = health?.status === "ok"

  // ---- Needs attention ----
  //
  // Only things a person should go and do something about.
  //
  // This list used to include every channel that had not served a request,
  // which on any real system is most of them: 52 of 62 here, rendering three
  // thousand pixels of "No traffic" rows that buried the two open breakers and
  // pushed every other card off the screen. An idle channel is the normal
  // resting state, not an incident — and a channel reached only by
  // `channel_call` has no ingress counter at all, so it was *never* going to
  // leave the list however busy it got. Channel coverage is a statistic; it now
  // reads as one, underneath, next to the map that shows it properly.
  const openBreakers = Object.entries(breakers?.breakers ?? {}).filter(
    ([, state]) => state !== "closed",
  )
  /**
   * Channels the metrics say are failing.
   *
   * The failed-trace query cannot stand in for this. On this stack
   * `auth-send-otp` answers HTTP 500 `ENGINE_ERROR` on every request and
   * records **no trace at all** — the failure happens outside the path that
   * persists one. So `admin/traces?status=failed` returned zero while
   * `orion_messages_total{status="error"}` sat at 100%, and the dashboard
   * called it all clear. The counters are the more reliable witness.
   *
   * These are cumulative since the engine started, not windowed, so the detail
   * line says so rather than implying it is happening right now.
   */
  const erroringChannels = metrics.channels
    .filter((c) => c.failed > 0 && c.errorPct >= ERRORING_PCT)
    .sort((a, b) => b.errorPct - a.errorPct || a.channel.localeCompare(b.channel))
  const quarantined = health?.channels?.quarantined ?? []
  const failedConnectors = health?.connectors?.failed_to_load ?? []
  const degraded = Object.entries(health?.components ?? {}).filter(([, state]) => state !== "ok")
  const failed = failedTraces?.data ?? []

  // Severity first, then name, so a poll every 15s does not reshuffle the list
  // under the pointer.
  const alerts: Alert[] = [
    ...quarantined.map(({ channel, reason }) => ({
      key: `quarantine-${channel}`,
      severity: 0,
      tone: "destructive" as const,
      icon: <ShieldAlert className="h-4 w-4 text-destructive" />,
      label: `Quarantined: ${channel}`,
      // The engine names why — an unresolved reference, a secret read where
      // it would be recorded — and that is the whole remedy.
      detail: reason || "Refused at load — the route is not being served",
      onClick: () => navigate("/channels"),
    })),
    ...failedConnectors.map((connector) => ({
      key: `conn-${connector}`,
      severity: 1,
      tone: "destructive" as const,
      icon: <Plug className="h-4 w-4 text-destructive" />,
      label: `Connector failed to load: ${connector}`,
      detail: "Every task using it is failing",
      onClick: () => navigate("/connectors"),
    })),
    ...erroringChannels.map((c) => ({
      key: `err-${c.channel}`,
      severity: 2,
      tone: "destructive" as const,
      icon: <AlertTriangle className="h-4 w-4 text-destructive" />,
      label: `Erroring: ${c.channel}`,
      detail: `${c.errorPct.toFixed(c.errorPct >= 10 ? 0 : 1)}% of processed requests failed since the engine started (${c.failed.toLocaleString()})`,
      onClick: () => navigate(`/traces?channel=${encodeURIComponent(c.channel)}`),
    })),
    ...degraded.map(([component, state]) => ({
      key: `comp-${component}`,
      severity: 3,
      tone: "warning" as const,
      icon: <AlertTriangle className="h-4 w-4 text-warning" />,
      label: `${component} is ${state}`,
      detail: "Reported by /health",
      onClick: () => navigate("/settings"),
    })),
    ...(breakers?.enabled ? openBreakers : []).map(([key, state]) => ({
      key: `brk-${key}`,
      severity: 4,
      tone: "warning" as const,
      icon: <ZapOff className="h-4 w-4 text-warning" />,
      label: `Circuit breaker ${state}`,
      detail: `${key} · this replica only`,
      onClick: () => navigate("/circuit-breakers"),
    })),
    ...failed.map((t) => ({
      key: `fail-${t.id}`,
      severity: 5,
      tone: "destructive" as const,
      icon: <AlertTriangle className="h-4 w-4 text-destructive" />,
      label: `Failed: ${t.channel}`,
      detail: t.error_message ?? formatDate(t.created_at),
      onClick: () => navigate(`/traces/${t.id}`),
    })),
  ].sort((a, b) => a.severity - b.severity || a.label.localeCompare(b.label))

  /**
   * Busiest channels, but anything with errors first.
   *
   * `metrics.channels` is volume-ordered, and a straight top-8 of it let the KPI
   * strip report a 10% error rate above a table where every visible row read
   * 0.0% — the one failing channel sat at rank 9 and never appeared. A summary
   * table that hides the exception is worse than no table.
   */
  const topChannels = [...metrics.channels]
    .sort(
      (a, b) =>
        Number(a.errorPct <= 0) - Number(b.errorPct <= 0) ||
        b.total - a.total ||
        a.channel.localeCompare(b.channel),
    )
    .slice(0, TABLE_ROWS)
  const promotedErrors = topChannels.some((c) => c.errorPct > 0)

  // Coverage, as a statistic rather than an alert.
  const servingChannels = new Set(metrics.channels.filter((c) => c.total > 0).map((c) => c.channel))
  const totalChannels = engine?.channels.length ?? 0

  // ---- Outcome distribution (generic per-channel terminal status mix) ----
  const outcome = metrics.outcomeByChannel.filter((c) => c.channel)
  const workflowNames = new Map((workflowList?.data ?? []).map((w) => [w.workflow_id, w.name]))
  const outcomeStatuses = Array.from(
    new Set(outcome.flatMap((c) => c.segments.map((s) => s.status))),
  )
  const outcomeData = outcome.map((c) => {
    const row: Record<string, number | string> = { channel: c.channel }
    let total = 0
    for (const s of c.segments) {
      row[s.status] = s.value
      total += s.value
    }
    row.__total = total
    return row
  })
  // Busiest first and capped: the chart's height was `rows * 44` with no
  // ceiling, so a system with 60 active channels rendered a 2,600px card.
  const shownOutcomes = [...outcomeData]
    .sort((a, b) => (b.__total as number) - (a.__total as number))
    .slice(0, OUTCOME_ROWS)

  const handleRefresh = () => {
    for (const key of ["metrics", "engine", "health", "traces", "connectors"]) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Operations" description="Live engine activity and what needs attention">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {metrics.available ? `live · updated ${relativeTime(metrics.lastUpdated)}` : "metrics offline"}
          </span>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </PageHeader>

      {/* Health strip */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4 text-sm">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            {health ? (
              <Badge variant="outline" className={traceStatusBadgeClass(isHealthy ? "completed" : "failed")}>
                {health.status}
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
        </CardContent>
      </Card>

      {/* KPI cards */}
      {metrics.available ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="Requests / min"
            value={metrics.requestRatePerMin == null ? "—" : Math.round(metrics.requestRatePerMin).toLocaleString()}
            series={metrics.requestRateSeries}
            colorClass="text-chart-1"
          />
          <KpiCard
            title="Error rate"
            value={metrics.errorRatePct == null ? "—" : metrics.errorRatePct.toFixed(1)}
            unit={metrics.errorRatePct == null ? undefined : "%"}
            series={metrics.errorRateSeries}
            colorClass="text-destructive"
          />
          <KpiCard
            title="Avg latency"
            value={metrics.avgLatencyMs == null ? "—" : formatDuration(metrics.avgLatencyMs)}
            series={metrics.avgLatencySeries}
            colorClass="text-chart-3"
          />
          <KpiCard title="Latency p95" value={metrics.p95Ms == null ? "—" : formatDuration(metrics.p95Ms)} />
        </div>
      ) : (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Metrics are unavailable. Enable <code className="font-mono">[metrics]</code> on the
            Orion engine to see live request rate, error rate, and latency.
          </CardContent>
        </Card>
      )}

      {/* Paired cards stretch rather than start-align: with each list bounded and
          scrolling inside its own card, equal heights remove the dead column a
          tall card used to leave beside a short one. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Needs attention */}
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
                  Nothing quarantined, no connector failed to load, no channel erroring, no open
                  circuit breakers, no failed traces recently.
                </p>
              </div>
            ) : (
              // Bounded and scrolled: a dashboard card reports how much there is
              // and shows the worst of it. It does not grow until it owns the page.
              <div className="max-h-[19rem] space-y-2 overflow-y-auto pr-1">
                {alerts.map((a) => (
                  <AttentionRow
                    key={a.key}
                    icon={a.icon}
                    label={a.label}
                    detail={a.detail}
                    tone={a.tone}
                    onClick={a.onClick}
                  />
                ))}
              </div>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              <CircleOff className="h-3.5 w-3.5" />
              <span>
                <span className="font-medium tabular-nums text-foreground">
                  {servingChannels.size}
                </span>{" "}
                of {totalChannels} channels have served a request since the engine started
              </span>
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

        {/* Outcome distribution */}
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="flex h-[3.25rem] shrink-0 flex-row items-center justify-between pb-2">
            <CardTitle>Outcomes by channel</CardTitle>
            {outcomeData.length > OUTCOME_ROWS && (
              <span className="text-xs text-muted-foreground">
                top {OUTCOME_ROWS} of {outcomeData.length}
              </span>
            )}
          </CardHeader>
          <CardContent className="min-h-0 flex-1">
            {outcomeData.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No message activity yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(140, shownOutcomes.length * 34)}>
                <BarChart data={shownOutcomes} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                  <XAxis type="number" hide />
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
                  />
                  {outcomeStatuses.map((s, i) => (
                    <Bar
                      key={s}
                      dataKey={s}
                      stackId="a"
                      fill={statusChartColor(s)}
                      radius={i === outcomeStatuses.length - 1 ? [0, 4, 4, 0] : 0}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top channels */}
        <Card className="flex flex-col">
          <CardHeader className="flex h-[3.25rem] shrink-0 flex-row items-center justify-between pb-2">
            <CardTitle>Top channels</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/channels")}>
              View all
            </Button>
          </CardHeader>
          <CardContent className="flex-1">
            {metrics.channels.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No channel metrics yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">Req / min</TableHead>
                    <TableHead className="text-right">Error %</TableHead>
                    <TableHead className="text-right">p95</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topChannels.map((c) => (
                    <TableRow key={c.channel}>
                      <TableCell className="max-w-0 truncate font-medium" title={c.channel}>
                        {c.channel}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.ratePerMin == null ? "—" : Math.round(c.ratePerMin)}
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
                        {c.total.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {promotedErrors && (
              <p className="mt-3 text-xs text-muted-foreground">
                Channels with errors are listed first, then by volume.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Recent traces */}
        <Card className="flex flex-col">
          <CardHeader className="flex h-[3.25rem] shrink-0 flex-row items-center justify-between pb-2">
            <CardTitle>Recent traces</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/traces")}>
              View all
            </Button>
          </CardHeader>
          <CardContent className="flex-1">
            {recentTraces?.data && recentTraces.data.length > 0 ? (
              <div className="space-y-2">
                {recentTraces.data.map((trace) => (
                  <button
                    key={trace.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors outline-none hover:border-border-strong hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60"
                    onClick={() => navigate(`/traces/${trace.id}`)}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className={traceStatusBadgeClass(trace.status)}>
                        {trace.status}
                      </Badge>
                      <span className="truncate text-sm font-medium">{trace.channel}</span>
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {trace.mode}
                      </Badge>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatDate(trace.created_at)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">No recent traces</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Workflow cost — new in Orion 1.2. `orion_workflow_duration_seconds`
          measures a whole run and `orion_task_duration_seconds` its task
          bodies, so the difference is the engine's own overhead. Before 1.2
          this existed only as a residual inside the opt-in per-request
          profile, where it absorbed everything else unmeasured. */}
      <Card>
        <CardHeader className="flex h-[3.25rem] flex-row items-center justify-between pb-2">
          <CardTitle>Workflow cost</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => navigate("/workflows")}>
            View all
          </Button>
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
                      onClick={
                        workflowNames.has(w.workflow)
                          ? () => navigate(`/workflows/${w.workflow}`)
                          : undefined
                      }
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
    </div>
  )
}

function Strip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("font-medium", mono && "font-mono")}>{value}</span>
    </div>
  )
}

function AttentionRow({
  icon,
  label,
  detail,
  tone,
  onClick,
}: {
  icon: ReactNode
  label: string
  detail: string
  tone: Alert["tone"]
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60",
        // A quarantined channel and a warm circuit breaker are not the same
        // news; the row said they were.
        tone === "destructive"
          ? "border-destructive/30 hover:border-destructive/50"
          : "border-warning/30 hover:border-warning/50",
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  )
}
