import { useState } from "react"
import { useDocsServed, useEngineStatus, useEngineReload } from "@/hooks/use-engine"
import { useCircuitBreakers } from "@/hooks/use-connectors"
import { useBackups, useCreateBackup } from "@/hooks/use-backup"
import { useHealth } from "@/hooks/use-health"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/shared/page-header"
import { HealthComponents } from "@/components/shared/health-components"
import { LoadIssuesReport } from "@/components/shared/load-issues"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { componentStateBadgeClass, traceStatusBadgeClass } from "@/lib/status"
import { useUrlFilters } from "@/lib/use-url-filters"
import { formatBytes, formatDate, formatUptime, formatWhen } from "@/lib/utils"
import { countLoadIssues } from "@/api/types"
import type { EngineCapabilities } from "@/api/types"
import { RefreshCw, Archive, BookOpen, HeartPulse, Server } from "lucide-react"

const TAB_KEYS = ["tab"] as const
const TABS = ["health", "cluster", "maintenance"] as const
type EngineTab = (typeof TABS)[number]

/**
 * The instance, in three sections: **Health** (the `/health` report, row by
 * row), **Cluster & runtime** (the running generation from `engine/status` —
 * what it is, what this node can run, what it refused) and **Maintenance**
 * (one reload, backups, the API reference — each shown only where this
 * instance offers it). Named "Settings" until 2026-09-05; the display
 * preferences that lived here moved to the header's Display menu.
 *
 * The tab is in the URL (`?tab=`), and `#component-<name>` — where the
 * dashboard sends a degraded component with no page of its own — always opens
 * Health, so those links keep landing on the row.
 */
export function EnginePage() {
  const { values, set } = useUrlFilters(TAB_KEYS)
  // Health unless the URL names another tab — so `#component-<name>` links,
  // which carry no `?tab=`, land on the report.
  const tab: EngineTab = (TABS as readonly string[]).includes(values.tab)
    ? (values.tab as EngineTab)
    : "health"

  const { data: engine } = useEngineStatus()
  const { data: health } = useHealth()
  // `load_issues` absent means "this server cannot tell you" (pre-1.9), which
  // is not the same as "nothing quarantined" — so it counts as zero and says
  // nothing, rather than claiming a clean generation.
  const quarantined = countLoadIssues(engine?.load_issues)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Engine"
        description="This instance: its health, the generation it serves, and maintenance"
      />

      <Tabs
        defaultValue="health"
        value={tab}
        onValueChange={(v) => set({ tab: v === "health" ? "" : v })}
      >
        <TabsList>
          <TabsTrigger value="health">
            Health
            {health && health.status !== "ok" && (
              <>
                <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
                <span className="sr-only"> (degraded)</span>
              </>
            )}
          </TabsTrigger>
          <TabsTrigger value="cluster">
            Cluster &amp; runtime
            {quarantined > 0 && (
              <span
                className="ml-1.5 rounded-full bg-warning/15 px-1.5 text-xs tabular-nums text-warning"
                aria-label={`${quarantined} quarantined`}
              >
                {quarantined}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="space-y-4">
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
                Per-subsystem state from <code className="font-mono">/health</code>. A monitor should
                read the <code className="font-mono">status</code> field, not only the HTTP code: a
                failed connector load, a quarantined channel or a stalled scheduler report degraded
                at 200.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {quarantined > 0 && (
                <Callout variant="warning">
                  The running generation quarantined {quarantined}{" "}
                  {quarantined === 1 ? "entity" : "entities"}.{" "}
                  <button
                    type="button"
                    className="font-medium underline underline-offset-2"
                    onClick={() => set({ tab: "cluster" })}
                  >
                    See what it refused
                  </button>
                </Callout>
              )}
              {/* `/engine/status` is the authority for what the running
                  generation could not load — rendered on the Cluster tab. */}
              <HealthComponents
                health={health}
                loadIssues={engine?.load_issues}
                showLoadIssues={!engine?.load_issues}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cluster" className="space-y-4">
          <ClusterRuntime />
        </TabsContent>

        <TabsContent value="maintenance" className="space-y-4">
          <Maintenance quarantined={quarantined} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Fact({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div title={title}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm tabular-nums">{value}</dd>
    </div>
  )
}

/**
 * The running generation as `GET admin/engine/status` reports it. Every fact
 * here describes **the node that answered** — a peer reloading on the same
 * epoch bump may differ, which is why the node id leads.
 */
function ClusterRuntime() {
  const { data: engine, isLoading } = useEngineStatus()
  const { data: health } = useHealth()
  const { data: breakers } = useCircuitBreakers()
  const nodeId = breakers?.instance_id

  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4" /> Running generation
          </CardTitle>
          <CardDescription>
            What the node that answered is serving. In a cluster each node reloads on the config
            epoch on its own, so a peer can be a generation behind or refuse differently.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
            <Fact label="Version" value={engine?.version ?? "—"} />
            <Fact
              label="Build"
              value={health?.git_hash ? <span className="font-mono text-xs">{health.git_hash}</span> : "—"}
            />
            <Fact
              label="Generation"
              value={engine?.generation ? engine.generation : "—"}
              title="Bumped by every reload this node completes. 0 or absent: a server before 1.9."
            />
            <Fact label="Uptime" value={engine ? formatUptime(engine.uptime_seconds) : "—"} />
            <Fact
              label="Workflows"
              value={engine ? `${engine.active_workflows} active of ${engine.workflows_count}` : "—"}
            />
            <Fact
              label="Node"
              value={nodeId ? <span className="font-mono text-xs">{nodeId.slice(0, 8)}</span> : "—"}
              title={nodeId ? `Instance ${nodeId}` : undefined}
            />
          </dl>
          {engine?.capabilities && <Capabilities capabilities={engine.capabilities} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What this generation refused</CardTitle>
          <CardDescription>
            A reload never fails over one entity: it is quarantined and everything else serves.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!engine?.load_issues ? (
            <p className="text-sm text-muted-foreground">
              This server does not report load issues (before 1.9) — which is not the same as
              nothing being quarantined. The Health tab carries what <code className="font-mono">/health</code>{" "}
              says.
            </p>
          ) : countLoadIssues(engine.load_issues) === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing quarantined — every active channel, connector, plugin and model loaded.
            </p>
          ) : (
            <LoadIssuesReport issues={engine.load_issues} />
          )}
        </CardContent>
      </Card>
    </>
  )
}

/**
 * One reload, backups and the API reference. Backups and the docs are shown
 * only where this instance offers them, with one line saying why when not:
 * backups are SQLite-only (a 400 elsewhere, cluster mode included), and a
 * server running with `environment = "production"` withholds the spec.
 */
function Maintenance({ quarantined }: { quarantined: number }) {
  const reload = useEngineReload()
  const [confirmReload, setConfirmReload] = useState(false)
  const docsServed = useDocsServed().data
  const { data: backups, isLoading: backupsLoading, error: backupsError } = useBackups()
  const createBackup = useCreateBackup()

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Reload
          </CardTitle>
          <CardDescription>
            Rebuild the running generation from the database and bump the cluster config epoch
            once — what picks up channel, workflow and connector changes, and what finishes a
            batch of deferred status changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setConfirmReload(true)} disabled={reload.isPending}>
            <RefreshCw className={`h-4 w-4 ${reload.isPending ? "animate-spin" : ""}`} />
            {reload.isPending ? "Reloading..." : "Reload engine"}
          </Button>
          {quarantined > 0 && (
            <span className="text-sm text-warning">
              The current generation quarantined {quarantined}{" "}
              {quarantined === 1 ? "entity" : "entities"}; a reload retries {quarantined === 1 ? "it" : "them"}.
            </span>
          )}
          {confirmReload && (
            <ConfirmDialog
              title="Reload the engine?"
              description="The engine is rebuilt from the database and the cluster config epoch is bumped, so every node reloads its generation. Any status change made with reload=defer takes effect now. Requests in flight finish on the generation they started on; a channel whose definition no longer loads is quarantined rather than served."
              confirmLabel="Reload"
              onConfirm={() => {
                setConfirmReload(false)
                reload.mutate()
              }}
              onCancel={() => setConfirmReload(false)}
            />
          )}
        </CardContent>
      </Card>

      {backupsError ? (
        <p className="text-sm text-muted-foreground md:col-span-2">
          <Archive className="mr-1.5 inline h-3.5 w-3.5" />
          Backups are not offered here — they snapshot a SQLite database, and this instance
          answered: {backupsError instanceof Error ? backupsError.message : "unavailable"}.
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Archive className="h-4 w-4" /> Backups
            </CardTitle>
            <CardDescription>
              Snapshot the database into the server's backup directory. There is no restore
              endpoint: restoring is a file copy on the host.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              onClick={() => createBackup.mutate()}
              disabled={createBackup.isPending}
            >
              <Archive className="h-4 w-4" />
              {createBackup.isPending ? "Creating..." : "Create backup"}
            </Button>
            {backupsLoading ? (
              <Skeleton className="h-16 w-full" />
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
                    <span
                      className="ml-3 shrink-0 text-xs text-muted-foreground"
                      title={b.modified_at ? formatDate(b.modified_at) : undefined}
                    >
                      {formatBytes(b.size_bytes)}
                      {b.modified_at ? ` · ${formatWhen(b.modified_at)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {docsServed === false ? (
        <p className="text-sm text-muted-foreground md:col-span-2">
          <BookOpen className="mr-1.5 inline h-3.5 w-3.5" />
          The API reference is not served here: a server running with{" "}
          <code className="font-mono">environment = "production"</code> withholds the spec and the
          Swagger UI. The spec this console targets is vendored in the UI repository.
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" /> API reference
            </CardTitle>
            <CardDescription>The Swagger UI and OpenAPI spec this instance serves.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button variant="outline" onClick={() => window.open("/docs", "_blank")}>
              Swagger UI
            </Button>
            <Button variant="outline" onClick={() => window.open("/api/v1/openapi.json", "_blank")}>
              OpenAPI spec
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/**
 * What this node is configured to run (Orion 1.9).
 *
 * The three runtimes that are off by default. A cron channel on a node with
 * `cron.enabled = false` is not a broken channel — it is a schedule that would
 * never fire, and the node quarantines it saying so. Reading the capability
 * here is how that answer is available before a reload discovers it, and why
 * `off` reads as neutral rather than as a fault.
 */
function Capabilities({ capabilities }: { capabilities: EngineCapabilities }) {
  const rows: { key: keyof EngineCapabilities; label: string; setting: string }[] = [
    { key: "cron", label: "Cron", setting: "cron.enabled" },
    { key: "plugins", label: "Plugins", setting: "plugins.enabled" },
    { key: "models", label: "Models", setting: "models.enabled" },
  ]
  // The wire is a boolean; tolerate "on" / "off" spellings as well.
  const on = (v: unknown) => v === true || v === "on"
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">This node runs</span>
      {rows.map(({ key, label, setting }) => (
        <Badge
          key={key}
          variant="outline"
          className={componentStateBadgeClass(on(capabilities[key]) ? "ok" : "disabled")}
          title={`${setting} = ${on(capabilities[key])} — a node without it quarantines what needs it rather than refusing to start`}
        >
          {label} {on(capabilities[key]) ? "on" : "off"}
        </Badge>
      ))}
    </div>
  )
}
