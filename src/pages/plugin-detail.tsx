import { useMemo } from "react"
import { Link, useParams } from "react-router"
import { usePlugin } from "@/hooks/use-plugins"
import { useHealth } from "@/hooks/use-health"
import { useDeploymentHead } from "@/hooks/use-deployments"
import { useQuarantineReason, useRegistry } from "@/hooks/use-registry"
import { usePluginMetrics } from "@/hooks/use-metrics"
import { dependents } from "@/lib/deployment-diff"
import type { PluginManifestFunction } from "@/api/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import { DetailHeader, DetailSkeleton } from "@/components/shared/detail-header"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { EntityHistoryPanel } from "@/components/shared/entity-history"
import { NotDeployedState, QuarantineBadge } from "@/components/shared/deployed-state"
import { JsonViewer } from "@/components/shared/json-viewer"
import { ErrorState } from "@/components/shared/error-state"
import { pluginHealthBadgeClass } from "@/lib/status"
import { formatBytes, formatDuration, shortDigest } from "@/lib/utils"
import { GitBranch, ShieldCheck } from "lucide-react"

/** One manifest function's field table, in the manifest's own vocabulary. */
function ManifestFunction({ fn }: { fn: PluginManifestFunction }) {
  const fields = fn.input_fields ?? []
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{fn.name}</span>
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
  const { id: pluginId = "" } = useParams<{ id: string }>()
  const { data: plugin, isLoading, error, refetch, notDeployed } = usePlugin(pluginId)
  const registry = useRegistry()
  const head = useDeploymentHead()
  const quarantine = useQuarantineReason(plugin?.member.entity)
  const metrics = usePluginMetrics(pluginId)
  // Who requires it in the head — the reverse of `requires`.
  const dependants = useMemo(
    () => dependents(registry.members, { kind: "plugin", id: pluginId }),
    [registry.members, pluginId],
  )
  // This node's load of the component, from `/health`'s admin detail.
  const { data: healthReport } = useHealth()
  const health = useMemo(() => {
    if (!plugin) return null
    const match = (p: { plugin: string; version: number; digest: string }) =>
      (plugin.component_digest && p.digest === plugin.component_digest) ||
      (p.plugin === plugin.plugin_id && p.version === plugin.revision)
    const loaded = healthReport?.plugins?.loaded?.find(match)
    if (loaded) return { state: "loaded" as const, compile_ms: loaded.compile_ms, reason: null }
    const failed = healthReport?.plugins?.failed_to_load?.find(match)
    if (failed) return { state: "failed" as const, reason: `${failed.stage}: ${failed.reason}`, compile_ms: null }
    if (healthReport?.components?.plugins === "disabled") return { state: "disabled" as const, reason: null, compile_ms: null }
    return null
  }, [plugin, healthReport])

  if (isLoading) {
    return <DetailSkeleton />
  }

  if (notDeployed) {
    return <NotDeployedState kind="plugin" id={pluginId} backTo={{ to: "/plugins", label: "Back to Plugins" }} />
  }

  if (error || !plugin) {
    return (
      <ErrorState
        title="Failed to load plugin"
        error={error}
        onRetry={() => refetch()}
        backTo={{ to: "/plugins", label: "Back to Plugins" }}
      />
    )
  }

  const manifestFunctions = plugin.manifest?.functions ?? []

  return (
    <div className="space-y-6">
      <DetailHeader
        breadcrumbs={[{ label: "Plugins", to: "/plugins" }, { label: plugin.plugin_id }]}
        title={plugin.plugin_id}
        titleClassName="font-mono"
        badges={
          <>
            <Badge variant="outline" title="The member's revision">
              r{plugin.revision}
            </Badge>
            <QuarantineBadge reason={quarantine} />
          </>
        }
        meta={
          <div className="flex flex-wrap items-center gap-2">
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
            {plugin.signature ? (
              <Badge variant="outline" className="text-xs" title="A detached Ed25519 signature over the component digest">
                <ShieldCheck className="h-3 w-3" /> signed
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs text-muted-foreground" title="No signature: accepted only where [plugins.trust] names no keys">
                unsigned
              </Badge>
            )}
            {plugin.tags?.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
            ))}
          </div>
        }
      />

      {health?.state === "failed" && (
        <Callout variant="destructive">
          This revision did not load on the answering node
          {health.reason ? `: ${health.reason}` : "."} Every workflow naming its functions is
          quarantined there.
        </Callout>
      )}
      {health?.state === "disabled" && (
        <Callout variant="info">
          The plugin sandbox is off on this node (<code className="font-mono">plugins.enabled =
          false</code>). The plugin is deployed, but the workflows that require it are quarantined
          until a node with the sandbox on serves them.
        </Callout>
      )}
      {quarantine && (
        <Callout variant="destructive">Quarantined on this node: {quarantine}</Callout>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="manifest">Manifest</TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
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
                    <dt className="text-muted-foreground">Component</dt>
                    <dd className="mt-0.5 font-mono text-xs" title={plugin.component_digest}>
                      {plugin.component_digest ? shortDigest(plugin.component_digest) : "digest not computed in this browser"}
                      {plugin.component_bytes != null && (
                        <span className="text-muted-foreground"> · {formatBytes(plugin.component_bytes)}</span>
                      )}
                    </dd>
                    <p className="mt-1 text-xs text-muted-foreground">
                      What the catalogue, a trace and <code className="font-mono">/health</code> name it by; the
                      signature attests to it. The definition digest covers the manifest and the component together.
                    </p>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Functions</dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                      {plugin.functions.map((fn) => (
                        <Badge key={fn} variant="outline" className="font-mono text-xs">
                          {fn}
                        </Badge>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Definition</dt>
                    <dd className="mt-0.5 font-mono text-xs" title={plugin.digest}>
                      {shortDigest(plugin.digest)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Compile time</dt>
                    <dd className="mt-0.5">
                      {health?.compile_ms != null ? formatDuration(health.compile_ms) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Deployed in</dt>
                    <dd className="mt-0.5">
                      {head.data?.head ? (
                        <Link to={`/deployments/${head.data.head}`} className="underline underline-offset-2">
                          revision {head.data.head}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </dd>
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
                Members requiring this plugin ({dependants.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dependants.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing in the head requires it, so none of{" "}
                  {plugin.functions.map((f) => (
                    <code key={f} className="mr-1 font-mono">
                      {f}
                    </code>
                  ))}
                  is called.
                </p>
              ) : (
                <ul className="space-y-2">
                  {dependants.map((m) => (
                    <li key={`${m.entity.kind}:${m.entity.id}@${m.entity.revision}`}>
                      <Link
                        to={`/${m.entity.kind}s/${encodeURIComponent(m.entity.id)}`}
                        className="text-sm font-medium underline"
                      >
                        {m.entity.id}
                      </Link>{" "}
                      <span className="text-xs text-muted-foreground">
                        {m.entity.kind} r{m.entity.revision}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <EntityHistoryPanel
            kind="plugin"
            id={plugin.plugin_id}
            current={[{ revision: plugin.revision, digest: plugin.digest }]}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
