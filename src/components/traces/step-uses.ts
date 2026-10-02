import type { FunctionSchema, RetrySafety, Task } from "@/api/types"
import type { Timeline, TimelineStep } from "@/lib/trace-timeline"

/**
 * What a step touches, read from its authored task: the function's operation
 * and the connector, plugin, model or channel it names. Pure, so a row and the
 * detail panel say the same thing.
 */

export type UsesKind = "connector" | "plugin" | "model" | "channel" | "gate" | "memory" | "unknown"

export interface StepUses {
  kind: UsesKind
  /** `read`, `write`, `incr`, `call`, `infer`… — empty for gate, memory and unknown. */
  op: string
  /** The connector, plugin, model or channel name; null when there is none or it is computed. */
  resource: string | null
  /** What a link to the resource needs: a plugin's id, a model's id. Connectors resolve by name elsewhere. */
  resourceId: string | null
  /** One line: `read soma-db`, `halts the run`, `in memory`. */
  label: string
}

/** Connector functions and the operation each performs on its connector. */
const CONNECTOR_OPS: Record<string, string> = {
  http_call: "call",
  data_query: "read",
  data_write: "write",
  db_read: "read",
  db_write: "write",
  cache_read: "read",
  cache_write: "write",
  cache_delete: "delete",
  cache_incr: "incr",
  mongo_read: "read",
  mongo_write: "write",
  mongo_aggregate: "read",
  publish_kafka: "publish",
  send_email: "send",
  storage_presign: "presign",
  storage_head: "read",
}
const CONNECTOR_KEYS = ["connector", "connector_name", "connector_id"]

/** Functions that end the run when their rule says so — a filter's halt is the point of it. */
const GATES = new Set(["filter"])

function literal(v: unknown): string | null {
  return typeof v === "string" && v ? v : null
}

function catalogueIndex(catalogue: FunctionSchema[] | undefined) {
  const byName = new Map<string, FunctionSchema>()
  for (const fn of catalogue ?? []) {
    byName.set(fn.name, fn)
    for (const alias of fn.aliases ?? []) byName.set(alias, fn)
  }
  return byName
}

export function stepUses(task: Task | null, catalogue?: FunctionSchema[] | Map<string, FunctionSchema>): StepUses {
  const name = task?.function?.name
  if (!name) return { kind: "unknown", op: "", resource: null, resourceId: null, label: "—" }
  const input = (task.function.input ?? {}) as Record<string, unknown>
  const byName = catalogue instanceof Map ? catalogue : catalogueIndex(catalogue)

  if (name in CONNECTOR_OPS) {
    let op = CONNECTOR_OPS[name]
    if (name === "http_call") op = (literal(input.method) ?? "call").toLowerCase()
    if (name === "data_write" && literal(input.op)) op = literal(input.op)!
    let resource: string | null = null
    for (const k of CONNECTOR_KEYS) {
      resource = literal(input[k])
      if (resource) break
    }
    return {
      kind: "connector",
      op,
      resource,
      resourceId: null,
      label: resource ? `${op} ${resource}` : `${op} (computed connector)`,
    }
  }
  if (name === "channel_call") {
    const target = literal(input.channel)
    return {
      kind: "channel",
      op: "call",
      resource: target,
      resourceId: null,
      label: target ? `call ${target}` : "call (computed channel)",
    }
  }
  if (name === "model_infer") {
    const model = literal(input.model)
    return {
      kind: "model",
      op: "infer",
      resource: model,
      resourceId: model,
      label: model ? `infer ${model}` : "infer (computed model)",
    }
  }
  const entry = byName.get(name)
  if (entry?.plugin || entry?.source === "plugin") {
    const plugin = entry.plugin
    const resource = plugin ? `${plugin.id} v${plugin.version}` : name
    return { kind: "plugin", op: "call", resource, resourceId: plugin?.id ?? null, label: `call ${resource}` }
  }
  if (GATES.has(name)) return { kind: "gate", op: "", resource: null, resourceId: null, label: "halts the run" }
  return { kind: "memory", op: "", resource: null, resourceId: null, label: "in memory" }
}

// ---------------------------------------------------------------------------
// Against the baseline
// ---------------------------------------------------------------------------

export interface VsP95 {
  ratio: number | null
  text: string
  /** Ten times the p95 or more — rendered in destructive ink. */
  severe: boolean
}

/** A step's duration over its task's p95 from metrics: `0.3×`, `<0.1×`, `11,593×`. */
export function vsP95(durationUs: number | null, p95Ms: number | null | undefined): VsP95 {
  if (durationUs == null || p95Ms == null || !(p95Ms > 0)) return { ratio: null, text: "—", severe: false }
  const ratio = durationUs / (p95Ms * 1000)
  if (ratio >= 10) return { ratio, text: `${Math.round(ratio).toLocaleString("en")}×`, severe: true }
  if (ratio < 0.1) return { ratio, text: "<0.1×", severe: false }
  return { ratio, text: `${ratio.toFixed(1)}×`, severe: false }
}

// ---------------------------------------------------------------------------
// What a retry repeats
// ---------------------------------------------------------------------------

export interface PriorWrite {
  step: TimelineStep
  function: string
  safety: RetrySafety
  /** For `depends_on`: the input that decides and what this task set it to. */
  decidingValue: string | null
  uses: StepUses
  /** Microseconds between this write finishing and the failing step starting. */
  gapUs: number | null
}

const WRITE_KINDS = new Set(["unsafe_write", "depends_on", "idempotent_write"])

/**
 * Steps that completed before `failed` and wrote something a retry writes
 * again — every function whose catalogue `retry_safety` is a write. A retry of
 * a run starts the workflow from the top, so these run a second time.
 */
export function writesBefore(
  timeline: Timeline,
  failed: TimelineStep,
  catalogue: FunctionSchema[] | undefined,
): PriorWrite[] {
  if (!catalogue) return []
  const byName = catalogueIndex(catalogue)
  const out: PriorWrite[] = []
  for (const s of timeline.steps) {
    if (s.index >= failed.index) break
    if (s.outcome !== "ok") continue
    const fn = s.task?.function?.name
    if (!fn) continue
    const safety = byName.get(fn)?.retry_safety
    if (!safety || !WRITE_KINDS.has(safety.kind)) continue
    const deciding = safety.kind === "depends_on" && safety.input ? s.task?.function.input?.[safety.input] : undefined
    const end = s.startUs != null && s.durationUs != null ? s.startUs + s.durationUs : null
    out.push({
      step: s,
      function: fn,
      safety,
      decidingValue: deciding === undefined ? null : typeof deciding === "string" ? deciding : JSON.stringify(deciding),
      uses: stepUses(s.task, byName),
      gapUs: end != null && failed.startUs != null ? Math.max(0, failed.startUs - end) : null,
    })
  }
  return out
}

/** `unsafe write`, `idempotent write`, `depends on op` — the catalogue's word for it. */
export function retrySafetyLabel(safety: RetrySafety): string {
  if (safety.kind === "depends_on") return safety.input ? `depends on ${safety.input}` : "depends on input"
  return safety.kind.replace(/_/g, " ")
}
