import { useReadiness, useRuntimeCapabilities, SUPPORTED_API_VERSION } from "@/hooks/use-runtime-capabilities"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import { Skeleton } from "@/components/ui/skeleton"
import { Fact } from "@/components/shared/fact"
import { ErrorState } from "@/components/shared/error-state"
import { componentStateBadgeClass } from "@/lib/status"
import { plural } from "@/lib/utils"
import type { EntityRef, RuntimeCapabilities } from "@/api/types"
import { Boxes, Cpu, GitCommitVertical, Plug } from "lucide-react"

const EDITION_LABEL = { community: "Community", standard: "Standard", enterprise: "Enterprise" } as const

const entityLabel = (e: EntityRef) => `${e.kind} ${e.id} r${e.revision}`

/**
 * `GET admin/runtime-capabilities`, read out: what this node runs (edition,
 * channel drivers, provider backends, plugin worlds) and where its reconciler
 * stands against the deployment head. Every fact describes **the node that
 * answered**; in a cluster a peer may be converging on the same head from a
 * different place.
 */
export function RuntimeReport() {
  const { data: caps, isLoading, error, refetch } = useRuntimeCapabilities()
  const { data: ready } = useReadiness()

  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />
  if (error || !caps) {
    return <ErrorState title="Could not read this node's runtime capabilities" error={error} onRetry={refetch} />
  }

  return (
    <>
      {caps.api_version !== SUPPORTED_API_VERSION && (
        <Callout variant="warning">
          This server speaks API version {caps.api_version}; this console is built for version{" "}
          {SUPPORTED_API_VERSION}. Pages may show fields it no longer serves or miss ones it added.
        </Callout>
      )}
      <NodeCard caps={caps} clusterStore={ready?.components.cluster_store ?? null} />
      <DriversCard caps={caps} />
      <BackendsCard caps={caps} />
    </>
  )
}

function NodeCard({
  caps,
  clusterStore,
}: {
  caps: RuntimeCapabilities
  clusterStore: { name: string; status: string } | null
}) {
  const node = caps.node_status
  const behind = node.applied_revision !== caps.deployment_head.revision
  const converging = node.desired_revision !== node.applied_revision
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCommitVertical className="h-4 w-4" /> Deployment on this node
          <Badge variant="outline" className="ml-1">
            {EDITION_LABEL[caps.edition] ?? caps.edition}
          </Badge>
        </CardTitle>
        <CardDescription>
          What the deployment head is, and what this node serves. Applying a deployment rebuilds
          the engine; each node converges on the head by itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          <Fact label="Head revision" title={`Epoch ${caps.deployment_head.epoch}`}>
            {caps.deployment_head.revision === 0 ? "none yet" : caps.deployment_head.revision}
          </Fact>
          <Fact label="Applied here">{node.applied_revision === 0 ? "none" : node.applied_revision}</Fact>
          <Fact label="Converging on">{node.desired_revision === 0 ? "—" : node.desired_revision}</Fact>
          <Fact label="Node" title={`Node ${node.node_id}, boot ${node.boot_id}`}>
            {node.node_id.slice(0, 8)}
          </Fact>
          <Fact label="Scheduler" mono={false} title="Native scheduler work in flight, of its limit">
            {caps.native_scheduler.in_flight} of {caps.native_scheduler.max_in_flight}
          </Fact>
          <Fact label="Cluster store" mono={false}>
            {clusterStore ? (
              <Badge variant="outline" className={componentStateBadgeClass(clusterStore.status)}>
                {clusterStore.name} {clusterStore.status}
              </Badge>
            ) : (
              "none (single node)"
            )}
          </Fact>
        </dl>
        {node.retained_revisions.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Kept built on this node: revision{node.retained_revisions.length === 1 ? "" : "s"}{" "}
            {node.retained_revisions.join(", ")}.
          </p>
        )}
        {node.last_error && (
          <Callout variant="destructive">
            Building revision {node.desired_revision} failed: {node.last_error}
            {node.backoff_attempt > 0 &&
              ` — retrying (attempt ${node.backoff_attempt}, next in ${Math.round(node.backoff_delay_ms / 1000)} s).`}
          </Callout>
        )}
        {!node.last_error && converging && (
          <Callout variant="info">
            Converging from revision {node.applied_revision} to {node.desired_revision}.
          </Callout>
        )}
        {!node.last_error && !converging && behind && caps.deployment_head.revision > 0 && (
          <Callout variant="info">
            This node serves revision {node.applied_revision}; the head is {caps.deployment_head.revision}.
          </Callout>
        )}
        {node.quarantined_entities.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-warning">
              {plural(node.quarantined_entities.length, "member")} of the applied revision{" "}
              {node.quarantined_entities.length === 1 ? "is" : "are"} quarantined on this node:
            </p>
            <ul className="space-y-1 text-sm">
              {node.quarantined_entities.map((q) => (
                <li key={entityLabel(q.entity)} className="rounded-md border px-3 py-1.5">
                  <span className="font-mono text-xs">{entityLabel(q.entity)}</span>
                  <span className="text-muted-foreground"> — {q.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DriversCard({ caps }: { caps: RuntimeCapabilities }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Boxes className="h-4 w-4" /> Channel drivers
        </CardTitle>
        <CardDescription>
          The protocols a channel may name on this node. A protocol missing here is one a
          deployment naming it would be refused for.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {caps.channel_driver_info.map((d) => (
            <Badge
              key={d.protocol}
              variant="outline"
              title={[
                d.supports_sync && "sync",
                d.supports_async && "async",
                d.registers_http_routes && "HTTP routes",
                d.supports_oauth2_login && "OAuth2 login",
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              {d.protocol}
              <span className="ml-1.5 text-muted-foreground">
                {[d.supports_sync && "sync", d.supports_async && "async"].filter(Boolean).join("/")}
              </span>
            </Badge>
          ))}
        </div>
        {caps.wasm_worlds.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <Cpu className="mr-1 inline h-3.5 w-3.5" />
            WebAssembly plugins: <span className="font-mono">{caps.wasm_worlds.join(", ")}</span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function BackendsCard({ caps }: { caps: RuntimeCapabilities }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4" /> Provider backends
        </CardTitle>
        <CardDescription>
          The connector providers this node registers, and the operations a{" "}
          <code className="font-mono">connector_call</code> may name on each. Admission policy:{" "}
          <span className="font-mono">{caps.admission_policy_id}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {caps.provider_backends.length === 0 ? (
          <p className="text-sm text-muted-foreground">No provider backends are registered.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {caps.provider_backends.map((b) => {
              const ops = Object.entries(b.operations ?? {})
              return (
                <li key={b.driver_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                  <span className="font-mono text-xs" title={b.package_digest ?? undefined}>
                    {b.driver_id}
                  </span>
                  <Badge variant="outline" className="text-[11px]">
                    {b.kind}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {ops.length === 0
                      ? "declares no operations"
                      : ops
                          .map(([name, op]) => (op.aliases?.length ? `${name} (${op.aliases.join(", ")})` : name))
                          .join(" · ")}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
