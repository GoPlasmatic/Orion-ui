import { useEngineStatus, useEngineReload } from "@/hooks/use-engine"
import { useReloadConnectors } from "@/hooks/use-connectors"
import { useBackup } from "@/hooks/use-backup"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shared/page-header"
import { RefreshCw, Download, Database, Plug } from "lucide-react"

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function SettingsPage() {
  const { data: engine } = useEngineStatus()
  const reload = useEngineReload()
  const reloadConnectors = useReloadConnectors()
  const backup = useBackup()

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="System operations and management" />

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

        {/* Backup */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4" /> Backup
            </CardTitle>
            <CardDescription>
              Export a database backup.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Download a snapshot of all channels, workflows, and connectors.
            </p>
            <Button
              variant="outline"
              onClick={() => backup.mutate()}
              disabled={backup.isPending}
            >
              <Download className="h-4 w-4" />
              {backup.isPending ? "Creating..." : "Create Backup"}
            </Button>
            {backup.isSuccess && (
              <p className="text-sm text-chart-2">Backup created successfully.</p>
            )}
            {backup.isError && (
              <p className="text-sm text-destructive">
                Failed: {backup.error?.message}
              </p>
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
