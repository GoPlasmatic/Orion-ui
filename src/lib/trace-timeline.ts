import type {
  ExecutionStep,
  ExecutionStepChange,
  ExecutionTrace,
  Task,
  TraceDetail,
  Workflow,
} from "@/api/types"
import { flattenSteps, loopSetupTaskIds, workflowSteps } from "@/lib/workflow-steps"

/**
 * A trace's steps as a timeline: where the time went, in what structure, and
 * which step failed.
 *
 * Orion 1.12 (dataflow-rs 3.15) stores, under `tracing.task_details`, one
 * `ExecutionStep` per step the engine ran or skipped, each executed one with
 * `started_at` (RFC 3339, nanoseconds, `Z`) and `duration_us`. The trace row
 * itself carries `started_at` / `completed_at` as zoneless UTC microseconds.
 * Everything here is in **microseconds from the trace's `started_at`**, so the
 * stretch before the first step is admission (claim, lease, backpressure) and
 * the stretch after the last is settle (trace and occurrence writes).
 *
 * Three things the wire does not say directly, and this module works out:
 *
 * - **Which step failed.** `result` is only `executed` or `skipped`; a task
 *   that ran and errored is still `executed`. The error is on the trace,
 *   worded `"<CODE>: Task <id> error: …"` — `failingTaskId` reads it. With no
 *   such phrase, a failed trace's last executed step is taken as the failure.
 * - **Structure.** A step in a loop's `setup` carries no `loop_counter`; a
 *   body step carries the iteration. With the workflow at hand the setup ids
 *   come from `loop.setup`; without it, steps without a counter that precede
 *   the first counted one are read as setup.
 * - **Engine time.** The gaps between one step's end and the next one's start
 *   are the engine's own work — conditions, loop bookkeeping, audit — summed
 *   as `gapUs`.
 */

export type StepOutcome = "ok" | "failed" | "skipped"
export type StepPhase = "setup" | "body" | "main"

export interface TimelineStep {
  /** Position in `steps`. */
  index: number
  taskId: string
  phase: StepPhase
  /** The loop iteration (`loop_counter`), null outside a loop body. */
  iteration: number | null
  /** The `for_each` element (`element_index`), null otherwise. */
  element: number | null
  /** Offset from the trace's `started_at`; null for a skip. */
  startUs: number | null
  durationUs: number | null
  outcome: StepOutcome
  /** This task's own writes; empty when it wrote nothing or none were recorded. */
  changes: ExecutionStepChange[]
  /** False when the snapshot was dropped (`truncated`) or never taken (a skip). */
  hasSnapshot: boolean
  /** The authored task, when the workflow was supplied and still has it. */
  task: Task | null
  raw: ExecutionStep
}

export type TimelineGroupKind = "setup" | "iteration" | "main"

export interface TimelineGroup {
  key: string
  kind: TimelineGroupKind
  /** "loop.setup", "iteration 0", or "" for a workflow with no loop. */
  label: string
  iteration: number | null
  startUs: number | null
  endUs: number | null
  steps: TimelineStep[]
}

export interface Timeline {
  steps: TimelineStep[]
  groups: TimelineGroup[]
  /** Whole trace, `started_at` → `completed_at` (or the last step's end). */
  totalUs: number
  /** Before the first step: claim, lease, backpressure. */
  admissionUs: number
  /** First step start → last step end. */
  engineStartUs: number
  engineEndUs: number
  /** After the last step: persisting the trace, settling an occurrence. */
  settleUs: number
  /** Sum of the gaps between consecutive steps — the engine's own work. */
  gapUs: number
  /** Number of hand-offs the gaps were measured across. */
  gaps: number
  failed: TimelineStep | null
  /** The step with the largest share of the trace. */
  dominant: TimelineStep | null
  truncated: boolean
  /** True when the workflow has a loop (setup / iteration grouping applies). */
  looped: boolean
}

/**
 * Microseconds since the epoch for a server instant, keeping the sub-millisecond
 * digits `Date` would drop. Accepts the trace row's zoneless UTC
 * (`2026-10-02T05:41:15.836289`) and a step's `Z`-suffixed nanoseconds
 * (`2026-10-02T05:41:15.837885170Z`). Null when it does not parse.
 */
export function parseInstantUs(value: string | null | undefined): number | null {
  if (!value) return null
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(value)
  if (!m) return null
  const ms = Date.parse(`${m[1]}${m[3] && m[3] !== "Z" ? m[3] : "Z"}`)
  if (Number.isNaN(ms)) return null
  const frac = (m[2] ?? "").padEnd(6, "0").slice(0, 6)
  return ms * 1000 + Number(frac)
}

/** The task id an error names: `"FUNCTION_ERROR: Task bump_work.bump error: …"` → `bump_work.bump`. */
export function failingTaskId(error: string | null | undefined): string | null {
  if (!error) return null
  const m = /\bTask ([^\s:]+) error\b/.exec(error)
  return m ? m[1] : null
}

/** The parsed `task_trace_json`, or null when the trace has none or it is not a trace. */
export function executionTrace(trace: Pick<TraceDetail, "task_trace_json"> | null | undefined): ExecutionTrace | null {
  let v: unknown = trace?.task_trace_json
  if (typeof v === "string") {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!v || typeof v !== "object" || !Array.isArray((v as ExecutionTrace).steps)) return null
  return v as ExecutionTrace
}

export function buildTimeline(
  trace: Pick<TraceDetail, "status" | "error" | "started_at" | "completed_at" | "task_trace_json">,
  workflow?: Pick<Workflow, "tasks" | "loop"> | null,
): Timeline | null {
  const et = executionTrace(trace)
  if (!et || et.steps.length === 0) return null

  const tasksById = new Map<string, Task>()
  for (const t of flattenSteps(workflowSteps(workflow))) tasksById.set(t.id, t)
  const setupIds = workflow ? loopSetupTaskIds(workflow) : null
  const looped = workflow ? !!workflow.loop : et.steps.some((s) => s.loop_counter != null)
  const firstCounted = et.steps.findIndex((s) => s.loop_counter != null)

  const stepStarts = et.steps.map((s) => parseInstantUs(s.started_at))
  const firstStepUs = stepStarts.find((v): v is number => v != null) ?? null
  const origin = parseInstantUs(trace.started_at) ?? firstStepUs ?? 0

  const steps: TimelineStep[] = et.steps.map((s, index) => {
    const taskId = s.task_id ?? `step ${index + 1}`
    let phase: StepPhase = "main"
    if (looped) {
      if (setupIds ? setupIds.has(taskId) : s.loop_counter == null && (firstCounted === -1 || index < firstCounted))
        phase = "setup"
      else phase = "body"
    }
    const abs = stepStarts[index]
    return {
      index,
      taskId,
      phase,
      iteration: s.loop_counter ?? null,
      element: s.element_index ?? null,
      startUs: abs == null ? null : abs - origin,
      durationUs: typeof s.duration_us === "number" ? s.duration_us : null,
      outcome: s.result === "skipped" ? "skipped" : "ok",
      changes: Array.isArray(s.changes) ? s.changes : [],
      hasSnapshot: s.message != null,
      task: tasksById.get(taskId) ?? null,
      raw: s,
    }
  })

  // Attribute the failure to a step.
  let failed: TimelineStep | null = null
  if (trace.status === "failed") {
    const named = failingTaskId(trace.error)
    const executed = steps.filter((s) => s.outcome !== "skipped")
    failed =
      (named ? [...executed].reverse().find((s) => s.taskId === named) : undefined) ??
      executed[executed.length - 1] ??
      null
    if (failed) failed.outcome = "failed"
  }

  // Engine span and the gaps inside it.
  const timed = steps.filter((s) => s.startUs != null && s.durationUs != null)
  const engineStartUs = timed.length ? Math.min(...timed.map((s) => s.startUs!)) : 0
  const engineEndUs = timed.length ? Math.max(...timed.map((s) => s.startUs! + s.durationUs!)) : 0
  let gapUs = 0
  let gaps = 0
  const ordered = [...timed].sort((a, b) => a.startUs! - b.startUs!)
  for (let i = 1; i < ordered.length; i++) {
    const prevEnd = ordered[i - 1].startUs! + ordered[i - 1].durationUs!
    gapUs += Math.max(0, ordered[i].startUs! - prevEnd)
    gaps++
  }
  const completed = parseInstantUs(trace.completed_at)
  const totalUs = Math.max(engineEndUs, completed != null ? completed - origin : engineEndUs)

  // Groups, in step order.
  const groups: TimelineGroup[] = []
  for (const s of steps) {
    const kind: TimelineGroupKind = s.phase === "setup" ? "setup" : s.phase === "body" ? "iteration" : "main"
    const key = kind === "iteration" ? `iteration-${s.iteration ?? "?"}` : kind
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) {
      g = {
        key,
        kind,
        label: kind === "setup" ? "loop.setup" : kind === "iteration" ? `iteration ${s.iteration ?? "?"}` : "",
        iteration: kind === "iteration" ? s.iteration : null,
        startUs: null,
        endUs: null,
        steps: [],
      }
      groups.push(g)
    }
    g.steps.push(s)
    if (s.startUs != null) {
      g.startUs = g.startUs == null ? s.startUs : Math.min(g.startUs, s.startUs)
      const end = s.startUs + (s.durationUs ?? 0)
      g.endUs = g.endUs == null ? end : Math.max(g.endUs, end)
    }
  }

  const dominant = timed.length ? timed.reduce((a, b) => (b.durationUs! > a.durationUs! ? b : a)) : null

  return {
    steps,
    groups,
    totalUs,
    admissionUs: timed.length ? Math.max(0, engineStartUs) : 0,
    engineStartUs,
    engineEndUs,
    settleUs: Math.max(0, totalUs - engineEndUs),
    gapUs,
    gaps,
    failed,
    dominant,
    truncated: et.truncated === true,
    looped,
  }
}

/**
 * Leaf tasks the workflow has that the trace never reached — after the failure
 * or a halt. Matched by id, so a task a loop ran twice counts once. Empty
 * without a workflow.
 */
export function notReached(timeline: Timeline, workflow: Pick<Workflow, "tasks" | "loop"> | null | undefined): Task[] {
  if (!workflow) return []
  const seen = new Set(timeline.steps.map((s) => s.taskId))
  return flattenSteps(workflowSteps(workflow)).filter((t) => !seen.has(t.id))
}

/** `9 µs`, `1.50 ms`, `74.4 ms`, `8.12 s` — the units a step timeline reads in. */
export function formatMicros(us: number | null | undefined): string {
  if (us == null || !Number.isFinite(us)) return "—"
  if (us < 1000) return `${Math.round(us)} µs`
  if (us < 10_000) return `${(us / 1000).toFixed(2)} ms`
  if (us < 1_000_000) return `${(us / 1000).toFixed(1)} ms`
  return `${(us / 1_000_000).toFixed(2)} s`
}
