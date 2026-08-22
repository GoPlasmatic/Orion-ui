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
} from "lucide-react"

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
  const openBreakers = Object.entries(breakers?.breakers ?? {}).filter(
    ([, state]) => state !== "closed",
  )
  const activeChannelSet = new Set(metrics.channels.filter((c) => c.total > 0).map((c) => c.channel))
  const idleChannels = (engine?.channels ?? []).filter((c) => !activeChannelSet.has(c))
  const failed = failedTraces?.data ?? []
  const attentionCount =
    (breakers?.enabled ? openBreakers.length : 0) + failed.length + idleChannels.length

  // ---- Outcome distribution (generic per-channel terminal status mix) ----
  const outcome = metrics.outcomeByChannel.filter((c) => c.channel)
  const outcomeStatuses = Array.from(
    new Set(outcome.flatMap((c) => c.segments.map((s) => s.status))),
  )
  const outcomeData = outcome.map((c) => {
    const row: Record<string, number | string> = { channel: c.channel }
    for (const s of c.segments) row[s.status] = s.value
    return row
  })

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

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* Needs attention */}
        <Card>
          <CardHeader className="flex h-[3.25rem] flex-row items-center justify-between pb-2">
            <CardTitle>Needs attention</CardTitle>
            {attentionCount > 0 && <Badge variant="outline" className={traceStatusBadgeClass("failed")}>{attentionCount}</Badge>}
          </CardHeader>
          <CardContent className="space-y-2">
            {attentionCount === 0 ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" />
                All clear — no open breakers, recent failures, or idle channels.
              </div>
            ) : (
              <>
                {breakers?.enabled &&
                  openBreakers.map(([key, state]) => (
                    <AttentionRow
                      key={`brk-${key}`}
                      icon={<ZapOff className="h-4 w-4 text-destructive" />}
                      label={`Circuit breaker ${state}`}
                      detail={key}
                      onClick={() => navigate("/connectors")}
                    />
                  ))}
                {failed.map((t) => (
                  <AttentionRow
                    key={`fail-${t.id}`}
                    icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
                    label={`Failed: ${t.channel}`}
                    detail={formatDate(t.created_at)}
                    onClick={() => navigate(`/traces/${t.id}`)}
                  />
                ))}
                {idleChannels.map((ch) => (
                  <AttentionRow
                    key={`idle-${ch}`}
                    icon={<CircleOff className="h-4 w-4 text-muted-foreground" />}
                    label={`No traffic: ${ch}`}
                    detail="No messages processed"
                    onClick={() => navigate("/channels")}
                  />
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {/* Outcome distribution */}
        <Card>
          <CardHeader className="flex h-[3.25rem] flex-row items-center justify-between pb-2">
            <CardTitle>Outcomes by channel</CardTitle>
          </CardHeader>
          <CardContent>
            {outcomeData.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No message activity yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(140, outcomeData.length * 44)}>
                <BarChart data={outcomeData} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
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

      <div className="grid items-start gap-4 lg:grid-cols-2">
      {/* Top channels */}
      <Card>
        <CardHeader className="flex h-[3.25rem] flex-row items-center justify-between pb-2">
          <CardTitle>Top channels</CardTitle>
        </CardHeader>
        <CardContent>
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
                {metrics.channels.slice(0, 8).map((c) => (
                  <TableRow key={c.channel}>
                    <TableCell className="font-medium">{c.channel}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.ratePerMin == null ? "—" : Math.round(c.ratePerMin)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={c.errorPct > 0 ? "text-destructive" : "text-muted-foreground"}>
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
        </CardContent>
      </Card>

      {/* Recent traces */}
      <Card>
        <CardHeader className="flex h-[3.25rem] flex-row items-center justify-between pb-2">
          <CardTitle>Recent traces</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => navigate("/traces")}>
            View all
          </Button>
        </CardHeader>
        <CardContent>
          {recentTraces?.data && recentTraces.data.length > 0 ? (
            <div className="space-y-2">
              {recentTraces.data.map((trace) => (
                <div
                  key={trace.id}
                  className="flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 transition-colors hover:border-border-strong hover:bg-muted/50"
                  onClick={() => navigate(`/traces/${trace.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={traceStatusBadgeClass(trace.status)}>
                      {trace.status}
                    </Badge>
                    <span className="text-sm font-medium">{trace.channel}</span>
                    <Badge variant="outline" className="text-xs">{trace.mode}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDate(trace.created_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No recent traces</p>
          )}
        </CardContent>
      </Card>
      </div>
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
  onClick,
}: {
  icon: ReactNode
  label: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors outline-none hover:border-border-strong hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60"
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
