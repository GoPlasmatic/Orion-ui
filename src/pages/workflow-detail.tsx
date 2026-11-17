import { useMemo, useState } from "react"
import { Link, useParams } from "react-router"
import { executionTrace } from "@/lib/trace-timeline"
import { useWorkflow, useTestDefinition } from "@/hooks/use-workflows"
import { useDefinition, useDeploymentHead } from "@/hooks/use-deployments"
import { useQuarantineReason, useRegistry } from "@/hooks/use-registry"
import { READ_ONLY_REASON, useCanMutate } from "@/hooks/use-admin-auth"
import { useLastTraceInput } from "@/hooks/use-last-trace-input"
import { useFunctions } from "@/hooks/use-functions"
import { stepCompletions } from "@/lib/workflow-completions"
import { readStorage, writeStorage } from "@/lib/storage"
import { useUrlFilters } from "@/lib/use-url-filters"
import { channelsRunning, workflowShares } from "@/lib/deployed-registry"
import { refLabel, shortDigest } from "@/lib/deployment-diff"
import { stableJson } from "@/lib/line-diff"
import { describeError } from "@/lib/toast-error"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { DetailHeader, DetailSkeleton } from "@/components/shared/detail-header"
import { JsonEditor } from "@/components/shared/json-editor"
import { JsonViewer } from "@/components/shared/json-viewer"
import { JsonDiff } from "@/components/shared/json-diff"
import { ErrorState } from "@/components/shared/error-state"
import { EntityHistoryPanel } from "@/components/shared/entity-history"
import { NotDeployedState, QuarantineBadge } from "@/components/shared/deployed-state"
import { RolloutBar } from "@/components/deployments/rollout-bar"
import { WorkflowLenses } from "@/components/workflow/workflow-lenses"
import { stepResultBadgeClass } from "@/lib/status"
import { CircleStop, History, Layers, OctagonX, Pencil, Play, Radio, RotateCcw } from "lucide-react"
import { countGroups, countHaltOnFailure, countLeafSteps, countTerminal, workflowSteps } from "@/lib/workflow-steps"
import type { Channel, TestDefinitionResponse, Workflow } from "@/api/types"

/** The last dry-run payload, per workflow, in this browser only. */
const dryRunKey = (id: string) => `orion-dryrun-${id}`
const EMPTY_PAYLOAD = "{\n  \n}"

const TABS = ["test", "history", "definition"] as const
const URL_KEYS = ["tab", "revision"] as const

export function WorkflowDetailPage() {
  const { id = "" } = useParams<{ id: string }>()
  const { values, set } = useUrlFilters(URL_KEYS)
  const { data: primary, revisions, isLoading, error, refetch, notDeployed } = useWorkflow(id)
  const registry = useRegistry()
  const head = useDeploymentHead()

  // Under a canary the head deploys several revisions; `?revision=` picks the
  // one the page reads, defaulting to the one serving the most traffic.
  const picked = Number(values.revision)
  const workflow = revisions.find((w) => w.revision === picked) ?? primary
  const quarantine = useQuarantineReason(workflow?.member.entity)
  const runsOn = useMemo(() => channelsRunning(registry, id), [registry, id])
  const shares = useMemo(() => workflowShares(registry.channels), [registry.channels])
  const tab = (TABS as readonly string[]).includes(values.tab) ? values.tab : "test"

  if (isLoading) return <DetailSkeleton />
  if (notDeployed) {
    return <NotDeployedState kind="workflow" id={id} backTo={{ to: "/workflows", label: "Back to Workflows" }} />
  }
  if (error || !workflow) {
    return (
      <ErrorState
        title="Failed to load workflow"
        error={error}
        onRetry={() => refetch()}
        backTo={{ to: "/workflows", label: "Back to Workflows" }}
      />
    )
  }

  // Orion 1.2 / dataflow-rs 3.6: a `tasks` element carrying its own `tasks` key
  // is a task group, so the array length is not the number of tasks that run.
  const steps = workflowSteps(workflow)
  const taskCount = countLeafSteps(steps)
  const groupCount = countGroups(steps)
  const terminalCount = countTerminal(steps)
  const haltCount = countHaltOnFailure(steps)
  const requires = workflow.member.requires ?? []

  return (
    <div className="space-y-6">
      <DetailHeader
        breadcrumbs={[{ label: "Workflows", to: "/workflows" }, { label: workflow.name }]}
        title={workflow.name}
        badges={
          <>
            <Badge variant="outline" title="The member's revision">
              r{workflow.revision}
            </Badge>
            {revisions.length > 1 && (
              <Badge variant="outline" title="Its channels split their buckets across several revisions">
                canary
              </Badge>
            )}
            <QuarantineBadge reason={quarantine} />
          </>
        }
        meta={
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{workflow.workflow_id}</span> · definition{" "}
              <span className="font-mono" title={workflow.digest}>
                {shortDigest(workflow.digest)}
              </span>
              {head.data?.head ? (
                <>
                  {" "}
                  · deployed in{" "}
                  <Link to={`/deployments/${head.data.head}`} className="underline underline-offset-2">
                    revision {head.data.head}
                  </Link>
                </>
              ) : null}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {workflow.tags?.length > 0 && (
                <div className="flex gap-1">
                  {workflow.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
              <span className="text-sm text-muted-foreground">
                {taskCount} {taskCount === 1 ? "task" : "tasks"}
              </span>
              {groupCount > 0 && (
                <Badge variant="outline" className="text-xs" title="Guard clauses — one condition gating a contiguous run of tasks">
                  <Layers className="mr-1 h-3 w-3" />
                  {groupCount} {groupCount === 1 ? "group" : "groups"}
                </Badge>
              )}
              {terminalCount > 0 && (
                <Badge variant="outline" className="text-xs" title="Steps that end the workflow once they have run">
                  <CircleStop className="mr-1 h-3 w-3" />
                  {terminalCount} terminal
                </Badge>
              )}
              {haltCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-xs"
                  title="Tasks that end the workflow on their own outcome (on_rejection or on_failure: halt)"
                >
                  <OctagonX className="mr-1 h-3 w-3" />
                  {haltCount} halt on outcome
                </Badge>
              )}
              {workflow.on_failure === "continue" && (
                <Badge variant="outline" className="text-xs" title="on_failure: continue — a failing task does not stop the run">
                  continues on failure
                </Badge>
              )}
            </div>
            <RunsOn runsOn={runsOn} workflow={workflow} />
            {requires.length > 0 && (
              <p className="text-xs text-muted-foreground">Requires {requires.map(refLabel).join(", ")}.</p>
            )}
          </div>
        }
      />

      {quarantine && (
        <Callout variant="destructive">
          <p className="font-medium">Quarantined — this node could not build revision {workflow.revision}.</p>
          <p className="mt-1 text-xs">{quarantine}</p>
        </Callout>
      )}

      {revisions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Deployed at</span>
          {revisions.map((w) => (
            <Button
              key={w.revision}
              size="sm"
              variant={w.revision === workflow.revision ? "default" : "outline"}
              onClick={() => set({ revision: w === primary ? "" : String(w.revision) })}
            >
              r{w.revision} · {shares.get(`${w.workflow_id}@${w.revision}`) ?? 0}%
            </Button>
          ))}
        </div>
      )}

      {/* The diagram is the primary content of the page: one step tree, four
          lenses (structure, dependencies, cost, last run), state in the URL. */}
      <WorkflowLenses workflow={workflow} runsOn={runsOn} />

      <Tabs defaultValue="test" value={tab} onValueChange={(v) => set({ tab: v === "test" ? "" : v })}>
        <TabsList>
          <TabsTrigger value="test">Test</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="definition">Definition</TabsTrigger>
        </TabsList>

        <TabsContent value="test">
          <TestPanel key={workflow.digest} workflow={workflow} sampleChannel={runsOn[0]} />
        </TabsContent>

        <TabsContent value="history">
          <EntityHistoryPanel
            kind="workflow"
            id={workflow.workflow_id}
            current={revisions.map((w) => ({ revision: w.revision, digest: w.digest }))}
          />
        </TabsContent>

        <TabsContent value="definition" className="space-y-3">
          <JsonViewer data={workflow.member} label="Manifest member" maxHeight="16rem" />
          <StoredDefinitionView digest={workflow.digest} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** Which channels require it, each with the share of buckets it routes to this revision. */
function RunsOn({ runsOn, workflow }: { runsOn: Channel[]; workflow: Workflow }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <Radio className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">Runs on</span>
        {runsOn.length === 0 ? (
          <span className="text-warning">no channel — nothing reaches this workflow</span>
        ) : (
          runsOn.map((c) => (
            <Link key={c.channel_id} to={`/channels/${encodeURIComponent(c.channel_id)}`}>
              <Badge variant="outline" className="transition-colors hover:bg-accent">
                {c.name}
              </Badge>
            </Link>
          ))
        )}
      </div>
      {runsOn
        .filter((c) => c.rollouts && c.rollouts.length > 1)
        .map((c) => (
          <div key={c.channel_id} className="max-w-md space-y-1">
            <p className="text-xs text-muted-foreground">{c.name} splits its traffic:</p>
            <RolloutBar rollouts={c.rollouts!} workflow={workflow.workflow_id} />
          </div>
        ))}
    </div>
  )
}

function StoredDefinitionView({ digest }: { digest: string }) {
  const { data, isLoading, error } = useDefinition(digest)
  if (isLoading) return <Skeleton className="h-40 w-full" />
  if (error || !data) return <ErrorState title="Could not read the workflow definition" error={error} />
  return <JsonViewer data={data.definition} label="Workflow definition" maxHeight="40rem" />
}

/**
 * Run the deployed definition — or an edited copy that is never saved — once
 * on this node's engine with a payload. The run is live: functions, plugins
 * and connections reach real backends, which is why the server counts it as
 * a mutation and a read-only key is refused.
 */
function TestPanel({ workflow, sampleChannel }: { workflow: Workflow; sampleChannel: Channel | undefined }) {
  const stored = useDefinition(workflow.digest)
  const test = useTestDefinition()
  const canMutate = useCanMutate()
  const lastTrace = useLastTraceInput(sampleChannel?.name)
  // The catalogue completes function names and their inputs in an edited copy.
  const { data: functions } = useFunctions()
  const completions = useMemo(() => [stepCompletions(() => functions ?? [])], [functions])
  // Seeded from what this browser last ran here, so a payload survives a
  // reload and a page change; saved again on every run.
  const [payload, setPayload] = useState(() => readStorage(dryRunKey(workflow.workflow_id)) ?? EMPTY_PAYLOAD)
  // null: test what is deployed. A string: a scratch copy, edited here only.
  const [draft, setDraft] = useState<string | null>(null)
  const [result, setResult] = useState<TestDefinitionResponse | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const steps = useMemo(() => executionTrace(result ? { task_trace_json: result.trace } : null)?.steps ?? [], [result])

  const deployed = stored.data?.definition
  const parsedDraft = useMemo(() => {
    if (draft == null) return null
    try {
      return { ok: true as const, value: JSON.parse(draft) as unknown }
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : "Invalid JSON" }
    }
  }, [draft])

  const run = () => {
    setLocalError(null)
    setResult(null)
    let data: unknown
    try {
      data = JSON.parse(payload)
    } catch {
      setLocalError("The payload is not valid JSON")
      return
    }
    if (parsedDraft && !parsedDraft.ok) {
      setLocalError(`The edited definition is not valid JSON: ${parsedDraft.message}`)
      return
    }
    const definition = (parsedDraft?.ok ? parsedDraft.value : deployed) as Record<string, unknown> | undefined
    if (!definition) return
    writeStorage(dryRunKey(workflow.workflow_id), payload)
    test.mutate({ definition, data }, { onSuccess: setResult })
  }

  const fillFromLastTrace = async () => {
    const p = await lastTrace.load()
    if (!p) return
    setPayload(JSON.stringify(p, null, 2))
    setLocalError(null)
  }

  const blocked = !canMutate ? READ_ONLY_REASON : !deployed ? "The definition is still loading" : undefined

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Input</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <JsonEditor value={payload} onChange={setPayload} height="14rem" aria-label="Test payload" onRun={run} />
          <p className="text-xs text-muted-foreground">
            <kbd className="rounded border bg-muted px-1 font-mono">⌘</kbd>{" "}
            <kbd className="rounded border bg-muted px-1 font-mono">↵</kbd> runs · the payload is remembered for this
            workflow in this browser. The run is live: its tasks reach real backends.
          </p>

          {draft == null ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!deployed}
              onClick={() => setDraft(stableJson(deployed))}
              title="Edit a copy of the definition and test that instead. Nothing is saved or deployed."
            >
              <Pencil className="h-3.5 w-3.5" /> Test an edited copy
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Edited copy — never saved</p>
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Test the deployed one
                </Button>
              </div>
              <JsonEditor
                value={draft}
                onChange={setDraft}
                height="18rem"
                aria-label="Edited definition"
                completions={completions}
                onRun={run}
              />
              {parsedDraft?.ok && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">What the copy changes</summary>
                  <div className="mt-2">
                    <JsonDiff before={deployed} after={parsedDraft.value} />
                  </div>
                </details>
              )}
              <p className="text-xs text-muted-foreground">
                To ship a change, edit the definition in its repository and apply it with{" "}
                <code className="font-mono">orion-cli deployments apply</code>.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={run} disabled={test.isPending || !!blocked} className="flex-1" title={blocked}>
              <Play className="h-4 w-4" />
              {test.isPending ? "Running..." : draft == null ? `Run revision ${workflow.revision}` : "Run the edited copy"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void fillFromLastTrace()}
              disabled={!lastTrace.lastTraceId || lastTrace.loading}
              title={
                !sampleChannel
                  ? "No channel runs this workflow, so there is no trace to borrow from"
                  : !lastTrace.lastTraceId
                    ? `No trace has run through ${sampleChannel.name} yet`
                    : `The newest trace through ${sampleChannel.name}, as its first task saw it`
              }
            >
              <History className="h-4 w-4" />
              {lastTrace.loading ? "Loading…" : "Use last trace's input"}
            </Button>
          </div>
          {!canMutate && <p className="text-xs text-muted-foreground">{READ_ONLY_REASON}</p>}
          {localError && <Callout variant="destructive">{localError}</Callout>}
          {test.error && <Callout variant="destructive">{describeError(test.error)}</Callout>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Result</CardTitle>
        </CardHeader>
        <CardContent>
          {result ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant={result.matched ? "success" : "secondary"}>{result.matched ? "Matched" : "No Match"}</Badge>
                {result.errors.length > 0 && (
                  <Badge variant="destructive">
                    {result.errors.length} error{result.errors.length !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              {result.error && <Callout variant="warning">The run stopped short: {result.error}</Callout>}

              {steps.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Trace Steps</h4>
                  {steps.map((step, i) => {
                    const r = typeof step.result === "string" ? step.result.toLowerCase() : undefined
                    return (
                      <div key={i} className="flex items-center justify-between rounded border px-3 py-2">
                        <div className="flex items-center gap-2">
                          {r && (
                            <Badge variant="outline" className={stepResultBadgeClass(r)}>
                              {r}
                            </Badge>
                          )}
                          <span className="text-sm font-medium">{step.task_name ?? step.task_id}</span>
                          {step.function && <span className="font-mono text-xs text-muted-foreground">{step.function}</span>}
                        </div>
                        {step.duration_ms !== undefined && (
                          <span className="text-xs text-muted-foreground">{step.duration_ms}ms</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {result.errors.length > 0 && <JsonViewer data={result.errors} label="Errors" maxHeight="12rem" />}
              <JsonViewer data={result.output} label="Output" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Run a test to see the results here.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
