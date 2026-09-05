import { useMemo, useState } from "react"
import { useParams, Link, useNavigate } from "react-router"
import { useChannels } from "@/hooks/use-channels"
import { useLastTraceInput } from "@/hooks/use-last-trace-input"
import { readStorage, writeStorage } from "@/lib/storage"
import {
  useWorkflow,
  useWorkflowVersions,
  useChangeWorkflowStatus,
  useCreateWorkflowVersion,
  useDeleteWorkflow,
  useSetWorkflowRollout,
  useTestWorkflow,
  useWorkflowStatusDryRun,
} from "@/hooks/use-workflows"
import { WorkflowVisualizer } from "@goplasmatic/dataflow-ui"
import { toVisualizerWorkflow } from "@/lib/workflow-mapper"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { JsonEditor } from "@/components/shared/json-editor"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Callout } from "@/components/ui/callout"
import { StatusBadge } from "@/components/shared/status-badge"
import { LifecycleActions } from "@/components/shared/lifecycle-actions"
import { VersionHistory } from "@/components/shared/version-history"
import { VersionCompare } from "@/components/shared/version-compare"
import { JsonViewer } from "@/components/shared/json-viewer"
import { NeighbourhoodMap } from "@/components/graph/neighbourhood-map"
import { WorkflowDependencies } from "@/components/shared/workflow-dependencies"
import { ErrorState } from "@/components/shared/error-state"
import { Breadcrumbs } from "@/components/shared/breadcrumbs"
import { stepResultBadgeClass } from "@/lib/status"
import { ChevronDown, ChevronUp, CircleStop, History, Layers, OctagonX, Pencil, Percent, Play, Radio } from "lucide-react"
import { countGroups, countHaltOnFailure, countLeafSteps, countTerminal } from "@/lib/workflow-steps"
import type { WorkflowTestResponse } from "@/api/types"

/** The last dry-run payload, per workflow, in this browser only. */
const dryRunKey = (id: string) => `orion-dryrun-${id}`
/** Whether the diagram is folded away — a laptop screen preference, per browser. */
const DIAGRAM_KEY = "orion-workflow-diagram"
const EMPTY_PAYLOAD = "{\n  \n}"


export function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: workflow, isLoading, error, refetch } = useWorkflow(id ?? "")
  const statusDryRun = useWorkflowStatusDryRun()
  const { data: versions, isLoading: versionsLoading } = useWorkflowVersions(id ?? "")
  const changeStatus = useChangeWorkflowStatus()
  const createVersion = useCreateWorkflowVersion()
  const deleteWorkflow = useDeleteWorkflow()
  const setRollout = useSetWorkflowRollout()
  const testWorkflow = useTestWorkflow()
  // Which channels run it. An active workflow bound to nothing is dead weight,
  // and the page never said so.
  const { data: channelList } = useChannels({ limit: 1000 })
  const runsOn = useMemo(
    () => (channelList?.data ?? []).filter((c) => c.workflow_id === id),
    [channelList?.data, id],
  )
  // The newest trace through a channel that runs this workflow — the input a
  // dry run most plausibly wants.
  const sampleChannel = runsOn.find((c) => c.status === "active") ?? runsOn[0]
  const lastTrace = useLastTraceInput(sampleChannel?.name)

  // Seeded from what this browser last ran here, so a payload survives a
  // reload and a page change; saved again on every run.
  const [testPayload, setTestPayload] = useState(() => readStorage(dryRunKey(id ?? "")) ?? EMPTY_PAYLOAD)
  const [testResult, setTestResult] = useState<WorkflowTestResponse | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [rolloutDraft, setRolloutDraft] = useState<number | null>(null)
  const [diagramHidden, setDiagramHidden] = useState(() => readStorage(DIAGRAM_KEY) === "hidden")

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
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

  const isPending = changeStatus.isPending || createVersion.isPending || deleteWorkflow.isPending

  // Orion 1.2 / dataflow-rs 3.6: a `tasks` element carrying its own `tasks` key
  // is a task group, so the array length is not the number of tasks that run.
  const taskCount = countLeafSteps(workflow.tasks)
  const groupCount = countGroups(workflow.tasks)
  const terminalCount = countTerminal(workflow.tasks)
  const haltCount = countHaltOnFailure(workflow.tasks)

  const toggleDiagram = () => {
    const next = !diagramHidden
    setDiagramHidden(next)
    writeStorage(DIAGRAM_KEY, next ? "hidden" : "shown")
  }

  const handleTest = () => {
    setTestError(null)
    setTestResult(null)

    let data: Record<string, unknown>
    try {
      data = JSON.parse(testPayload)
    } catch {
      setTestError("Invalid JSON payload")
      return
    }
    writeStorage(dryRunKey(workflow.workflow_id), testPayload)

    testWorkflow.mutate(
      { id: workflow.workflow_id, req: { data } },
      {
        onSuccess: (result) => setTestResult(result),
        onError: (err) => setTestError(err instanceof Error ? err.message : "Test failed"),
      }
    )
  }

  /** Fill the editor with the last trace's input, as its first task saw it. */
  const fillFromLastTrace = async () => {
    const payload = await lastTrace.load()
    if (!payload) return
    setTestPayload(JSON.stringify(payload, null, 2))
    setTestError(null)
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Workflows", to: "/workflows" }, { label: workflow.name }]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 break-words text-2xl font-bold">{workflow.name}</h1>
            <StatusBadge status={workflow.status} />
            <Badge variant="outline">v{workflow.version}</Badge>
          </div>
          <div className="mt-2 flex items-center gap-3">
            {workflow.tags?.length > 0 && (
              <div className="flex gap-1">
                {workflow.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
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
              <Badge variant="outline" className="text-xs" title="Tasks that end the workflow when they fail (halt_on: failure)">
                <OctagonX className="mr-1 h-3 w-3" />
                {haltCount} halt on failure
              </Badge>
            )}
            {workflow.status === "active" && (
              <Badge variant="outline" className="text-xs">
                <Percent className="mr-1 h-3 w-3" />
                {workflow.rollout_percentage ?? 100}% rollout
              </Badge>
            )}
          </div>
          {channelList && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
              <Radio className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Runs on</span>
              {runsOn.length === 0 ? (
                <span className={workflow.status === "active" ? "text-warning" : "text-muted-foreground"}>
                  no channel{workflow.status === "active" ? " — nothing reaches this workflow" : " yet"}
                </span>
              ) : (
                runsOn.map((c) => (
                  <Link key={c.channel_id} to={`/channels/${c.channel_id}`}>
                    <Badge variant="outline" className="transition-colors hover:bg-accent">
                      {c.name}
                      {c.status !== "active" && <span className="text-muted-foreground"> · {c.status}</span>}
                    </Badge>
                  </Link>
                ))
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {workflow.status === "draft" && (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/workflows/${workflow.workflow_id}/edit`}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Link>
            </Button>
          )}
          <LifecycleActions
            onPreflight={() =>
              statusDryRun.mutate({ id: workflow.workflow_id, req: { status: "active" } })
            }
            preflight={statusDryRun.data ?? null}
            preflightPending={statusDryRun.isPending}
            status={workflow.status}
            isPending={isPending}
            onActivate={() => changeStatus.mutate({ id: workflow.workflow_id, req: { status: "active" } })}
            onArchive={() => changeStatus.mutate({ id: workflow.workflow_id, req: { status: "archived" } })}
            onNewVersion={() => createVersion.mutate(workflow.workflow_id)}
            onDelete={() => deleteWorkflow.mutate(workflow.workflow_id, { onSuccess: () => navigate("/workflows") })}
          />
        </div>
      </div>

      {workflow.status === "active" && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 py-4">
            <div className="min-w-40">
              <p className="text-sm font-medium">Canary rollout</p>
              <p className="text-xs text-muted-foreground">
                Share of matching traffic this workflow handles.
              </p>
            </div>
            <div className="flex min-w-64 flex-1 items-center gap-3">
              <Slider
                value={rolloutDraft ?? workflow.rollout_percentage ?? 100}
                onValueChange={setRolloutDraft}
                min={0}
                max={100}
                step={5}
                aria-label="Rollout percentage"
              />
              <span className="w-12 text-right font-mono text-sm">
                {rolloutDraft ?? workflow.rollout_percentage ?? 100}%
              </span>
            </div>
            <Button
              size="sm"
              disabled={
                setRollout.isPending ||
                rolloutDraft === null ||
                rolloutDraft === (workflow.rollout_percentage ?? 100)
              }
              onClick={() =>
                setRollout.mutate(
                  {
                    id: workflow.workflow_id,
                    req: { rollout_percentage: rolloutDraft ?? 100 },
                  },
                  { onSuccess: () => setRolloutDraft(null) }
                )
              }
            >
              {setRollout.isPending ? "Applying..." : "Apply"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Diagram is the primary content of the page — but on a laptop it is
          the whole first screen, so it folds away and the choice is remembered. */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {diagramHidden ? "Diagram hidden" : `Pipeline · ${taskCount} ${taskCount === 1 ? "task" : "tasks"}`}
        </span>
        <Button variant="ghost" size="sm" onClick={toggleDiagram} aria-expanded={!diagramHidden}>
          {diagramHidden ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          {diagramHidden ? "Show diagram" : "Hide diagram"}
        </Button>
      </div>
      {!diagramHidden && (
        <div className="h-[calc(100dvh-19rem)] min-h-[520px] overflow-hidden rounded-lg border">
          <WorkflowVisualizer workflows={[toVisualizerWorkflow(workflow)]} />
        </div>
      )}

      <Tabs defaultValue="relationships">
        <TabsList>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
          <TabsTrigger value="test">Dry Run</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>

        <TabsContent value="relationships">
          <NeighbourhoodMap kind="workflow" id={workflow.workflow_id} />
        </TabsContent>

        <TabsContent value="dependencies">
          <WorkflowDependencies workflowId={workflow.workflow_id} />
        </TabsContent>

        <TabsContent value="test">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Test Payload</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <JsonEditor
                  value={testPayload}
                  onChange={setTestPayload}
                  height="18rem"
                  aria-label="Test payload"
                  onRun={handleTest}
                />
                <p className="text-xs text-muted-foreground">
                  <kbd className="rounded border bg-muted px-1 font-mono">⌘</kbd>{" "}
                  <kbd className="rounded border bg-muted px-1 font-mono">↵</kbd> runs · the payload
                  is remembered for this workflow in this browser.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={handleTest}
                    disabled={testWorkflow.isPending}
                    className="flex-1"
                  >
                    <Play className="h-4 w-4" />
                    {testWorkflow.isPending ? "Running..." : "Run Test"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void fillFromLastTrace()}
                    disabled={!lastTrace.lastTraceId || lastTrace.loading}
                    title={
                      !sampleChannel
                        ? "No channel runs this workflow yet, so there is no trace to borrow from"
                        : !lastTrace.lastTraceId
                          ? `No trace has run through ${sampleChannel.name} yet`
                          : `The newest trace through ${sampleChannel.name}, as its first task saw it`
                    }
                  >
                    <History className="h-4 w-4" />
                    {lastTrace.loading ? "Loading…" : "Use last trace's input"}
                  </Button>
                </div>

                {testError && (
                  <Callout variant="destructive">
                    {testError}
                  </Callout>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Result</CardTitle>
              </CardHeader>
              <CardContent>
                {testResult ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Badge variant={testResult.matched ? "success" : "secondary"}>
                        {testResult.matched ? "Matched" : "No Match"}
                      </Badge>
                      {testResult.errors.length > 0 && (
                        <Badge variant="destructive">
                          {testResult.errors.length} error{testResult.errors.length !== 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>

                    {testResult.trace?.steps && testResult.trace.steps.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium">Trace Steps</h4>
                        {testResult.trace.steps.map((step, i) => {
                          const result = typeof step.result === "string" ? step.result.toLowerCase() : undefined
                          return (
                            <div key={i} className="flex items-center justify-between rounded border px-3 py-2">
                              <div className="flex items-center gap-2">
                                {result && (
                                  <Badge variant="outline" className={stepResultBadgeClass(result)}>
                                    {result}
                                  </Badge>
                                )}
                                <span className="text-sm font-medium">{step.task_name ?? step.task_id}</span>
                                {step.function && (
                                  <span className="text-xs text-muted-foreground font-mono">{step.function}</span>
                                )}
                              </div>
                              {step.duration_ms !== undefined && (
                                <span className="text-xs text-muted-foreground">{step.duration_ms}ms</span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {testResult.errors.length > 0 && (
                      <JsonViewer data={testResult.errors} label="Errors" maxHeight="12rem" />
                    )}

                    <JsonViewer data={testResult.output} label="Output" />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Run a test to see the results here.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
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

        <TabsContent value="json">
          <JsonViewer data={workflow} label="Workflow Definition" maxHeight="40rem" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
