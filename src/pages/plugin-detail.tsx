import { Link, useNavigate, useParams } from "react-router"
import {
  usePlugin,
  usePluginVersions,
  usePluginDependencies,
  useChangePluginStatus,
  usePluginStatusDryRun,
  useCreatePluginVersion,
  useDeletePlugin,
} from "@/hooks/use-plugins"
import { usePluginMetrics } from "@/hooks/use-metrics"
import type { PluginManifestFunction } from "@/api/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { StatusBadge } from "@/components/shared/status-badge"
import { LifecycleActions } from "@/components/shared/lifecycle-actions"
import { VersionHistory } from "@/components/shared/version-history"
import { JsonViewer } from "@/components/shared/json-viewer"
import { pluginHealthBadgeClass } from "@/lib/status"
import { formatDate, formatDuration } from "@/lib/utils"
import { ArrowLeft, AlertCircle, GitBranch, Pencil, ShieldCheck } from "lucide-react"

function shortDigest(digest: string): string {
  const hex = digest.startsWith("sha256:") ? digest.slice(7) : digest
  return hex.length > 16 ? `${digest.slice(0, 7 + 12)}…` : digest
}

/** One manifest function's field table, in the manifest's own vocabulary. */
function ManifestFunction({ fn }: { fn: PluginManifestFunction }) {
  const fields = fn.input_fields ?? []
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`/functions?q=${encodeURIComponent(fn.name)}`}
          className="font-mono text-sm font-medium hover:underline"
        >
          {fn.name}
        </Link>
        {fn.category && (
          <Badge variant="secondary" className="text-xs">
            {fn.category}
          </Badge>
        )}
        {fn.output_default_root && (
          <Badge variant="outline" className="text-xs" title="Where the result lands when a task names no `output`">
            → {fn.output_default_root}
          </Badge>
        )}
      </div>
      {fn.description && <p className="mt-1 text-xs text-muted-foreground">{fn.description}</p>}
      {fields.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {fields.map((field) => (
            <li key={field.name} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono">{field.name}</span>
              {field.kind && (
                <Badge variant="outline" className="text-[10px]">
                  {field.kind}
                </Badge>
              )}
              {field.required && (
                <Badge variant="warning" className="text-[10px]">
                  required
                </Badge>
              )}
              {field.template_at && (
                <Badge variant="outline" className="text-[10px]" title="The value is JSONLogic, evaluated per message">
                  expression
                </Badge>
              )}
              {field.resolvable && (
                <Badge variant="outline" className="text-[10px]" title={`{"var": …} nodes are folded against the message`}>
                  resolvable
                </Badge>
              )}
              {field.description && <span className="text-muted-foreground">{field.description}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Declares no input fields; a task may still name an <code className="font-mono">output</code>.
        </p>
      )}
    </div>
  )
}

export function PluginDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const pluginId = id ?? ""
  const { data: plugin, isLoading, error } = usePlugin(pluginId)
  const { data: versions, isLoading: versionsLoading } = usePluginVersions(pluginId)
  const { data: dependencies } = usePluginDependencies(pluginId)
  const statusDryRun = usePluginStatusDryRun()
  const changeStatus = useChangePluginStatus()
  const createVersion = useCreatePluginVersion()
  const deletePlugin = useDeletePlugin()
  const metrics = usePluginMetrics(pluginId)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (error || !plugin) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link to="/plugins"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Plugins</Link>
        </Button>
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>{error instanceof Error ? error.message : "Failed to load plugin."}</p>
        </div>
      </div>
    )
  }

  const isPending = changeStatus.isPending || createVersion.isPending || deletePlugin.isPending
  const health = plugin.health ?? null
  const manifestFunctions = plugin.manifest?.functions ?? []
  const dependants = dependencies?.workflows ?? []

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild>
        <Link to="/plugins"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Plugins</Link>
      </Button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold">{plugin.plugin_id}</h1>
            <StatusBadge status={plugin.status} />
            <Badge variant="outline">v{plugin.version}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs" title="The author's own version string, informational">
              {plugin.plugin_version}
            </Badge>
            <Badge variant="outline" className="font-mono text-xs" title="The WIT package version the component was built against">
              {plugin.abi}
            </Badge>
            {health && (
              <Badge
                variant="outline"
                className={pluginHealthBadgeClass(health.state)}
                title={health.reason ?? (health.compile_ms != null ? `Compiled in ${health.compile_ms}ms` : undefined)}
              >
                {health.state === "loaded" ? "loaded on this node" : health.state}
              </Badge>
            )}
            {plugin.signature && (
              <Badge variant="outline" className="text-xs" title="A detached Ed25519 signature over the digest was uploaded">
                <ShieldCheck className="h-3 w-3" /> signed
              </Badge>
            )}
            {plugin.tags?.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {plugin.status === "draft" && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/plugins/${encodeURIComponent(plugin.plugin_id)}/edit`}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Link>
            </Button>
          )}
          <LifecycleActions
            onPreflight={() =>
              statusDryRun.mutate({ id: plugin.plugin_id, req: { status: "active" } })
            }
            preflight={statusDryRun.data ?? null}
            preflightPending={statusDryRun.isPending}
            status={plugin.status}
            isPending={isPending}
            onActivate={() => changeStatus.mutate({ id: plugin.plugin_id, req: { status: "active" } })}
            onArchive={() => changeStatus.mutate({ id: plugin.plugin_id, req: { status: "archived" } })}
            onNewVersion={() => createVersion.mutate(plugin.plugin_id)}
            onDelete={() =>
              deletePlugin.mutate(plugin.plugin_id, { onSuccess: () => navigate("/plugins") })
            }
          />
        </div>
      </div>

      {health?.state === "failed" && (
        <Callout variant="destructive">
          This version did not load on the answering node
          {health.reason ? `: ${health.reason}` : "."} Every workflow naming its functions is
          quarantined there.
        </Callout>
      )}
      {health?.state === "disabled" && (
        <Callout variant="info">
          The plugin sandbox is off on this node (<code className="font-mono">plugins.enabled =
          false</code>). The definition can be authored and promoted here, but an active version
          quarantines the workflows that call it until a node with the sandbox on serves them.
        </Callout>
      )}
      {plugin.status === "active" && dependants.length > 0 && (
        <Callout variant="muted">
          {dependants.length} active workflow{dependants.length === 1 ? "" : "s"} call{dependants.length === 1 ? "s" : ""} this
          plugin's functions, so archiving or deleting it is refused (409) until they stop. Activating
          a new version is checked against their inputs: a field renamed or newly required between
          versions is refused naming the workflow, and this version keeps serving.
        </Callout>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="manifest">Manifest</TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Plugin Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Component digest</dt>
                    <dd className="mt-0.5 font-mono text-xs" title={plugin.digest}>
                      {shortDigest(plugin.digest)}
                    </dd>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The identity a generation, a trace, a package and the catalogue all name the
                      artifact by. The signature attests to it; the content hash is over the
                      manifest, digest and tags.
                    </p>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Functions</dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                      {plugin.functions.map((fn) => (
                        <Link key={fn} to={`/functions?q=${encodeURIComponent(fn)}`}>
                          <Badge variant="outline" className="font-mono text-xs transition-colors hover:bg-accent">
                            {fn}
                          </Badge>
                        </Link>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Content hash</dt>
                    <dd className="mt-0.5 font-mono text-xs" title={plugin.content_hash}>
                      {shortDigest(plugin.content_hash)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Compile time</dt>
                    <dd className="mt-0.5">
                      {health?.compile_ms != null ? formatDuration(health.compile_ms) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd className="mt-0.5">{formatDate(plugin.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Updated</dt>
                    <dd className="mt-0.5">{formatDate(plugin.updated_at)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Invocations</CardTitle>
              </CardHeader>
              <CardContent>
                {!metrics.available ? (
                  <p className="text-sm text-muted-foreground">
                    No invocations recorded on this node since the server started. Every call runs
                    in a fresh instance under the operator's ceilings — memory, wall clock, input and
                    output size, a fuel backstop.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Function</TableHead>
                        <TableHead className="text-right">Calls</TableHead>
                        <TableHead className="text-right">Errors</TableHead>
                        <TableHead className="text-right">p95</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {metrics.functions.map((f) => (
                        <TableRow key={f.function}>
                          <TableCell className="font-mono text-xs">{f.function}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {f.invocations.toLocaleString()}
                          </TableCell>
                          <TableCell
                            className="text-right tabular-nums"
                            title={f.failures.map((x) => `${x.category}: ${x.value}`).join(", ") || undefined}
                          >
                            <span className={f.errors > 0 ? "text-destructive" : "text-muted-foreground"}>
                              {f.errors.toLocaleString()}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {formatDuration(f.p95Ms)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="manifest">
          <div className="space-y-4">
            {manifestFunctions.length > 0 && (
              <div className="space-y-3">
                {manifestFunctions.map((fn) => (
                  <ManifestFunction key={fn.name} fn={fn} />
                ))}
              </div>
            )}
            <JsonViewer data={plugin.manifest} label="Manifest" maxHeight="32rem" />
          </div>
        </TabsContent>

        <TabsContent value="dependencies">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                Active workflows calling this plugin ({dependants.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dependants.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active workflow calls{" "}
                  {dependencies?.functions?.length
                    ? dependencies.functions.map((f) => <code key={f} className="mr-1 font-mono">{f}</code>)
                    : "its functions"}
                  .
                </p>
              ) : (
                <ul className="space-y-2">
                  {dependants.map((wf) => (
                    <li key={wf}>
                      <Link to={`/workflows/${wf}`} className="text-sm font-medium underline">
                        {wf}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="versions">
          <VersionHistory versions={versions} isLoading={versionsLoading} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
