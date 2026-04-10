import { useNavigate } from "react-router"
import { useEngineStatus, useEngineReload } from "@/hooks/use-engine"
import { useHealth } from "@/hooks/use-health"
import { useTraces } from "@/hooks/use-traces"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { Activity, GitBranch, Server, Clock, RefreshCw, Radio } from "lucide-react"
import { formatDate } from "@/lib/utils"

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const traceStatusColor: Record<string, string> = {
  completed: "bg-emerald-500",
  failed: "",
  pending: "",
  running: "",
}

const traceStatusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  running: "outline",
  pending: "secondary",
  failed: "destructive",
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { data: engine, isLoading: engineLoading } = useEngineStatus()
  const { data: health } = useHealth()
  const { data: recentTraces } = useTraces({
    limit: 5,
    sort_by: "created_at",
    sort_order: "desc",
  })
  const reload = useEngineReload()

  const isHealthy = health?.status === "ok"

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard">
        <Button
          onClick={() => reload.mutate()}
          disabled={reload.isPending}
        >
          <RefreshCw className={`h-4 w-4 ${reload.isPending ? "animate-spin" : ""}`} />
          {reload.isPending ? "Reloading..." : "Reload Engine"}
        </Button>
      </PageHeader>

      {reload.isSuccess && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Engine reloaded successfully.
        </div>
      )}

      {reload.isError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to reload engine: {reload.error?.message}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Health</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {health ? (
              <Badge
                variant={isHealthy ? "default" : "destructive"}
                className={isHealthy ? "bg-emerald-500" : ""}
              >
                {health.status}
              </Badge>
            ) : (
              <Skeleton className="h-7 w-24" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Engine Version</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {engineLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : engine ? (
              <p className="text-2xl font-bold">v{engine.version}</p>
            ) : (
              <span className="text-sm text-muted-foreground">Unavailable</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Uptime</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {engineLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : engine ? (
              <p className="text-2xl font-bold">{formatUptime(engine.uptime_seconds)}</p>
            ) : (
              <span className="text-sm text-muted-foreground">--</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Workflows</CardTitle>
            <GitBranch className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {engineLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : engine ? (
              <p className="text-2xl font-bold">{engine.workflows_count}</p>
            ) : (
              <span className="text-sm text-muted-foreground">--</span>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Workflows</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-emerald-600">{engine?.active_workflows ?? "--"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Radio className="h-4 w-4" /> Channels
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1">
              {engine?.channels.map((ch) => (
                <Badge key={ch} variant="outline">{ch}</Badge>
              )) ?? <span className="text-muted-foreground">--</span>}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Engine Details */}
        <Card>
          <CardHeader>
            <CardTitle>Engine Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {engineLoading ? (
              <>
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-4 w-48" />
              </>
            ) : engine ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version</span>
                  <span className="font-mono">{engine.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Uptime</span>
                  <span>{formatUptime(engine.uptime_seconds)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Workflows</span>
                  <span className="font-bold">{engine.workflows_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Active</span>
                  <span className="font-bold text-emerald-600">{engine.active_workflows}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Channels</span>
                  <span className="font-bold">{engine.channels.length}</span>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">Engine status unavailable</p>
            )}
          </CardContent>
        </Card>

        {/* Health Checks */}
        <Card>
          <CardHeader>
            <CardTitle>Health Checks</CardTitle>
          </CardHeader>
          <CardContent>
            {health ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-sm font-medium">Overall:</span>
                  <Badge
                    variant={isHealthy ? "default" : "destructive"}
                    className={isHealthy ? "bg-emerald-500" : ""}
                  >
                    {health.status}
                  </Badge>
                </div>
                {Object.entries(health.components).map(([name, status]) => (
                  <div key={name} className="flex items-center justify-between border-b py-2 last:border-0">
                    <span className="text-sm font-mono">{name}</span>
                    <Badge
                      variant="outline"
                      className={
                        status === "ok" || status === "up" || status === "healthy"
                          ? "border-emerald-200 text-emerald-700"
                          : "border-red-200 text-red-700"
                      }
                    >
                      {status}
                    </Badge>
                  </div>
                ))}
                <div className="mt-3 pt-2 border-t text-sm text-muted-foreground">
                  <span>Workflows loaded: {health.workflows_loaded}</span>
                </div>
              </div>
            ) : (
              <Skeleton className="h-24 w-full" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Traces */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Traces</CardTitle>
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
                  className="flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/traces/${trace.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={traceStatusVariant[trace.status] ?? "outline"}
                      className={traceStatusColor[trace.status] ?? ""}
                    >
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
  )
}
