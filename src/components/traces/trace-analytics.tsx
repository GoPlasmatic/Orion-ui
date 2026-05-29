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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Aggregated over the last {a.total} traces
          {a.taskAvailable
            ? ` · per-task detail in ${a.coverage}/${a.total}`
            : " · no per-task detail in this window"}
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
          {/* Errors by task */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Errors by task</CardTitle>
            </CardHeader>
            <CardContent>
              {a.errorsByTask.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">
                  {a.taskAvailable ? "No task errors in this window." : "Per-task detail unavailable (enable task tracing on the channel)."}
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(120, a.errorsByTask.length * 40)}>
                  <BarChart data={a.errorsByTask} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="task" width={120} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                    <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} contentStyle={tooltipStyle} />
                    <Bar dataKey="error" fill={statusChartColor("error")} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Task execution mix */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Task execution mix</CardTitle>
            </CardHeader>
            <CardContent>
              {a.tasks.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">No per-task detail in this window.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(120, a.tasks.length * 40)}>
                  <BarChart data={a.tasks} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="task" width={120} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                    <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} contentStyle={tooltipStyle} />
                    <Bar dataKey="executed" stackId="s" fill={statusChartColor("completed")} />
                    <Bar dataKey="skipped" stackId="s" fill={statusChartColor("pending")} />
                    <Bar dataKey="error" stackId="s" fill={statusChartColor("error")} radius={[0, 4, 4, 0]} />
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
        Per-task durations and cache-hit rate are not available from the current trace data.
      </p>
    </div>
  )
}
