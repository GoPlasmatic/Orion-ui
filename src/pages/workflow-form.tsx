import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { DataLogicEditor } from "@goplasmatic/datalogic-ui"
import {
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
  useValidateWorkflow,
} from "@/hooks/use-workflows"
import type { JsonLogicValue, Step, ValidationResponse, Workflow } from "@/api/types"
import {
  countGroups,
  countLeafSteps,
  groupMembers,
  isTaskGroup,
  lintSteps,
  type StepIssue,
} from "@/lib/workflow-steps"
import { useTheme } from "@/lib/use-theme"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/ui/callout"
import { PageHeader } from "@/components/shared/page-header"
import { ValidationResults } from "@/components/shared/validation-results"
import { ArrowLeft, Braces, Layers, Network, Plus, Save, ShieldCheck, Trash2 } from "lucide-react"

/** One task, as inserted by "Add task". */
const SAMPLE_TASK = `{
  "id": "task-1",
  "name": "My first task",
  "function": {
    "name": "map",
    "input": { "mappings": [] }
  }
}`

/** The starting document for a new workflow: a single task. */
const SAMPLE_TASKS = `[
${SAMPLE_TASK.split("\n").map((l) => "  " + l).join("\n")}
]`

/**
 * A task group — the guard clause, new in Orion 1.2 (dataflow-rs 3.6).
 *
 * One condition gates a contiguous run of tasks, evaluated **once on entry**,
 * and `terminal` ends the workflow after the group runs. Together they remove
 * the hand-written negation every later task would otherwise have to restate.
 */
const SAMPLE_GROUP = `{
  "id": "reject-unverified",
  "name": "Reject unverified callers",
  "condition": { "!": [{ "var": "data.verified" }] },
  "terminal": true,
  "tasks": [
    {
      "id": "deny",
      "name": "Answer 403",
      "function": {
        "name": "map",
        "input": { "mappings": [] }
      }
    }
  ]
}`

/** Every id already in use, across tasks and groups alike. */
function collectIds(steps: Step[]): Set<string> {
  const ids = new Set<string>()
  const walk = (list: Step[]) => {
    for (const step of list) {
      if (!step || typeof step !== "object") continue
      if (typeof step.id === "string") ids.add(step.id)
      if (isTaskGroup(step)) walk(groupMembers(step))
    }
  }
  walk(Array.isArray(steps) ? steps : [])
  return ids
}

/**
 * Rename a snippet's ids so none collides with `taken`, suffixing `-2`, `-3`, …
 * Mutates the freshly-parsed snippet, which no one else holds a reference to.
 */
function uniquifyIds(step: unknown, taken: Set<string>): unknown {
  if (!step || typeof step !== "object") return step
  const node = step as Record<string, unknown>
  if (typeof node.id === "string") {
    let candidate = node.id
    let n = 1
    while (taken.has(candidate)) candidate = `${node.id}-${++n}`
    node.id = candidate
    taken.add(candidate)
  }
  if (Array.isArray(node.tasks)) node.tasks.forEach((child) => uniquifyIds(child, taken))
  return node
}

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
          <Label className="mb-0">Trigger condition</Label>
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
  const [taskIssues, setTaskIssues] = useState<StepIssue[]>([])
  const [validation, setValidation] = useState<ValidationResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const backTo = existing ? `/workflows/${existing.workflow_id}` : "/workflows"
  const editLocked = existing ? existing.status !== "draft" : false

  /**
   * Parse the tasks editor and run the client-side shape lint.
   *
   * The lint is advisory — `POST /workflows/validate` is the authority and
   * checks the things only the server can (function names against the real
   * registry, connector closure, JSONLogic compilation). Reporting the
   * structural problems here means the ones Orion 1.2 turned into create-time
   * 400s — a group with no `id`, an id colliding across the shared task/group
   * namespace, an empty `tasks` — surface without a round trip. Issues do not
   * block Save: the server has the final word, and a lint that refuses to
   * submit would be a second, disagreeing validator.
   */
  const parseTasks = (): unknown[] | null => {
    let parsed: unknown
    try {
      parsed = JSON.parse(tasksText)
    } catch {
      setTasksError("Tasks are not valid JSON")
      setTaskIssues([])
      return null
    }
    if (!Array.isArray(parsed)) {
      setTasksError("Tasks must be a JSON array")
      setTaskIssues([])
      return null
    }
    setTasksError(null)
    setTaskIssues(lintSteps(parsed))
    return parsed
  }

  /**
   * Append a snippet to the step array, renaming its ids so a second insert
   * does not collide with the first. Ids share one namespace across tasks and
   * groups, and a duplicate is a create-time 400 — so the editor should not
   * manufacture one every time the button is pressed.
   */
  const appendStep = (snippet: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(tasksText)
    } catch {
      setTasksError("Fix the JSON before inserting a step")
      return
    }
    if (!Array.isArray(parsed)) {
      setTasksError("Tasks must be a JSON array")
      return
    }
    const next = [...parsed, uniquifyIds(JSON.parse(snippet), collectIds(parsed as Step[]))]
    setTasksText(JSON.stringify(next, null, 2))
    setTasksError(null)
    setTaskIssues(lintSteps(next))
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

  // Live shape summary for the editor. Parsed on every keystroke, but the
  // document is a hand-authored task list — small enough that memoizing would
  // cost more than it saves.
  const stepSummary = (() => {
    let parsed: unknown
    try {
      parsed = JSON.parse(tasksText)
    } catch {
      return null
    }
    if (!Array.isArray(parsed)) return null
    const steps = parsed as Step[]
    const tasks = countLeafSteps(steps)
    const groups = countGroups(steps)
    const taskLabel = `${tasks} ${tasks === 1 ? "task" : "tasks"}`
    return groups > 0
      ? `${taskLabel} in ${groups} ${groups === 1 ? "group" : "groups"}`
      : taskLabel
  })()

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
        <Callout variant="warning" className="max-w-3xl">
          Only drafts can be edited. Create a new version from the workflow detail page first.
        </Callout>
      )}

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="process-orders"
              aria-label="Workflow name"
            />
          </div>

          <div>
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Priority</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
            <div>
              <Label>Tags</Label>
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
              <Label className="mb-0">Steps</Label>
              <Link
                to="/functions"
                target="_blank"
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Function reference
              </Link>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              Ordered JSON array. An element carrying <code className="font-mono">function</code> is
              a task; one carrying its own <code className="font-mono">tasks</code> is a{" "}
              <strong>group</strong> — a single condition gating that whole run, evaluated once on
              entry. Any step may set <code className="font-mono">terminal: true</code> to end the
              workflow after it. Use Validate to check function names and inputs against the
              server registry.
            </p>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => appendStep(SAMPLE_TASK)}>
                <Plus className="h-3.5 w-3.5" /> Add task
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => appendStep(SAMPLE_GROUP)}>
                <Layers className="h-3.5 w-3.5" /> Add guard clause
              </Button>
              {stepSummary && (
                <span className="text-xs text-muted-foreground">{stepSummary}</span>
              )}
            </div>
            <Textarea
              value={tasksText}
              onChange={(e) => {
                setTasksText(e.target.value)
                setTasksError(null)
                setTaskIssues([])
              }}
              rows={14}
              className="font-mono text-sm"
              aria-label="Steps JSON"
            />
            {tasksError && <p className="mt-1 text-xs text-destructive">{tasksError}</p>}
            {taskIssues.length > 0 && (
              <div className="mt-2 space-y-1">
                {taskIssues.map((issue, i) => (
                  <Callout key={i} variant="warning" icon={false} className="px-3.5 py-2">
                    <span className="font-mono text-xs">{issue.path}</span> — {issue.message}
                  </Callout>
                ))}
              </div>
            )}
          </div>

          {validation && <ValidationResults result={validation} validLabel="Workflow is valid." />}

          {error && (
            <Callout variant="destructive">
              {error}
            </Callout>
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
