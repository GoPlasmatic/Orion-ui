import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useEngineStatus, useEngineReload } from "@/hooks/use-engine"
import { useReloadConnectors } from "@/hooks/use-connectors"
import { useBackups, useCreateBackup } from "@/hooks/use-backup"
import { useHealth } from "@/hooks/use-health"
import { useTheme } from "@/lib/use-theme"
import { useDensity } from "@/lib/use-density"
import { useTimeZone } from "@/lib/use-time-zone"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { HealthComponents } from "@/components/shared/health-components"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { traceStatusBadgeClass } from "@/lib/status"
import { formatDate } from "@/lib/utils"
import { RefreshCw, Archive, Database, HeartPulse, Monitor, Plug } from "lucide-react"

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

/**
 * The instance: its health report, the engine and connector reloads, backups
 * and the API reference. Named "Settings" until 2026-09-05, which sent
 * operators looking for health to a page whose name promised preferences;
 * theme and density live in the header.
 */
export function EnginePage() {
  const { data: engine } = useEngineStatus()
  const reload = useEngineReload()
  const reloadConnectors = useReloadConnectors()
  const [confirmReload, setConfirmReload] = useState(false)
  // The spec and Swagger UI are served only when the server does not run with
  // `environment = "production"`; a button that opens a 404 in a new tab says
  // nothing. One HEAD, kept for the session.
  const docs = useQuery({
    queryKey: ["openapi-served"],
    queryFn: async () => {
      const res = await fetch("/api/v1/openapi.json", { method: "HEAD" })
      return res.ok || res.status === 405
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
  const docsServed = docs.data
  const { data: backups, isLoading: backupsLoading, error: backupsError } = useBackups()
  const createBackup = useCreateBackup()
  const { data: health } = useHealth()
  const { theme, setTheme } = useTheme()
  const { compact, setCompact } = useDensity()
  const { zone, setZone, label: zoneLabel, localName } = useTimeZone()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Engine"
        description="Health, reloads, backups and the API reference for this instance"
      />

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

      {/* Display preferences. The header toggles theme and density too; this
          is where all three are named, and the only place "system" theme and
          the display zone can be chosen. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-4 w-4" /> Display
          </CardTitle>
          <CardDescription>
            How this browser shows the console. Kept in this browser only.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="display-theme">Theme</Label>
            <Select
              id="display-theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value as "light" | "dark" | "system")}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">Follow the system</option>
            </Select>
          </div>
          <div>
            <Label
              htmlFor="display-zone"
              hint={`Your zone is ${localName} (${zone === "utc" ? "hidden while UTC is chosen" : zoneLabel}). Server logs are UTC.`}
            >
              Times shown in
            </Label>
            <Select
              id="display-zone"
              value={zone}
              onChange={(e) => setZone(e.target.value as "local" | "utc")}
            >
              <option value="local">Local time</option>
              <option value="utc">UTC</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="display-density" hint="Tighter rows in every table.">
              Compact tables
            </Label>
            <div className="pt-1.5">
              <Switch id="display-density" checked={compact} onCheckedChange={setCompact} aria-label="Compact tables" />
            </div>
          </div>
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
              Reload the engine to pick up configuration changes to channels and workflows. It
              rebuilds the running generation and bumps the cluster config epoch once, which is
              also what finishes a batch of deferred status changes.
            </p>
            <Button
              onClick={() => setConfirmReload(true)}
              disabled={reload.isPending}
            >
              <RefreshCw className={`h-4 w-4 ${reload.isPending ? "animate-spin" : ""}`} />
              {reload.isPending ? "Reloading..." : "Reload Engine"}
            </Button>
            {confirmReload && (
              <ConfirmDialog
                title="Reload the engine?"
                description="The engine is rebuilt from the database and the cluster config epoch is bumped, so every node reloads its generation. Any status change made with reload=defer takes effect now. Requests in flight finish on the generation they started on; a channel whose definition no longer loads is quarantined rather than served."
                onConfirm={() => {
                  setConfirmReload(false)
                  reload.mutate()
                }}
                onCancel={() => setConfirmReload(false)}
              />
            )}
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
            {docsServed === false && (
              <p className="text-xs text-warning">
                Not served by this instance: a server running with{" "}
                <code className="font-mono">environment = "production"</code> withholds the spec and
                the Swagger UI. The spec this console targets is vendored in the UI repository.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => window.open("/docs", "_blank")}
                disabled={docsServed === false}
              >
                Swagger UI
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open("/api/v1/openapi.json", "_blank")}
                disabled={docsServed === false}
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
