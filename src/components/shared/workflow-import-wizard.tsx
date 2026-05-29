import { useMemo, useState } from "react"
import { Link } from "react-router"
import { DataLogicEditor } from "@goplasmatic/datalogic-ui"
import {
  useValidateWorkflow,
  useImportWorkflows,
  useTestWorkflow,
  useChangeWorkflowStatus,
  useSetWorkflowRollout,
} from "@/hooks/use-workflows"
import type { JsonLogicValue, ValidationResponse, WorkflowTestResponse } from "@/api/types"
import { useTheme } from "@/lib/use-theme"
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { stepResultBadgeClass } from "@/lib/status"
import { AlertCircle, CheckCircle2, Play } from "lucide-react"

const STEPS = ["Paste", "Validate", "Import", "Dry run", "Activate"] as const
type StepIndex = 0 | 1 | 2 | 3 | 4

interface WorkflowImportWizardProps {
  open: boolean
  onClose: () => void
}

/**
 * Guided workflow import: paste → validate → import (as draft) → dry-run → activate
 * with a rollout %. The dry-run and activate steps target the definition's
 * `workflow_id` (the test/status endpoints are id-scoped, and `import` returns only
 * counts); if the pasted definition omits an id, those steps are skipped with a note.
 */
export function WorkflowImportWizard({ open, onClose }: WorkflowImportWizardProps) {
  const { resolvedTheme } = useTheme()
  const validate = useValidateWorkflow()
  const importWorkflows = useImportWorkflows()
  const testWorkflow = useTestWorkflow()
  const changeStatus = useChangeWorkflowStatus()
  const setRollout = useSetWorkflowRollout()

  const [step, setStep] = useState<StepIndex>(0)
  const [text, setText] = useState("")
  const [parseError, setParseError] = useState<string | null>(null)
  const [validation, setValidation] = useState<ValidationResponse | null>(null)
  const [imported, setImported] = useState(false)

  const [testPayload, setTestPayload] = useState("{\n  \n}")
  const [testResult, setTestResult] = useState<WorkflowTestResponse | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const [rollout, setRolloutValue] = useState(100)
  const [activated, setActivated] = useState(false)

  const parsed = useMemo(() => {
    try {
      const json = JSON.parse(text)
      const items = Array.isArray(json) ? json : [json]
      const primary =
        items[0] && typeof items[0] === "object" && !Array.isArray(items[0])
          ? (items[0] as Record<string, unknown>)
          : null
      return { items, primary }
    } catch {
      return null
    }
  }, [text])

  const workflowId =
    parsed?.primary && typeof parsed.primary.workflow_id === "string"
      ? parsed.primary.workflow_id
      : null
  const condition = parsed?.primary?.condition as JsonLogicValue | undefined

  const reset = () => {
    setStep(0)
    setText("")
    setParseError(null)
    setValidation(null)
    setImported(false)
    setTestResult(null)
    setTestError(null)
    setActivated(false)
    setRolloutValue(100)
  }

  const close = () => {
    reset()
    onClose()
  }

  const goValidate = () => {
    setParseError(null)
    if (!parsed) {
      setParseError("Invalid JSON")
      return
    }
    if (!parsed.primary) {
      setParseError("Expected a workflow object (or an array of them)")
      return
    }
    validate.mutate(parsed.primary, {
      onSuccess: (res) => {
        setValidation(res)
        setStep(1)
      },
      onError: () => setStep(1),
    })
  }

  const doImport = () => {
    if (!parsed) return
    importWorkflows.mutate(
      { items: parsed.items, dryRun: false },
      {
        onSuccess: (res) => {
          if (res.imported > 0 || res.failed === 0) {
            setImported(true)
            setStep(3)
          }
        },
      }
    )
  }

  const runTest = () => {
    if (!workflowId) return
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
      { id: workflowId, req: { data } },
      {
        onSuccess: setTestResult,
        onError: (e) => setTestError(e instanceof Error ? e.message : "Test failed"),
      }
    )
  }

  const activate = () => {
    if (!workflowId) return
    changeStatus.mutate(
      { id: workflowId, req: { status: "active" } },
      {
        onSuccess: () => {
          setRollout.mutate({ id: workflowId, req: { rollout_percentage: rollout } })
          setActivated(true)
        },
      }
    )
  }

  return (
    <Dialog open={open} onClose={close} className="max-w-3xl" aria-label="Import workflow">
      <DialogHeader>
        <DialogTitle>Import workflow</DialogTitle>
        <ol className="mt-2 flex flex-wrap gap-2 text-xs">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                i === step
                  ? "border-primary bg-primary/10 text-primary"
                  : i < step
                    ? "border-chart-2/40 text-chart-2"
                    : "text-muted-foreground"
              )}
            >
              <span className="font-mono">{i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      </DialogHeader>

      <DialogBody>
        {step === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Paste a workflow definition (often AI-generated) as JSON. A single object or an
              array is accepted.
            </p>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={16}
              className="font-mono text-sm"
              placeholder='{ "workflow_id": "my-workflow", "name": "My Workflow", "tasks": [] }'
            />
            {parseError && <p className="text-xs text-destructive">{parseError}</p>}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            {validation ? (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md border p-3 text-sm",
                  validation.valid
                    ? "border-chart-2/40 text-chart-2"
                    : "border-destructive/40 text-destructive"
                )}
              >
                {validation.valid ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                {validation.valid ? "Definition is valid" : "Definition has errors"}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Validating…</p>
            )}

            {validation && validation.errors.length > 0 && (
              <IssueList title="Errors" issues={validation.errors} tone="error" />
            )}
            {validation && validation.warnings.length > 0 && (
              <IssueList title="Warnings" issues={validation.warnings} tone="warning" />
            )}

            {condition !== undefined && condition !== null && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Trigger condition</p>
                <div className="h-56 overflow-hidden rounded-md border">
                  <DataLogicEditor value={condition} editable={false} theme={resolvedTheme} />
                </div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Import the definition as a <strong>draft</strong>. It won't receive traffic until
              you activate it.
            </p>
            {importWorkflows.data && (
              <div className="flex flex-wrap gap-2 rounded-md border p-3 text-sm">
                <Badge variant="outline" className="border-chart-2/40 text-chart-2">
                  {importWorkflows.data.imported} imported
                </Badge>
                {importWorkflows.data.failed > 0 && (
                  <Badge variant="destructive">{importWorkflows.data.failed} failed</Badge>
                )}
              </div>
            )}
            {importWorkflows.data?.errors?.length ? (
              <ul className="space-y-1 text-xs">
                {importWorkflows.data.errors.map((e) => (
                  <li key={e.index} className="font-mono text-destructive">
                    [{e.index}] {e.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            {workflowId ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Dry-run the imported draft <span className="font-mono">{workflowId}</span> against a
                  sample payload (no side effects).
                </p>
                <Textarea
                  value={testPayload}
                  onChange={(e) => setTestPayload(e.target.value)}
                  rows={8}
                  className="font-mono text-sm"
                />
                <Button onClick={runTest} disabled={testWorkflow.isPending} variant="outline">
                  <Play className="h-4 w-4" />
                  {testWorkflow.isPending ? "Running…" : "Run dry-run"}
                </Button>
                {testError && <p className="text-xs text-destructive">{testError}</p>}
                {testResult && (
                  <div className="space-y-2 rounded-md border p-3">
                    <Badge variant="outline" className={stepResultBadgeClass(testResult.matched ? "executed" : "skipped")}>
                      {testResult.matched ? "Matched" : "No match"}
                    </Badge>
                    {testResult.trace?.steps?.map((s, i) => {
                      const r = typeof s.result === "string" ? s.result.toLowerCase() : undefined
                      return (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          {r && (
                            <Badge variant="outline" className={stepResultBadgeClass(r)}>
                              {r}
                            </Badge>
                          )}
                          <span>{s.task_name ?? s.task_id}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                The definition has no <span className="font-mono">workflow_id</span>, so the
                dry-run step is skipped. You can dry-run it from the workflow's detail page after
                import.
              </p>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            {activated ? (
              <div className="flex items-center gap-2 rounded-md border border-chart-2/40 p-3 text-sm text-chart-2">
                <CheckCircle2 className="h-4 w-4" /> Activated at {rollout}% rollout.
              </div>
            ) : workflowId ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Activate the workflow and choose how much matching traffic it should receive.
                </p>
                <div className="flex items-center gap-4">
                  <Slider value={rollout} onValueChange={setRolloutValue} className="flex-1" />
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={rollout}
                      onChange={(e) =>
                        setRolloutValue(Math.max(0, Math.min(100, Number(e.target.value))))
                      }
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
                <Button onClick={activate} disabled={changeStatus.isPending}>
                  {changeStatus.isPending ? "Activating…" : `Activate at ${rollout}%`}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No <span className="font-mono">workflow_id</span> in the definition — activate it
                from the workflow's detail page.
              </p>
            )}
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="outline" onClick={close}>
          {activated ? "Done" : "Cancel"}
        </Button>
        {step > 0 && !activated && (
          <Button variant="outline" onClick={() => setStep((s) => (s - 1) as StepIndex)}>
            Back
          </Button>
        )}
        {step === 0 && (
          <Button onClick={goValidate} disabled={!text.trim() || validate.isPending}>
            {validate.isPending ? "Validating…" : "Validate"}
          </Button>
        )}
        {step === 1 && (
          <Button onClick={() => setStep(2)} disabled={!!validation && !validation.valid}>
            Next
          </Button>
        )}
        {step === 2 &&
          (imported ? (
            <Button onClick={() => setStep(3)}>Next</Button>
          ) : (
            <Button onClick={doImport} disabled={importWorkflows.isPending}>
              {importWorkflows.isPending ? "Importing…" : "Import as draft"}
            </Button>
          ))}
        {step === 3 && (
          <Button onClick={() => setStep(4)}>{workflowId ? "Next" : "Skip"}</Button>
        )}
        {step === 4 && activated && (
          <Button asChild>
            <Link to="/workflows" onClick={close}>
              View workflows
            </Link>
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}

function IssueList({
  title,
  issues,
  tone,
}: {
  title: string
  issues: { field: string; message: string }[]
  tone: "error" | "warning"
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{title}</p>
      <ul className="space-y-1 text-xs">
        {issues.map((issue, i) => (
          <li
            key={i}
            className={cn(tone === "error" ? "text-destructive" : "text-chart-3")}
          >
            <span className="font-mono">{issue.field || "—"}</span>: {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
