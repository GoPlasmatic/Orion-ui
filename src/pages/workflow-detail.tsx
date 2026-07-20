import { useState } from "react"
import { useParams, Link, useNavigate } from "react-router"
import {
  useWorkflow,
  useWorkflowVersions,
  useChangeWorkflowStatus,
  useCreateWorkflowVersion,
  useDeleteWorkflow,
  useSetWorkflowRollout,
  useTestWorkflow,
} from "@/hooks/use-workflows"
import { WorkflowVisualizer } from "@goplasmatic/dataflow-ui"
import { toVisualizerWorkflow } from "@/lib/workflow-mapper"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { StatusBadge } from "@/components/shared/status-badge"
import { LifecycleActions } from "@/components/shared/lifecycle-actions"
import { VersionHistory } from "@/components/shared/version-history"
import { VersionCompare } from "@/components/shared/version-compare"
import { JsonViewer } from "@/components/shared/json-viewer"
import { RelationshipGraph } from "@/components/graph/relationship-graph"
import { stepResultBadgeClass } from "@/lib/status"
import { ArrowLeft, AlertCircle, Pencil, Percent, Play } from "lucide-react"
import type { WorkflowTestResponse } from "@/api/types"

export function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: workflow, isLoading, error } = useWorkflow(id ?? "")
  const { data: versions, isLoading: versionsLoading } = useWorkflowVersions(id ?? "")
  const changeStatus = useChangeWorkflowStatus()
  const createVersion = useCreateWorkflowVersion()
  const deleteWorkflow = useDeleteWorkflow()
  const setRollout = useSetWorkflowRollout()
  const testWorkflow = useTestWorkflow()

  const [testPayload, setTestPayload] = useState('{\n  \n}')
  const [testResult, setTestResult] = useState<WorkflowTestResponse | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [rolloutDraft, setRolloutDraft] = useState<number | null>(null)

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
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link to="/workflows"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Workflows</Link>
        </Button>
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>Failed to load workflow.</p>
        </div>
      </div>
    )
  }

  const isPending = changeStatus.isPending || createVersion.isPending || deleteWorkflow.isPending

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

    testWorkflow.mutate(
      { id: workflow.workflow_id, req: { data } },
      {
        onSuccess: (result) => setTestResult(result),
        onError: (err) => setTestError(err instanceof Error ? err.message : "Test failed"),
      }
    )
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild>
        <Link to="/workflows"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Workflows</Link>
      </Button>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{workflow.name}</h1>
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
              {workflow.tasks?.length ?? 0} tasks
            </span>
            {workflow.status === "active" && (
              <Badge variant="outline" className="text-xs">
                <Percent className="mr-1 h-3 w-3" />
                {workflow.rollout_percentage ?? 100}% rollout
              </Badge>
            )}
          </div>
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

      {/* Diagram is the primary content of the page. */}
      <div className="h-[calc(100dvh-19rem)] min-h-[520px] overflow-hidden rounded-lg border">
        <WorkflowVisualizer workflows={[toVisualizerWorkflow(workflow)]} />
      </div>

      <Tabs defaultValue="relationships">
        <TabsList>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="test">Dry Run</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>

        <TabsContent value="relationships">
          <RelationshipGraph kind="workflow" id={workflow.workflow_id} />
        </TabsContent>

        <TabsContent value="test">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Test Payload</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={testPayload}
                  onChange={(e) => setTestPayload(e.target.value)}
                  rows={12}
                  className="font-mono text-sm"
                  placeholder='{ "key": "value" }'
                />
                <Button
                  onClick={handleTest}
                  disabled={testWorkflow.isPending}
                  className="w-full"
                >
                  <Play className="h-4 w-4" />
                  {testWorkflow.isPending ? "Running..." : "Run Test"}
                </Button>

                {testError && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {testError}
                  </div>
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
                      <Badge variant={testResult.matched ? "default" : "secondary"} className={testResult.matched ? "bg-chart-2 text-white" : ""}>
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
