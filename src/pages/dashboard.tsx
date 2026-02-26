import { useEngineStatus, useEngineReload } from "@/hooks/use-engine"
import { useHealth } from "@/hooks/use-health"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Activity, GitBranch, Server, Clock, RefreshCw } from "lucide-react"

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function DashboardPage() {
  const { data: engine, isLoading: engineLoading } = useEngineStatus()
  const { data: health } = useHealth()
  const reload = useEngineReload()

  const isHealthy = health?.status === "ok"

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Button
          onClick={() => reload.mutate()}
          disabled={reload.isPending}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${reload.isPending ? "animate-spin" : ""}`} />
          {reload.isPending ? "Reloading..." : "Reload Engine"}
        </Button>
      </div>

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
        {/* Health */}
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

        {/* Version */}
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

        {/* Uptime */}
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
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </CardContent>
        </Card>

        {/* Rules Count */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Rules Count</CardTitle>
            <GitBranch className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {engineLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : engine ? (
              <p className="text-2xl font-bold">{engine.rules_count}</p>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Rule counts + channels */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-emerald-600">{engine?.active_rules ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Paused Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-amber-600">{engine?.paused_rules ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Channels</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1">
              {engine?.channels.map((ch) => (
                <Badge key={ch} variant="outline">{ch}</Badge>
              )) ?? <span className="text-muted-foreground">—</span>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Engine Details + Health Checks */}
      <div className="grid gap-4 md:grid-cols-2">
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
                  <span className="text-muted-foreground">Total Rules</span>
                  <span className="font-bold">{engine.rules_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Active Rules</span>
                  <span className="font-bold text-emerald-600">{engine.active_rules}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paused Rules</span>
                  <span className="font-bold text-amber-600">{engine.paused_rules}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Channels</span>
                  <div className="flex flex-wrap gap-1">
                    {engine.channels.map((ch) => (
                      <Badge key={ch} variant="outline" className="text-xs">{ch}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">Engine status unavailable</p>
            )}
          </CardContent>
        </Card>

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
                  <span>Rules loaded: {health.rules_loaded}</span>
                </div>
              </div>
            ) : (
              <Skeleton className="h-24 w-full" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
