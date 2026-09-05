import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { DataLogicEditor } from "@goplasmatic/datalogic-ui"
import { WorkflowVisualizer } from "@goplasmatic/dataflow-ui"
import {
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
  useValidateWorkflow,
} from "@/hooks/use-workflows"
import { useFunctions } from "@/hooks/use-functions"
import type { JsonLogicValue, Step, ValidationResponse, Workflow } from "@/api/types"
import {
  countGroups,
  countLeafSteps,
  groupMembers,
  isTaskGroup,
  lintSteps,
  type StepIssue,
} from "@/lib/workflow-steps"
import { rangeAtPath } from "@/lib/json-path"
import { stepCompletions } from "@/lib/workflow-completions"
import { toVisualizerWorkflow } from "@/lib/workflow-mapper"
import { useTheme } from "@/lib/use-theme"
import { useUnsavedChanges } from "@/lib/use-unsaved-changes"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/ui/callout"
import { PageHeader } from "@/components/shared/page-header"
import { Breadcrumbs } from "@/components/shared/breadcrumbs"
import { FormError } from "@/components/shared/form-error"
import { TagsInput } from "@/components/shared/tags-input"
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog"
import { ValidationResults } from "@/components/shared/validation-results"
import { JsonEditor } from "@/components/shared/json-editor"
import type { Diagnostic, JsonEditorHandle, LintContext } from "@/lib/editor-types"
import {
  Braces,
  Eye,
  EyeOff,
  Layers,
  Network,
  OctagonX,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react"

/** One task, as inserted by "Add task". */
const SAMPLE_TASK = `{
  "id": "task-1",
  "name": "My first task",
  "function": {
    "name": "map",
    "input": { "mappings": [] }
  }
}`

/**
 * A task that ends the workflow when it fails — `halt_on: "failure"`, Orion
 * 1.6 / dataflow-rs 3.10. The outcome axis to `terminal`'s position axis: a
 * `validation` rule that did not pass is a status of 400 or above, so the
 * workflow stops there and the task keeps its own status on the audit trail.
 */
const SAMPLE_HALT_TASK = `{
  "id": "check",
  "name": "Refuse a bad request",
  "halt_on": "failure",
  "function": {
    "name": "validation",
    "input": { "rules": [] }
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

/** How long the preview waits after the last keystroke before re-laying out. */
const PREVIEW_DEBOUNCE_MS = 350

/** The steps editor's document as steps, or the one reason it is not. */
type ParsedSteps = { steps: Step[]; error: null } | { steps: null; error: string }

function parseStepArray(text: string): ParsedSteps {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { steps: null, error: "Tasks are not valid JSON" }
  }
  if (!Array.isArray(parsed)) return { steps: null, error: "Tasks must be a JSON array" }
  return { steps: parsed as Step[], error: null }
}

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

/** A lint finding with the place in the document it was found. */
interface PositionedIssue extends StepIssue {
  from?: number
  to?: number
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
          <JsonEditor
            value={jsonText}
            onChange={onJsonChange}
            height="14rem"
            aria-label="Trigger condition JSON"
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
  // The catalogue, for completion: function names inside `function.name`,
  // a function's declared fields inside its `input`.
  const { data: functions } = useFunctions()

  const [name, setName] = useState(existing?.name ?? "")
  const [description, setDescription] = useState(existing?.description ?? "")
  const [priority, setPriority] = useState(String(existing?.priority ?? 0))
  const [tags, setTags] = useState<string[]>(existing?.tags ?? [])
  const [continueOnError, setContinueOnError] = useState(existing?.continue_on_error ?? false)
  const [condition, setCondition] = useState<JsonLogicValue | undefined>(
    existing?.condition ?? undefined
  )
  const [tasksText, setTasksText] = useState(() =>
    existing ? JSON.stringify(existing.tasks ?? [], null, 2) : SAMPLE_TASKS
  )
  const [tasksError, setTasksError] = useState<string | null>(null)
  const [taskIssues, setTaskIssues] = useState<PositionedIssue[]>([])
  const [validation, setValidation] = useState<ValidationResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [showPreview, setShowPreview] = useState(true)
  // What the preview draws: the last document that parsed as an array of
  // steps with no shape issues. Debounced, so typing does not re-lay out the
  // diagram on every keystroke.
  const [previewSteps, setPreviewSteps] = useState<Step[] | null>(() =>
    existing && Array.isArray(existing.tasks) ? existing.tasks : null
  )
  const editorRef = useRef<JsonEditorHandle>(null)

  const snapshot = JSON.stringify({ name, description, priority, tags, continueOnError, condition, tasksText })
  const [initialSnapshot] = useState(snapshot)
  const { blocker, markSaved } = useUnsavedChanges(snapshot !== initialSnapshot)

  const backTo = existing ? `/workflows/${existing.workflow_id}` : "/workflows"
  const editLocked = existing ? existing.status !== "draft" : false

  const completions = useMemo(() => [stepCompletions(() => functions ?? [])], [functions])

  /**
   * The editor's diagnostics: syntax errors from the parser's own error nodes,
   * then the shape lint mapped from the coordinate it reports to the range in
   * the document. Runs debounced after every edit, so a group without an `id`
   * is underlined where it is typed rather than reported on Save.
   *
   * The lint is advisory — `POST /workflows/validate` is the authority and
   * checks the things only the server can (function names against the real
   * registry, connector closure, JSONLogic compilation). Issues do not block
   * Save: the server has the final word, and a lint that refuses to submit
   * would be a second, disagreeing validator.
   */
  const lint = useCallback(({ doc, tree, syntaxErrors }: LintContext): Diagnostic[] => {
    if (syntaxErrors.length > 0) {
      setTaskIssues([])
      return syntaxErrors
    }
    const { steps, error } = parseStepArray(doc)
    if (!steps) {
      setTaskIssues([{ path: "tasks", message: error, from: 0 }])
      return [{ from: 0, to: doc.length, severity: "error", message: error }]
    }
    const issues = lintSteps(steps)
    const positioned: PositionedIssue[] = issues.map((issue) => {
      const range = rangeAtPath(tree, doc, issue.path)
      return { ...issue, from: range?.from, to: range?.to }
    })
    setTaskIssues(positioned)
    return positioned.map((issue) => ({
      from: issue.from ?? 0,
      to: issue.to ?? issue.from ?? 0,
      severity: "warning",
      message: `${issue.path} — ${issue.message}`,
    }))
  }, [])

  // The preview follows the document, a beat behind it, and keeps the last
  // document that passed the shape lint while the current one is mid-edit.
  // The update runs from the timer, not the effect body: a synchronous
  // setState in an effect is what the compiler lint refuses.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const { steps } = parseStepArray(tasksText)
      if (steps && lintSteps(steps).length === 0) setPreviewSteps(steps)
    }, PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [tasksText])

  /** Parse the tasks editor and run the client-side shape lint (for Save and Validate). */
  const parseTasks = (): Step[] | null => {
    const { steps, error } = parseStepArray(tasksText)
    setTasksError(error)
    return steps
  }

  /**
   * Append a snippet to the step array, renaming its ids so a second insert
   * does not collide with the first. Ids share one namespace across tasks and
   * groups, and a duplicate is a create-time 400 — so the editor should not
   * manufacture one every time the button is pressed.
   */
  const appendStep = (snippet: string) => {
    const { steps, error } = parseStepArray(tasksText)
    if (!steps) {
      setTasksError(error === "Tasks are not valid JSON" ? "Fix the JSON before inserting a step" : error)
      return
    }
    const next = [...steps, uniquifyIds(JSON.parse(snippet), collectIds(steps))]
    setTasksText(JSON.stringify(next, null, 2))
    setTasksError(null)
  }

  const buildPayload = () => {
    if (!name.trim()) {
      setError("Name is required")
      return null
    }
    const tasks = parseTasks()
    if (!tasks) return null

    return {
      name,
      description: description || undefined,
      priority: Number(priority) || 0,
      condition,
      tasks,
      tags,
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
      onError: setError,
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
          onSuccess: () => {
            markSaved()
            navigate(`/workflows/${existing.workflow_id}`)
          },
          onError: setError,
        }
      )
    } else {
      createWorkflow.mutate(payload, {
        onSuccess: (w) => {
          markSaved()
          navigate(`/workflows/${w.workflow_id}`)
        },
        onError: setError,
      })
    }
  }

  const isPending = createWorkflow.isPending || updateWorkflow.isPending

  // Live shape summary for the editor. Parsed on every keystroke, but the
  // document is a hand-authored task list — small enough that memoizing would
  // cost more than it saves.
  const stepSummary = (() => {
    const { steps } = parseStepArray(tasksText)
    if (!steps) return null
    const tasks = countLeafSteps(steps)
    const groups = countGroups(steps)
    const taskLabel = `${tasks} ${tasks === 1 ? "task" : "tasks"}`
    return groups > 0
      ? `${taskLabel} in ${groups} ${groups === 1 ? "group" : "groups"}`
      : taskLabel
  })()

  // The preview draws what the server would see, on the visualizer the detail
  // page uses — so the diagram is not a surprise after Save.
  const previewWorkflow = useMemo(
    () =>
      previewSteps
        ? toVisualizerWorkflow({
            workflow_id: existing?.workflow_id ?? "draft",
            name: name || "Untitled workflow",
            description: description || null,
            priority: Number(priority) || 0,
            tags,
            condition,
            continue_on_error: continueOnError,
            status: existing?.status ?? "draft",
            version: existing?.version ?? 1,
            tasks: previewSteps,
            content_hash: "",
            created_at: "",
            updated_at: "",
          })
        : null,
    [previewSteps, existing?.workflow_id, existing?.status, existing?.version, name, description, priority, tags, condition, continueOnError],
  )

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Workflows", to: "/workflows" },
          ...(existing ? [{ label: existing.name, to: backTo }] : []),
          { label: isEdit ? "Edit" : "New workflow" },
        ]}
      />

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
            <Label required>Name</Label>
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
              <Label hint="Higher wins when two workflows match the same message.">Priority</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
            <div>
              <Label hint="Filters the list and the export.">Tags</Label>
              <TagsInput value={tags} onChange={setTags} placeholder="orders, billing" aria-label="Tags" />
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
        </CardContent>
      </Card>

      {/* The steps, in an editor that knows the shape and the catalogue, above
          the diagram they will draw. Wider than the card above on purpose: the
          document is where the time goes. */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Steps</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Ordered JSON array. An element carrying <code className="font-mono">function</code>{" "}
              is a task; one carrying its own <code className="font-mono">tasks</code> is a{" "}
              <strong>group</strong> — a single condition gating that whole run. Any step may set{" "}
              <code className="font-mono">terminal: true</code>; a task may set{" "}
              <code className="font-mono">halt_on: "failure"</code>. Type inside{" "}
              <code className="font-mono">"function": {"{ \"name\": \"…\" }"}</code> for the
              catalogue, inside its <code className="font-mono">input</code> for the fields it
              declares, and press Ctrl-Space for the keys a step takes.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => appendStep(SAMPLE_TASK)}>
              <Plus className="h-3.5 w-3.5" /> Add task
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => appendStep(SAMPLE_GROUP)}>
              <Layers className="h-3.5 w-3.5" /> Add guard clause
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => appendStep(SAMPLE_HALT_TASK)}>
              <OctagonX className="h-3.5 w-3.5" /> Add halt-on-failure
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowPreview((v) => !v)}
              aria-pressed={showPreview}
            >
              {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showPreview ? "Hide preview" : "Show preview"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="min-w-0 space-y-2">
              <JsonEditor
                ref={editorRef}
                value={tasksText}
                onChange={(text) => {
                  setTasksText(text)
                  setTasksError(null)
                }}
                lint={lint}
                completions={completions}
                height="24rem"
                readOnly={editLocked}
                aria-label="Steps JSON"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{stepSummary ?? "not a step array yet"}</span>
                <span>
                  {taskIssues.length === 0
                    ? "shape lint: no findings · Validate checks the registry"
                    : `${taskIssues.length} shape finding${taskIssues.length === 1 ? "" : "s"} · click one to go there`}
                </span>
              </div>
              {tasksError && <p className="text-xs text-destructive">{tasksError}</p>}
              {taskIssues.length > 0 && (
                <ul className="space-y-1">
                  {taskIssues.map((issue, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => issue.from != null && editorRef.current?.goTo(issue.from, issue.to)}
                        className="w-full rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-left text-xs text-warning transition-colors hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        <span className="font-mono">{issue.path}</span> — {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {showPreview && (
              <div className="min-w-0">
                <div className="h-[30rem] overflow-hidden rounded-md border">
                  {previewWorkflow ? (
                    <WorkflowVisualizer workflows={[previewWorkflow]} />
                  ) : (
                    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                      The preview draws the steps once they parse as an array with no shape
                      findings.
                    </div>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  The same diagram the workflow page shows, redrawn as you type.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {validation && <ValidationResults result={validation} validLabel="Workflow is valid." />}
        <FormError error={error} />
        <div className="flex flex-wrap justify-end gap-2">
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
      </div>

      <UnsavedChangesDialog blocker={blocker} />
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
