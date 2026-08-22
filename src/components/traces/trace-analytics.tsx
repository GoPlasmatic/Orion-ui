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
import { formatDuration } from "@/lib/utils"
import { statusChartColor } from "@/lib/status"

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
}

export function TraceAnalytics() {
  const [window, setWindow] = useState(200)
  const a = useTraceAnalytics(window)

  // Only channels that actually failed belong on the error chart — a row of
  // zeroes reads as a rendering bug rather than as good news.
  const failingChannels = a.channels.filter((c) => c.errorPct > 0)
  const busiestChannels = a.channels.slice(0, 8)

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
