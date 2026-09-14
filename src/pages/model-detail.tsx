import { Link, useNavigate, useParams } from "react-router"
import {
  useModel,
  useModelVersions,
  useModelDependencies,
  useChangeModelStatus,
  useModelStatusDryRun,
  useCreateModelVersion,
  useDeleteModel,
  useAdmitModel,
} from "@/hooks/use-models"
import { useModelMetrics } from "@/hooks/use-metrics"
import type { Model, ModelInputDecl, ModelOutputDecl } from "@/api/types"
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
import { VersionCompare } from "@/components/shared/version-compare"
import { JsonViewer } from "@/components/shared/json-viewer"
import { ErrorState } from "@/components/shared/error-state"
import { Breadcrumbs } from "@/components/shared/breadcrumbs"
import { BAD, WARN, admissionStateBadgeClass, modelHealthBadgeClass } from "@/lib/status"
import { admissionFailure, admissionStage, formatTensorType } from "@/lib/model-manifest"
import { copyText } from "@/lib/clipboard"
import { formatBytes, formatDate, formatDuration, shortDigest } from "@/lib/utils"
import { Copy, GitBranch, Pencil, RefreshCw, ShieldCheck } from "lucide-react"

const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString())

/**
 * The tensor signature, from the manifest's own declarations. This is the one
 * thing a workflow author needs and the manifest buries: what goes in, what
 * comes out, and whether the marshalling is the default or the author's.
 */
function SignatureTable({
  title,
  decls,
  kind,
}: {
  title: string
  decls: (ModelInputDecl | ModelOutputDecl)[]
  kind: "input" | "output"
}) {
  if (decls.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The manifest declares no {kind}s.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Marshalling</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {decls.map((decl) => {
            const adapter = kind === "input" ? (decl as ModelInputDecl).adapter : undefined
            return (
              <TableRow key={decl.name}>
                <TableCell className="font-mono text-xs">{decl.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {formatTensorType(decl.dtype, decl.shape)}
                </TableCell>
                <TableCell>
                  {kind === "output" ? (
                    <span className="text-xs text-muted-foreground">
                      read by the result expression
                    </span>
                  ) : adapter ? (
                    <Badge
                      variant="outline"
                      className="text-[10px]"
                      title="JSONLogic over the JSON the task hands over, producing this tensor"
                    >
                      custom adapter
                    </Badge>
                  ) : (
                    <span
                      className="text-xs text-muted-foreground"
                      title={`Defaults to {"tensor": [{"var": "${decl.name}"}, "${decl.dtype}"]}`}
                    >
                      default adapter
                    </span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * The admission verdict: whether a node has fetched the artifact from the
 * bucket, hashed it to the claimed digest and probed the graph. It is the one
 * gate no other entity has, and the reason a freshly-registered model cannot
 * be activated yet.
 */
function AdmissionCard({ model, onAdmit, admitting }: {
  model: Model
  onAdmit: () => void
  admitting: boolean
}) {
  const { state, stage, reason, node, at } = model.admission
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Admission</CardTitle>
        <Button size="sm" variant="outline" onClick={onAdmit} disabled={admitting}>
          <RefreshCw className={`h-3.5 w-3.5 ${admitting ? "animate-spin" : ""}`} />
          {admitting ? "Running..." : "Re-admit"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={admissionStateBadgeClass(state)}>
            {state}
          </Badge>
          {stage && state === "failed" && (
            <Badge variant="outline" className="text-xs" title="The step the verdict stopped at">
              stopped at {stage}
            </Badge>
          )}
        </div>
        {reason && <p className="text-sm text-muted-foreground">{reason}</p>}
        {state === "pending" && (
          <p className="text-sm text-muted-foreground">
            Registration answered <code className="font-mono">202</code> and the node's admission
            worker is doing the rest: fetch the object through the connector, verify the digest,
            read the graph, and run five probe inferences over zero-filled inputs. This page polls
            until the verdict lands.
          </p>
        )}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Recorded by</dt>
            <dd className="mt-0.5 font-mono text-xs">{node ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Recorded at</dt>
            <dd className="mt-0.5">{at ? formatDate(at) : "—"}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          In a cluster the verdict is shared and the bytes are not. Admission runs once, on the
          node that took the registration; a peer loads the model on that verdict without
          re-probing, but fetches and re-hashes the object itself before it will run the graph.
        </p>
      </CardContent>
    </Card>
  )
}

export function ModelDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const modelId = id ?? ""
  const { data: model, isLoading, error, refetch } = useModel(modelId)
  const { data: versions, isLoading: versionsLoading } = useModelVersions(modelId)
  const { data: dependencies } = useModelDependencies(modelId)
  const statusDryRun = useModelStatusDryRun()
  const changeStatus = useChangeModelStatus()
  const createVersion = useCreateModelVersion()
  const deleteModel = useDeleteModel()
  const admit = useAdmitModel()
  const metrics = useModelMetrics(modelId)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (error || !model) {
    return (
      <ErrorState
        title="Failed to load model"
        error={error}
        onRetry={() => refetch()}
        backTo={{ to: "/models", label: "Back to Models" }}
      />
    )
  }

  const isPending = changeStatus.isPending || createVersion.isPending || deleteModel.isPending
  const health = model.health ?? null
  const stats = model.stats ?? null
  const dependants = dependencies?.workflows ?? []
  const admitted = model.admission.state === "passed"
  const inputs = model.manifest?.inputs ?? []
  const outputs = model.manifest?.outputs ?? []

  // Knowable before the request, so the button says so rather than the server
  // answering 409 after a round trip.
  const activateRefusedReason = admitted
    ? null
    : model.admission.state === "failed"
      ? `${admissionFailure(model.admission)} — fix the artifact or the manifest and re-admit`
      : "Admission has not passed yet — no node has verified the artifact"

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Models", to: "/models" }, { label: model.model_id }]} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold">{model.model_id}</h1>
            <StatusBadge status={model.status} />
            <Badge variant="outline">v{model.version}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              className="text-xs"
              title="The author's own version string, informational"
            >
              {model.model_version}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {model.format}
            </Badge>
            <Badge
              variant="outline"
              className="font-mono text-xs"
              title="The manifest ABI the model was registered against"
            >
              {model.abi}
            </Badge>
            <Badge
              variant="outline"
              className={admissionStateBadgeClass(model.admission.state)}
              title={model.admission.reason ?? undefined}
            >
              admission {model.admission.state}
            </Badge>
            {health && (
              <Badge
                variant="outline"
                className={modelHealthBadgeClass(health.state)}
                title={health.reason ?? undefined}
              >
                {health.state === "loaded"
                  ? `loaded here${health.runtime ? ` · ${health.runtime}/${health.device}` : ""}`
                  : `${health.state} on this node`}
              </Badge>
            )}
            {model.signature && (
              <Badge
                variant="outline"
                className="text-xs"
                title="A detached Ed25519 signature over the digest was registered"
              >
                <ShieldCheck className="h-3 w-3" /> signed
              </Badge>
            )}
            {model.tags?.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {model.status === "draft" && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/models/${encodeURIComponent(model.model_id)}/edit`}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Link>
            </Button>
          )}
          <LifecycleActions
            onPreflight={() => statusDryRun.mutate({ id: model.model_id, req: { status: "active" } })}
            preflight={statusDryRun.data ?? null}
            preflightPending={statusDryRun.isPending}
            activateRefusedReason={activateRefusedReason}
            status={model.status}
            isPending={isPending}
            onActivate={() => changeStatus.mutate({ id: model.model_id, req: { status: "active" } })}
            onArchive={() =>
              changeStatus.mutate({ id: model.model_id, req: { status: "archived" } })
            }
            onNewVersion={() => createVersion.mutate(model.model_id)}
            onDelete={() =>
              deleteModel.mutate(model.model_id, { onSuccess: () => navigate("/models") })
            }
          />
        </div>
      </div>

      {model.admission.state === "failed" && (
        <Callout variant="destructive">
          Admission failed at <code className="font-mono">{admissionStage(model.admission)}</code>
          {model.admission.reason ? `: ${model.admission.reason}` : "."} The model cannot be
          activated until a node records a passing verdict — fix the reference, the object or the
          manifest, then re-admit.
        </Callout>
      )}
      {health?.state === "failed" && (
        <Callout variant="destructive">
          This node's generation could not carry the model
          {health.reason ? `: ${health.reason}` : "."} Every workflow naming it by literal id is
          quarantined here, and their channels answer <code className="font-mono">503</code>.
        </Callout>
      )}
      {health?.state === "disabled" && (
        <Callout variant="info">
          The model runtime is off on this node (<code className="font-mono">models.enabled =
          false</code>). The definition can be authored and promoted here, but an active model
          quarantines the workflows naming it until a node with the runtime on serves them.
        </Callout>
      )}
      {model.status === "active" && dependants.length > 0 && (
        <Callout variant="muted">
          {dependants.length} active workflow{dependants.length === 1 ? "" : "s"} name
          {dependants.length === 1 ? "s" : ""} this model by literal id, so archiving or deleting it
          is refused (409) until they stop.
        </Callout>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="signature">Signature</TabsTrigger>
          <TabsTrigger value="manifest">Manifest</TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <AdmissionCard
              model={model}
              admitting={admit.isPending}
              onAdmit={() => admit.mutate(model.model_id)}
            />

            <Card>
              <CardHeader>
                <CardTitle>Artifact</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Digest</dt>
                    <dd className="mt-0.5 flex items-center gap-2">
                      <span className="font-mono text-xs" title={model.digest}>
                        {shortDigest(model.digest)}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5"
                        onClick={() => void copyText(model.digest, "Digest")}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </dd>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Claimed at registration and confirmed by every node that holds the bytes. It
                      is the identity a generation, a trace and a package all name the model by.
                    </p>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Connector</dt>
                    <dd className="mt-0.5">
                      <Link
                        to={`/connectors?q=${encodeURIComponent(model.artifact.connector)}`}
                        className="font-mono text-xs underline underline-offset-2"
                      >
                        {model.artifact.connector}
                      </Link>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Size</dt>
                    <dd className="mt-0.5 tabular-nums">
                      {formatBytes(stats?.artifact_bytes ?? model.artifact.size)}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Object key</dt>
                    <dd className="mt-0.5 font-mono text-xs break-all">{model.artifact.key}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Content hash</dt>
                    <dd className="mt-0.5 font-mono text-xs" title={model.content_hash}>
                      {shortDigest(model.content_hash)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Updated</dt>
                    <dd className="mt-0.5">{formatDate(model.updated_at)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Inferences on this node</CardTitle>
              </CardHeader>
              <CardContent>
                {!metrics.available ? (
                  <p className="text-sm text-muted-foreground">
                    No inference recorded on this node since the server started. Counters are
                    cumulative and per node — a peer serving the same model keeps its own.
                  </p>
                ) : (
                  <>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
                      <div>
                        <dt className="text-muted-foreground">Inferences</dt>
                        <dd className="mt-0.5 tabular-nums">
                          {metrics.inferences.toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Errors</dt>
                        <dd
                          className={`mt-0.5 tabular-nums ${metrics.errors > 0 ? "text-destructive" : ""}`}
                        >
                          {metrics.errors.toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">p95</dt>
                        <dd className="mt-0.5 tabular-nums">{formatDuration(metrics.p95Ms)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Mean</dt>
                        <dd className="mt-0.5 tabular-nums">{formatDuration(metrics.meanMs)}</dd>
                      </div>
                      <div>
                        <dt
                          className="text-muted-foreground"
                          title="Time an inference waited for a concurrency permit — saturation, not the graph's own cost"
                        >
                          Queue p95
                        </dt>
                        <dd className="mt-0.5 tabular-nums">
                          {formatDuration(metrics.queueP95Ms)}
                        </dd>
                      </div>
                    </dl>

                    {metrics.failures.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs text-muted-foreground">Failures by category</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {metrics.failures.map((f) => (
                            <Badge
                              key={f.category}
                              variant="outline"
                              // A failure category is not a model health state —
                              // name the tone rather than borrowing an unrelated
                              // key from `modelHealthClass` for its colour.
                              className={f.category === "timeout" ? WARN : BAD}
                              title={
                                f.category === "timeout"
                                  ? "The one retryable category — the deadline elapsed while loading, waiting or running"
                                  : undefined
                              }
                            >
                              {f.category} · {f.value.toLocaleString()}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="mt-4 text-xs text-muted-foreground">
                      {metrics.demandLoads > 0
                        ? `${metrics.demandLoads.toLocaleString()} cold load${metrics.demandLoads === 1 ? "" : "s"} were paid by a request rather than by the preload — a request that finds the session cold is charged the load against its own deadline.`
                        : "No request has paid a cold load: every load was the admission probe or the preload, which is what models.preload = \"referenced\" is for."}
                      {metrics.runtimes.length > 0 && ` Served on ${metrics.runtimes.join(", ")}.`}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>What the node measured</CardTitle>
              </CardHeader>
              <CardContent>
                {!stats ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing yet — the graph numbers are read at admission, so they land with a
                    passing verdict.
                  </p>
                ) : (
                  <>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">Parameters</dt>
                        <dd className="mt-0.5 tabular-nums">{num(stats.parameters)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Graph nodes</dt>
                        <dd className="mt-0.5 tabular-nums">{num(stats.nodes)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Opset</dt>
                        <dd className="mt-0.5 tabular-nums">{num(stats.opset)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">IR version</dt>
                        <dd className="mt-0.5 tabular-nums">{num(stats.ir_version)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Probe</dt>
                        <dd className="mt-0.5 tabular-nums" title="Median of five inferences over zero-filled inputs">
                          {stats.probe_ms != null ? formatDuration(stats.probe_ms) : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Runtime</dt>
                        <dd className="mt-0.5 font-mono text-xs">{stats.runtime ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Device</dt>
                        <dd className="mt-0.5 font-mono text-xs">{stats.device ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Resident here</dt>
                        <dd className="mt-0.5 tabular-nums">
                          {formatBytes(health?.resident_bytes)}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-4 text-xs text-muted-foreground">
                      The graph numbers are read from the ONNX protobuf itself, so they are the same
                      on every node and every runtime — which is why a workflow scoring a
                      competition reads <code className="font-mono">parameters</code> from here
                      rather than trusting the entrant's claim. The probe numbers describe the
                      admitting node alone.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="signature">
          <Card>
            <CardHeader>
              <CardTitle>Tensor signature</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <SignatureTable title="Inputs" decls={inputs} kind="input" />
              <SignatureTable title="Outputs" decls={outputs} kind="output" />
              <p className="text-xs text-muted-foreground">
                A task never spells a tensor: it names the model, hands over the JSON root every
                adapter reads (<code className="font-mono">input</code>), and says where the result
                goes. Leave an adapter out and the default applies —
                <code className="font-mono"> {`{"tensor": [{"var": name}, dtype]}`}</code> in, a
                nested list per output back — which is enough for a caller that already speaks
                tensors.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manifest">
          <div className="space-y-4">
            <Callout variant="muted">
              The validated manifest as the server stores it — what was registered, with nothing it
              inferred added. Every adapter and the result expression are compiled on the serving
              generation's own engine, so they use the tensor operator family and are priced by{" "}
              <code className="font-mono">engine.ops_budget</code>. None may read{" "}
              <code className="font-mono">{`{"secret": …}`}</code>,{" "}
              <code className="font-mono">now</code> or <code className="font-mono">random</code>.
            </Callout>
            <JsonViewer data={model.manifest} label="Manifest" maxHeight="32rem" />
          </div>
        </TabsContent>

        <TabsContent value="dependencies">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                Active workflows naming this model ({dependants.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {dependants.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active workflow names this model by literal id.
                </p>
              ) : (
                <ul className="space-y-3">
                  {dependants.map((wf) => (
                    <li key={wf.workflow_id} className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/workflows/${wf.workflow_id}`}
                        className="text-sm font-medium underline underline-offset-2"
                      >
                        {wf.workflow_id}
                      </Link>
                      <span className="text-xs text-muted-foreground">v{wf.version}</span>
                      {wf.task_ids.map((task) => (
                        <Badge key={task} variant="outline" className="font-mono text-[10px]">
                          {task}
                        </Badge>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
              {dependencies?.dynamic_references_unlisted && (
                <p className="text-xs text-muted-foreground">
                  A <code className="font-mono">model_infer</code> task whose{" "}
                  <code className="font-mono">input.model</code> is an expression resolves per
                  message, so it is not listed here and not gated on — archiving this model will
                  not be refused for it. Such a call fails as{" "}
                  <code className="font-mono">unavailable</code> at request time instead.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="versions">
          <div className="space-y-6">
            <VersionHistory versions={versions} isLoading={versionsLoading} />
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Compare versions</h3>
              <VersionCompare versions={versions} isLoading={versionsLoading} />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
