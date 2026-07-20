import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { DataLogicEditor } from "@goplasmatic/datalogic-ui"
import {
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
  useValidateWorkflow,
} from "@/hooks/use-workflows"
import type { JsonLogicValue, ValidationResponse, Workflow } from "@/api/types"
import { useTheme } from "@/lib/use-theme"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/shared/page-header"
import { ArrowLeft, Braces, CheckCircle2, Network, Plus, Save, ShieldCheck, Trash2 } from "lucide-react"

const SAMPLE_TASKS = `[
  {
    "id": "task-1",
    "name": "My first task",
    "function": {
      "name": "map",
      "input": { "mappings": [] }
    }
  }
]`

/**
 * Trigger-condition editor: visual JSONLogic canvas with a JSON escape hatch.
 * An absent condition is left absent (the server defaults it), so a workflow
 * created without one matches per the engine default rather than an explicit rule.
 */
function ConditionEditor({
  value,
  onChange,
}: {
  value: JsonLogicValue | undefined
  onChange: (next: JsonLogicValue | undefined) => void
}) {
  const { resolvedTheme } = useTheme()
  const [mode, setMode] = useState<"visual" | "json">("visual")
  const [jsonText, setJsonText] = useState("")
  const [jsonError, setJsonError] = useState<string | null>(null)

  const openJson = () => {
    setJsonText(JSON.stringify(value ?? null, null, 2))
    setJsonError(null)
    setMode("json")
  }

  const onJsonChange = (text: string) => {
    setJsonText(text)
    try {
      const parsed = JSON.parse(text)
      setJsonError(null)
      onChange(parsed === null ? undefined : (parsed as JsonLogicValue))
    } catch {
      setJsonError("Invalid JSON")
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium">Trigger condition</label>
          <p className="text-xs text-muted-foreground">
            JSONLogic over the incoming message; the workflow runs when it evaluates truthy.
            Leave unset to always match.
          </p>
        </div>
        <div className="flex gap-1 rounded-md border p-0.5">
          <Button
            type="button"
            variant={mode === "visual" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("visual")}
          >
            <Network className="h-3.5 w-3.5" /> Visual
          </Button>
          <Button
            type="button"
            variant={mode === "json" ? "secondary" : "ghost"}
            size="sm"
            onClick={openJson}
          >
            <Braces className="h-3.5 w-3.5" /> JSON
          </Button>
        </div>
      </div>

      {mode === "json" ? (
        <div>
          <Textarea
            value={jsonText}
            onChange={(e) => onJsonChange(e.target.value)}
            rows={8}
            className="font-mono text-sm"
            placeholder='{ "==": [{ "var": "metadata.type" }, "order"] }'
          />
          {jsonError && <p className="mt-1 text-xs text-destructive">{jsonError}</p>}
        </div>
      ) : value === undefined || value === null ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange({ "==": [{ var: "metadata.type" }, "example"] })}
        >
          <Plus className="h-3.5 w-3.5" /> Add condition
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="h-72 overflow-hidden rounded-md border">
            <DataLogicEditor
              value={value}
              editable
              onChange={(expr) => onChange((expr ?? undefined) as JsonLogicValue | undefined)}
              theme={resolvedTheme}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onChange(undefined)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove condition
          </Button>
        </div>
      )}
    </div>
  )
}

function ValidationResults({ result }: { result: ValidationResponse }) {
  if (result.valid && result.warnings.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-chart-2/40 bg-chart-2/10 px-4 py-3 text-sm text-chart-2">
        <CheckCircle2 className="h-4 w-4" /> Workflow is valid.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {result.errors.map((e, i) => (
        <div
          key={`e-${i}`}
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          <span className="font-mono text-xs">{e.field}</span> — {e.message}
        </div>
      ))}
      {result.warnings.map((w, i) => (
        <div
          key={`w-${i}`}
          className="rounded-md border border-chart-3/40 bg-chart-3/10 px-4 py-2 text-sm text-chart-3"
        >
          <span className="font-mono text-xs">{w.field}</span> — {w.message}
        </div>
      ))}
    </div>
  )
}

function WorkflowForm({ existing }: { existing?: Workflow }) {
  const isEdit = !!existing
  const navigate = useNavigate()
  const createWorkflow = useCreateWorkflow()
  const updateWorkflow = useUpdateWorkflow()
  const validateWorkflow = useValidateWorkflow()

  const [name, setName] = useState(existing?.name ?? "")
  const [description, setDescription] = useState(existing?.description ?? "")
  const [priority, setPriority] = useState(String(existing?.priority ?? 0))
  const [tags, setTags] = useState((existing?.tags ?? []).join(", "))
  const [continueOnError, setContinueOnError] = useState(existing?.continue_on_error ?? false)
  const [condition, setCondition] = useState<JsonLogicValue | undefined>(
    existing?.condition ?? undefined
  )
  const [tasksText, setTasksText] = useState(() =>
    existing ? JSON.stringify(existing.tasks ?? [], null, 2) : SAMPLE_TASKS
  )
  const [tasksError, setTasksError] = useState<string | null>(null)
  const [validation, setValidation] = useState<ValidationResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const backTo = existing ? `/workflows/${existing.workflow_id}` : "/workflows"
  const editLocked = existing ? existing.status !== "draft" : false

  const parseTasks = (): unknown[] | null => {
    try {
      const parsed = JSON.parse(tasksText)
      if (!Array.isArray(parsed)) {
        setTasksError("Tasks must be a JSON array")
        return null
      }
      setTasksError(null)
      return parsed
    } catch {
      setTasksError("Tasks are not valid JSON")
      return null
    }
  }

  const buildPayload = () => {
    if (!name.trim()) {
      setError("Name is required")
      return null
    }
    const tasks = parseTasks()
    if (!tasks) return null

    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)

    return {
      name,
      description: description || undefined,
      priority: Number(priority) || 0,
      condition,
      tasks,
      tags: tagList,
      continue_on_error: continueOnError,
    }
  }

  const handleValidate = () => {
    setError(null)
    setValidation(null)
    const payload = buildPayload()
    if (!payload) return
    validateWorkflow.mutate(payload, {
      onSuccess: setValidation,
      onError: (e) => setError(e instanceof Error ? e.message : "Validation failed"),
    })
  }

  const handleSubmit = () => {
    setError(null)
    const payload = buildPayload()
    if (!payload) return

    if (existing) {
      updateWorkflow.mutate(
        { id: existing.workflow_id, req: payload },
        {
          onSuccess: () => navigate(`/workflows/${existing.workflow_id}`),
          onError: (e) => setError(e instanceof Error ? e.message : "Update failed"),
        }
      )
    } else {
      createWorkflow.mutate(payload, {
        onSuccess: (w) => navigate(`/workflows/${w.workflow_id}`),
        onError: (e) => setError(e instanceof Error ? e.message : "Create failed"),
      })
    }
  }

  const isPending = createWorkflow.isPending || updateWorkflow.isPending

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild>
        <Link to={backTo}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Link>
      </Button>

      <PageHeader
        title={isEdit ? "Edit Workflow" : "Create Workflow"}
        description={
          isEdit
            ? "Edit this draft, then validate and activate it from the detail page"
            : "Author a task pipeline; it is saved as a draft until activated"
        }
      />

      {editLocked && (
        <div className="max-w-3xl rounded-md border border-chart-3/40 bg-chart-3/10 px-4 py-3 text-sm text-chart-3">
          Only drafts can be edited. Create a new version from the workflow detail page first.
        </div>
      )}

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="process-orders"
              aria-label="Workflow name"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Priority</label>
              <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Tags</label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="orders, billing" />
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Switch
              checked={continueOnError}
              onCheckedChange={setContinueOnError}
              aria-label="Continue on error"
            />
            Continue on error
            <span className="text-xs text-muted-foreground">
              — keep executing later tasks when one fails
            </span>
          </div>

          <ConditionEditor value={condition} onChange={setCondition} />

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-sm font-medium">Tasks</label>
              <Link
                to="/functions"
                target="_blank"
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Function reference
              </Link>
            </div>
            <p className="mb-1 text-xs text-muted-foreground">
              Ordered JSON array of tasks; each task calls one function. Use Validate to check
              function names and inputs against the server registry.
            </p>
            <Textarea
              value={tasksText}
              onChange={(e) => setTasksText(e.target.value)}
              rows={14}
              className="font-mono text-sm"
              aria-label="Tasks JSON"
            />
            {tasksError && <p className="mt-1 text-xs text-destructive">{tasksError}</p>}
          </div>

          {validation && <ValidationResults result={validation} />}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link to={backTo}>Cancel</Link>
            </Button>
            <Button
              variant="outline"
              onClick={handleValidate}
              disabled={validateWorkflow.isPending}
            >
              <ShieldCheck className="h-4 w-4" />
              {validateWorkflow.isPending ? "Validating..." : "Validate"}
            </Button>
            <Button onClick={handleSubmit} disabled={isPending || editLocked}>
              <Save className="h-4 w-4" />
              {isPending ? "Saving..." : isEdit ? "Save Draft" : "Create Draft"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function WorkflowFormPage() {
  const { id } = useParams<{ id: string }>()
  const { data: existing, isLoading } = useWorkflow(id ?? "")

  if (id && isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full max-w-3xl" />
      </div>
    )
  }

  // Remount with fresh initial state once the workflow resolves (or immediately for create).
  return <WorkflowForm key={existing?.workflow_id ?? "new"} existing={id ? existing : undefined} />
}
