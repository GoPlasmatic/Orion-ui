import { useState } from "react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import { useTraceAnalytics } from "@/hooks/use-trace-analytics"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { formatDate, formatDuration } from "@/lib/utils"
import { statusChartColor } from "@/lib/status"

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
}

function bucketLabel(ms: number): string {
  if (ms < 60 * 60_000) return `${ms / 60_000} min`
  if (ms < 24 * 60 * 60_000) return `${ms / 3_600_000} h`
  return "1 day"
}

export function TraceAnalytics() {
  const [window, setWindow] = useState(200)
  const a = useTraceAnalytics(window)

  // Only channels that actually failed belong on the error chart — a row of
  // zeroes reads as a rendering bug rather than as good news.
  const failingChannels = a.channels.filter((c) => c.errorPct > 0)
  const busiestChannels = a.channels.slice(0, 8)
  const span =
    a.timeline.length > 0
      ? `${formatDate(a.timeline[0].t)} – ${formatDate(a.timeline[a.timeline.length - 1].t + a.bucketMs)}`
      : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Aggregated over the last {a.total} traces
          {a.failed > 0 ? ` · ${a.failed} failed` : ""}
        </p>
        <Select
          value={String(window)}
          onChange={(e) => setWindow(Number(e.target.value))}
          className="w-36"
        >
          <option value="100">Last 100</option>
          <option value="200">Last 200</option>
          <option value="500">Last 500</option>
        </Select>
      </div>

      {/* Over time: the rows carry created_at, so failures get a time axis
          without a new endpoint. Bars are the traces that started in each
          bucket, failed on top. */}
      {!a.isLoading && a.timeline.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
              <span>Over time</span>
              <span className="text-xs font-normal text-muted-foreground" title={span ?? undefined}>
                {bucketLabel(a.bucketMs)} buckets · {span}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={a.timeline} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={40}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  allowDecimals={false}
                  width={32}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  contentStyle={tooltipStyle}
                  labelFormatter={(_, payload) => {
                    const t = (payload?.[0]?.payload as { t?: number } | undefined)?.t
                    return t != null ? `${formatDate(t)} · ${bucketLabel(a.bucketMs)}` : ""
                  }}
                />
                <Bar dataKey="ok" stackId="t" fill={statusChartColor("completed")} name="ok" />
                <Bar
                  dataKey="failed"
                  stackId="t"
                  fill={statusChartColor("failed")}
                  name="failed"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {a.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Volume by channel */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Busiest channels</CardTitle>
            </CardHeader>
            <CardContent>
              {busiestChannels.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">No traces in this window.</p>
              ) : (
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(120, busiestChannels.length * 40)}
                >
                  <BarChart
                    data={busiestChannels}
                    layout="vertical"
                    margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
                  >
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="channel"
                      width={120}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                      contentStyle={tooltipStyle}
                    />
                    <Bar
                      dataKey="volume"
                      fill={statusChartColor("completed")}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Failures by channel */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Failures by channel</CardTitle>
            </CardHeader>
            <CardContent>
              {failingChannels.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">
                  No failed traces in this window.
                </p>
              ) : (
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(120, failingChannels.length * 40)}
                >
                  <BarChart
                    data={failingChannels}
                    layout="vertical"
                    margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
                  >
                    <XAxis type="number" hide unit="%" />
                    <YAxis
                      type="category"
                      dataKey="channel"
                      width={120}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                      contentStyle={tooltipStyle}
                      formatter={(v) => [`${Number(v).toFixed(1)}%`, "Error rate"]}
                    />
                    <Bar
                      dataKey="errorPct"
                      fill={statusChartColor("error")}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Per-channel */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>By channel</CardTitle>
        </CardHeader>
        <CardContent>
          {a.channels.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No traces in this window.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Error %</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                  <TableHead className="text-right">p95</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.channels.map((c) => (
                  <TableRow key={c.channel}>
                    <TableCell className="font-medium">{c.channel}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.volume}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={c.errorPct > 0 ? "text-destructive" : "text-muted-foreground"}>
                        {c.errorPct.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatDuration(c.avgMs)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatDuration(c.p95Ms)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        The trace list carries no per-task detail — open a single trace for its execution pipeline.
      </p>
    </div>
  )
}
