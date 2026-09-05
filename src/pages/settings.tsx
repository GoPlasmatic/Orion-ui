import { useEngineStatus, useEngineReload } from "@/hooks/use-engine"
import { useReloadConnectors } from "@/hooks/use-connectors"
import { useBackups, useCreateBackup } from "@/hooks/use-backup"
import { useHealth } from "@/hooks/use-health"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { HealthComponents } from "@/components/shared/health-components"
import { traceStatusBadgeClass } from "@/lib/status"
import { formatDate } from "@/lib/utils"
import { RefreshCw, Archive, Database, HeartPulse, Plug } from "lucide-react"

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function SettingsPage() {
  const { data: engine } = useEngineStatus()
  const reload = useEngineReload()
  const reloadConnectors = useReloadConnectors()
  const { data: backups, isLoading: backupsLoading, error: backupsError } = useBackups()
  const createBackup = useCreateBackup()
  const { data: health } = useHealth()

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="System operations and management" />

      {/* The full /health report. The dashboard shows only the faults; this is
          where a coarse `degraded` becomes a sentence and the admin-only
          detail — background tasks, plugin loads, the scheduler — is readable. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4" /> Health
            {health && (
              <Badge
                variant="outline"
                className={traceStatusBadgeClass(health.status === "ok" ? "completed" : "failed")}
              >
                {health.status}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Per-subsystem state from <code className="font-mono">/health</code>
            {health?.git_hash ? ` · build ${health.git_hash}` : ""}. A monitor should read the{" "}
            <code className="font-mono">status</code> field, not only the HTTP code: a failed
            connector load, a quarantined channel or a stalled scheduler report degraded at 200.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HealthComponents health={health} />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Engine */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" /> Engine
            </CardTitle>
            <CardDescription>
              {engine
                ? `Version ${engine.version} | Uptime: ${formatUptime(engine.uptime_seconds)}`
                : "Loading..."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Reload the engine to pick up configuration changes to channels and workflows.
            </p>
            <Button
              onClick={() => reload.mutate()}
              disabled={reload.isPending}
            >
              <RefreshCw className={`h-4 w-4 ${reload.isPending ? "animate-spin" : ""}`} />
              {reload.isPending ? "Reloading..." : "Reload Engine"}
            </Button>
          </CardContent>
        </Card>

        {/* Connectors */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-4 w-4" /> Connectors
            </CardTitle>
            <CardDescription>
              Refresh connector bindings via an engine reload.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Reloads the engine so channels pick up the latest connector configuration.
              Connector edits already reload the registry automatically.
            </p>
            <Button
              variant="outline"
              onClick={() => reloadConnectors.mutate()}
              disabled={reloadConnectors.isPending}
            >
              <RefreshCw className={`h-4 w-4 ${reloadConnectors.isPending ? "animate-spin" : ""}`} />
              {reloadConnectors.isPending ? "Reloading..." : "Reload Connectors"}
            </Button>
          </CardContent>
        </Card>

        {/* Backups */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Archive className="h-4 w-4" /> Backups
            </CardTitle>
            <CardDescription>
              Snapshot the database into the server's backup directory (SQLite only).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              onClick={() => createBackup.mutate()}
              disabled={createBackup.isPending}
            >
              <Archive className="h-4 w-4" />
              {createBackup.isPending ? "Creating..." : "Create Backup"}
            </Button>

            {backupsLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : backupsError ? (
              <p className="text-sm text-muted-foreground">
                Backups unavailable: {backupsError instanceof Error ? backupsError.message : "error"}
              </p>
            ) : (backups?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No backups yet.</p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {backups!.map((b) => (
                  <div
                    key={b.filename}
                    className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
                  >
                    <span className="truncate font-mono text-xs">{b.filename}</span>
                    <span className="ml-3 shrink-0 text-xs text-muted-foreground">
                      {formatBytes(b.size_bytes)}
                      {b.modified_at ? ` · ${formatDate(b.modified_at)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* API Docs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4" /> API Documentation
            </CardTitle>
            <CardDescription>
              Interactive API reference.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Access the Swagger UI and OpenAPI specification for the Orion API.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => window.open("/docs", "_blank")}
              >
                Swagger UI
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open("/api/v1/openapi.json", "_blank")}
              >
                OpenAPI Spec
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
