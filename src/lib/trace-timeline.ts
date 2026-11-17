import type {
  ExecutionStep,
  ExecutionStepChange,
  ExecutionTrace,
  Task,
  TraceDetail,
  Workflow,
} from "@/api/types"
import { flattenSteps, loopSetupTaskIds, workflowSteps } from "@/lib/workflow-steps"
import { parseEngineError } from "@/lib/trace-error"

/**
 * A trace's steps as a timeline: where the time went, in what structure, and
 * which step failed.
 *
 * Under `tracing.task_details` Orion 2 stores a dataflow-rs 4 trace:
 * `{initial, steps, truncated}` — the context the run started from, then each
 * step with the changes it made and its `elapsed_us`. [`executionTrace`]
 * replays that into one `ExecutionStep` per step, each with the snapshot after
 * it, so everything below reads one model. The trace row carries `started_at`
 * and `completed_at`; everything here is in **microseconds from the trace's
 * `started_at`**, so the stretch after the last step is settle (trace and
 * occurrence writes).
 *
 * A dataflow-rs 4 step carries no start instant, so its steps are laid end to
 * end from the trace's start: admission and the gaps between steps are not
 * measured. Two things the wire does not say directly, and this module works
 * out:
 *
 * - **Which step failed.** A step whose failure went to the workflow's policy
 *   or stopped the run is `failed`. With none marked — a failure recorded only
 *   on the trace, worded `"<CODE>: Task <id> error: …"` — `failingTaskId`
 *   reads the task it names, else the last executed step is the failure.
 * - **Structure.** A step in a loop's `setup` carries no `loop_counter`; a
 *   body step carries the iteration. With the workflow at hand the setup ids
 *   come from `loop.setup`; without it, steps without a counter that precede
 *   the first counted one are read as setup.
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
  /** Before the first step. Always 0: a v4 step records no start instant. */
  admissionUs: number
  /** First step start → last step end, laid out end to end. */
  engineStartUs: number
  engineEndUs: number
  /** After the last step: persisting the trace, settling an occurrence. */
  settleUs: number
  /** Always 0: a v4 step records no start instant, so hand-offs are not measurable. */
  gapUs: number
  /** Number of hand-offs the gaps were measured across (0). */
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
 * digits `Date` would drop. Accepts the admin plane's zoneless UTC
 * (`2026-10-02T05:41:15.836289`) and an RFC 3339 instant
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
  return parseEngineError(error).taskId
}

const parsedCache = new WeakMap<object, ExecutionTrace | null>()

/** A dataflow-rs 4 trace, as Orion 2 writes `task_trace_json`. */
interface ReplayTrace {
  initial: Record<string, unknown>
  steps: ReplayStep[]
  truncated?: boolean
}

interface ReplayStep {
  workflow_id?: string
  task_id?: string | null
  result?: ExecutionStep["result"]
  status?: number | null
  changes?: ExecutionStepChange[]
  mapping_ends?: number[]
  errors?: unknown[]
  elapsed_us?: number
  loop_counter?: number
  element_index?: number
  [key: string]: unknown
}

const ROOTS = new Set(["data", "metadata", "temp_data"])

function isReplayTrace(v: unknown): v is ReplayTrace {
  if (!v || typeof v !== "object") return false
  const t = v as ReplayTrace
  return Array.isArray(t.steps) && !!t.initial && typeof t.initial === "object" && !Array.isArray(t.initial)
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** `data.items.0` and `data.items[0]` alike, as segments. */
function pathSegments(path: string): string[] {
  return path.replace(/\[(\d+)\]/g, ".$1").split(".").filter((seg) => seg !== "")
}

/**
 * One change applied to a context root, by the engine's replay rules: a
 * removal removes its path; a change at a root merges its object's keys into
 * the root unless it `replaced` it; anything else is set at its path, a hop
 * that cannot continue writing nothing and an index on an array naming its
 * element.
 */
function applyChange(root: Record<string, unknown>, change: ExecutionStepChange): void {
  const segs = pathSegments(String(change.path ?? ""))
  if (segs.length === 0) return
  if (segs.length === 1 && ROOTS.has(segs[0]) && !change.removed) {
    if (!change.replaced && isRecord(root[segs[0]]) && isRecord(change.new_value)) {
      root[segs[0]] = { ...(root[segs[0]] as Record<string, unknown>), ...structuredClone(change.new_value) }
    } else {
      root[segs[0]] = structuredClone(change.new_value)
    }
    return
  }
  let node: unknown = root
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]
    if (Array.isArray(node)) {
      node = node[Number(seg)]
    } else if (isRecord(node)) {
      if (node[seg] === undefined && !change.removed) node[seg] = {}
      node = node[seg]
    } else {
      return
    }
  }
  const last = segs[segs.length - 1]
  if (Array.isArray(node)) {
    const i = Number(last)
    if (!Number.isInteger(i)) return
    if (change.removed) node.splice(i, 1)
    else node[i] = structuredClone(change.new_value)
  } else if (isRecord(node)) {
    if (change.removed) delete node[last]
    else node[last] = structuredClone(change.new_value)
  }
}

/**
 * A dataflow-rs 4 trace in the step model the timeline reads: each task step
 * with the snapshot its changes replay to, its `elapsed_us` as `duration_us`
 * and its per-mapping contexts. The engine's own steps (a loop sweep's
 * counter, with no task) are applied and not listed; a workflow's skip is.
 * Past the step a truncated trace stopped recording changes at, no snapshot is
 * offered, since it would be stale.
 */
function replay(trace: ReplayTrace): ExecutionTrace {
  const root = structuredClone(trace.initial)
  const payload = isRecord(trace.initial.data) ? structuredClone(trace.initial.data) : undefined
  let lastRecorded = trace.steps.length - 1
  if (trace.truncated) {
    lastRecorded = -1
    trace.steps.forEach((s, i) => {
      if (Array.isArray(s.changes) && s.changes.length > 0) lastRecorded = i
    })
  }
  const steps: ExecutionStep[] = []
  trace.steps.forEach((s, i) => {
    const changes = Array.isArray(s.changes) ? s.changes : []
    const mappingContexts: unknown[] = []
    let from = 0
    for (const end of s.mapping_ends ?? []) {
      for (const change of changes.slice(from, end)) applyChange(root, change)
      mappingContexts.push(structuredClone(root))
      from = end
    }
    for (const change of changes.slice(from)) applyChange(root, change)
    if (s.task_id == null && s.result !== "skipped") return
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { elapsed_us, mapping_ends, ...rest } = s
    const kept = s.task_id != null && s.result !== "skipped" && i <= lastRecorded
    steps.push({
      ...rest,
      changes,
      duration_us: typeof elapsed_us === "number" ? elapsed_us : undefined,
      message: kept ? { payload, context: structuredClone(root), errors: s.errors ?? [] } : undefined,
      mapping_contexts: mappingContexts.length > 0 ? mappingContexts : undefined,
    })
  })
  return { steps, truncated: trace.truncated === true, initial: trace.initial }
}

/**
 * The parsed `task_trace_json`, or null when the trace has none or it is not a
 * dataflow-rs 4 trace. The API answers an object, so it is replayed straight
 * into per-step snapshots. Parsed once per trace object.
 */
export function executionTrace(trace: Pick<TraceDetail, "task_trace_json"> | null | undefined): ExecutionTrace | null {
  if (!trace) return null
  if (parsedCache.has(trace)) return parsedCache.get(trace) ?? null
  const out = isReplayTrace(trace.task_trace_json) ? replay(trace.task_trace_json) : null
  parsedCache.set(trace, out)
  return out
}

/** Whether a trace kept any steps. */
export const hasSteps = (trace: Pick<TraceDetail, "task_trace_json"> | null | undefined): boolean =>
  (executionTrace(trace)?.steps.length ?? 0) > 0

/**
 * The workflow a trace ran: the id its own steps carry first — the channel
 * may have been re-pointed since — then the channel's. The version is not
 * recorded on a trace (asked upstream), so callers read the active one.
 */
export function traceWorkflowId(
  trace: Pick<TraceDetail, "task_trace_json"> | null | undefined,
  channel: { workflow_id?: string | null } | null | undefined,
): string | null {
  const fromSteps = executionTrace(trace)?.steps.find((s) => typeof s.workflow_id === "string" && s.workflow_id)?.workflow_id
  return fromSteps ?? channel?.workflow_id ?? null
}

/**
 * Why a trace has no steps to show, as a reason a page can word: the run has
 * not settled; the channel is unknown; `tracing.task_details` is off; it keeps
 * failures only and this run did not fail; it failed without a recorded step
 * (the error ended the run before the engine kept its steps); or it ran nothing
 * (a condition or rollout gate skipped it).
 */
export type StepDataGap = "unsettled" | "no_channel" | "details_off" | "errors_only" | "failed_unrecorded" | "ran_nothing"

export function stepDataGap(
  trace: Pick<TraceDetail, "status">,
  channel: { config?: { tracing?: { task_details?: boolean; errors_only?: boolean } | null } | null } | null | undefined,
): StepDataGap {
  if (trace.status === "pending" || trace.status === "running") return "unsettled"
  if (!channel) return "no_channel"
  const tracing = channel.config?.tracing
  if (!tracing?.task_details) return "details_off"
  if (tracing.errors_only && trace.status !== "failed") return "errors_only"
  if (trace.status === "failed") return "failed_unrecorded"
  return "ran_nothing"
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

  // A step carries no start instant, only how long it ran: lay the steps end to
  // end from the row's start.
  const originUs = parseInstantUs(trace.started_at) ?? 0
  let at = originUs
  const stepStarts = et.steps.map((s) => {
    if (s.result === "skipped" || typeof s.duration_us !== "number") return null
    const start = at
    at += s.duration_us
    return start
  })

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
      startUs: abs == null ? null : abs - originUs,
      durationUs: typeof s.duration_us === "number" ? s.duration_us : null,
      outcome: s.result === "skipped" ? "skipped" : s.result === "failed" ? "failed" : "ok",
      changes: Array.isArray(s.changes) ? s.changes : [],
      hasSnapshot: s.message != null,
      task: tasksById.get(taskId) ?? null,
      raw: s,
    }
  })

  // Attribute the failure to a step: the one the engine marked, else the one
  // the error names, else the last that ran.
  let failed: TimelineStep | null = steps.find((s) => s.outcome === "failed") ?? null
  if (!failed && trace.status === "failed") {
    const named = failingTaskId(trace.error)
    const executed = steps.filter((s) => s.outcome !== "skipped")
    failed =
      (named ? [...executed].reverse().find((s) => s.taskId === named) : undefined) ??
      executed[executed.length - 1] ??
      null
    if (failed) failed.outcome = "failed"
  }

  // Engine span. Steps are laid end to end, so the gaps between them are not
  // measurable; the span after the last is settle.
  const timed = steps.filter((s) => s.startUs != null && s.durationUs != null)
  const engineStartUs = timed.length ? Math.min(...timed.map((s) => s.startUs!)) : 0
  const engineEndUs = timed.length ? Math.max(...timed.map((s) => s.startUs! + s.durationUs!)) : 0
  const completed = parseInstantUs(trace.completed_at)
  const totalUs = Math.max(engineEndUs, completed != null ? completed - originUs : engineEndUs)

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
    // A dataflow-rs 4 step records no start instant, so the hand-offs between
    // steps cannot be measured. Kept at zero rather than inferred from the
    // trace's total, which would blame the engine for admission and settle.
    gapUs: 0,
    gaps: 0,
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
