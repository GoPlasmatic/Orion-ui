import { useState } from "react"
import { useParams, Link, useNavigate } from "react-router"
import {
  useWorkflow,
  useWorkflowVersions,
  useChangeWorkflowStatus,
  useCreateWorkflowVersion,
  useDeleteWorkflow,
  useTestWorkflow,
} from "@/hooks/use-workflows"
import { WorkflowVisualizer } from "@goplasmatic/dataflow-ui"
import { toVisualizerWorkflow } from "@/lib/workflow-mapper"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { StatusBadge } from "@/components/shared/status-badge"
import { LifecycleActions } from "@/components/shared/lifecycle-actions"
import { VersionHistory } from "@/components/shared/version-history"
import { VersionCompare } from "@/components/shared/version-compare"
import { RolloutControl } from "@/components/shared/rollout-control"
import { JsonViewer } from "@/components/shared/json-viewer"
import { RelationshipGraph } from "@/components/graph/relationship-graph"
import { stepResultBadgeClass } from "@/lib/status"
import { ArrowLeft, AlertCircle, Play } from "lucide-react"
import type { WorkflowTestResponse } from "@/api/types"

export function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: workflow, isLoading, error } = useWorkflow(id ?? "")
  const { data: versions, isLoading: versionsLoading } = useWorkflowVersions(id ?? "")
  const changeStatus = useChangeWorkflowStatus()
  const createVersion = useCreateWorkflowVersion()
  const deleteWorkflow = useDeleteWorkflow()
  const testWorkflow = useTestWorkflow()

  const [testPayload, setTestPayload] = useState('{\n  \n}')
  const [testResult, setTestResult] = useState<WorkflowTestResponse | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

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
            {workflow.status !== "active" &&
              workflow.rollout_percentage !== undefined &&
              workflow.rollout_percentage !== null && (
                <span className="text-sm text-muted-foreground">
                  Rollout: {workflow.rollout_percentage}%
                </span>
              )}
            <span className="text-sm text-muted-foreground">
              {workflow.tasks?.length ?? 0} tasks
            </span>
          </div>
        </div>
        <LifecycleActions
          status={workflow.status}
          isPending={isPending}
          onActivate={() => changeStatus.mutate({ id: workflow.workflow_id, req: { status: "active" } })}
          onArchive={() => changeStatus.mutate({ id: workflow.workflow_id, req: { status: "archived" } })}
          onNewVersion={() => createVersion.mutate(workflow.workflow_id)}
          onDelete={() => deleteWorkflow.mutate(workflow.workflow_id, { onSuccess: () => navigate("/workflows") })}
        />
      </div>

      {workflow.status === "active" && (
        <RolloutControl workflowId={workflow.workflow_id} current={workflow.rollout_percentage} />
      )}

      <Tabs defaultValue="visualization">
        <TabsList>
          <TabsTrigger value="visualization">Visualization</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="test">Dry Run</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>

        <TabsContent value="visualization">
          <div className="h-[calc(100dvh-18rem)] min-h-[600px] rounded-lg border">
            <WorkflowVisualizer
              workflows={[toVisualizerWorkflow(workflow)]}
            />
          </div>
        </TabsContent>

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
                  <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
                      <Badge variant={testResult.matched ? "default" : "secondary"} className={testResult.matched ? "bg-emerald-500" : ""}>
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
