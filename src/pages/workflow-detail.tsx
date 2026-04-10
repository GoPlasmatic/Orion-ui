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
import { JsonViewer } from "@/components/shared/json-viewer"
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
            {workflow.rollout_percentage !== undefined && workflow.rollout_percentage !== null && (
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

      <Tabs defaultValue="visualization">
        <TabsList>
          <TabsTrigger value="visualization">Visualization</TabsTrigger>
          <TabsTrigger value="test">Dry Run</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>

        <TabsContent value="visualization">
          <div className="rounded-lg border" style={{ height: "600px" }}>
            <WorkflowVisualizer
              workflows={[toVisualizerWorkflow(workflow)]}
            />
          </div>
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
                      <Badge variant={testResult.success ? "default" : "destructive"} className={testResult.success ? "bg-emerald-500" : ""}>
                        {testResult.success ? "Passed" : "Failed"}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{testResult.duration_ms}ms</span>
                    </div>

                    {testResult.trace && testResult.trace.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium">Trace Steps</h4>
                        {testResult.trace.map((step) => (
                          <div key={step.task_id} className="flex items-center justify-between rounded border px-3 py-2">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={step.status === "executed" ? "default" : step.status === "skipped" ? "secondary" : "destructive"}
                                className={step.status === "executed" ? "bg-emerald-500" : ""}
                              >
                                {step.status}
                              </Badge>
                              <span className="text-sm font-medium">{step.task_name}</span>
                              <span className="text-xs text-muted-foreground font-mono">{step.function}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">{step.duration_ms}ms</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <JsonViewer data={testResult.result} label="Output" />
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
          <VersionHistory versions={versions} isLoading={versionsLoading} />
        </TabsContent>

        <TabsContent value="json">
          <JsonViewer data={workflow} label="Workflow Definition" maxHeight="40rem" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
