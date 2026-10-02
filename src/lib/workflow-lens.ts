import type { Step, Task, Workflow, WorkflowLoop } from "@/api/types"
import type { Timeline } from "@/lib/trace-timeline"
import { formatMicros } from "@/lib/trace-timeline"
import { groupMembers, isObject, isTaskGroup } from "@/lib/workflow-steps"

/**
 * The workflow page's four lenses over one step tree.
 *
 * *Structure* is the dataflow-ui visualizer. The other three share the rows
 * built here — `workflowSteps` order, so a loop's `setup` comes first, then
 * the body — and each adds columns: what a step touches (*Dependencies*), what
 * it costs in a steady-state run (*Cost*) and what it did in one trace
 * (*Last run*). Everything in this module is pure, so the read-outs under each
 * lens are testable against a real workflow without rendering anything.
 */

export const LENSES = ["structure", "deps", "cost", "run"] as const
export type Lens = (typeof LENSES)[number]

export const LENS_LABELS: Record<Lens, string> = {
  structure: "Structure",
  deps: "Dependencies",
  cost: "Cost",
  run: "Last run",
}

/** `?lens=` read leniently: anything unknown is the default, Structure. */
export function parseLens(value: string | null | undefined): Lens {
  return (LENSES as readonly string[]).includes(value ?? "") ? (value as Lens) : "structure"
}

// ---------------------------------------------------------------------------
// What a step does to the outside world
// ---------------------------------------------------------------------------

export type StepOp = "read" | "write" | "incr" | "call" | "publish" | "send" | "presign" | "infer"

/** Ops that change something outside the message — what a retry repeats. */
export const SIDE_EFFECT_OPS: ReadonlySet<StepOp> = new Set(["write", "incr", "publish", "send"])

const OP_BY_FUNCTION: Record<string, StepOp> = {
  db_read: "read",
  data_query: "read",
  cache_read: "read",
  mongo_read: "read",
  mongo_aggregate: "read",
  storage_head: "read",
  db_write: "write",
  data_write: "write",
  cache_write: "write",
  cache_delete: "write",
  mongo_write: "write",
  cache_incr: "incr",
  http_call: "call",
  channel_call: "call",
  publish_kafka: "publish",
  send_email: "send",
  storage_presign: "presign",
  model_infer: "infer",
}

/**
 * What a function does to the resource it names. Plugin functions are calls
 * — pass the names a plugin serves as `pluginFunctions`; without that list a
 * dotted name (`tb.pairing.pair`, the plugin namespace) is read as one too.
 * Null for a function that only works on the message (`map`, `filter`, …).
 */
export function classifyOp(fn: string | null | undefined, pluginFunctions?: ReadonlySet<string>): StepOp | null {
  if (!fn) return null
  const op = OP_BY_FUNCTION[fn]
  if (op) return op
  if (pluginFunctions?.has(fn)) return "call"
  if (fn.includes(".")) return "call"
  return null
}

export type ResourceKind = "connector" | "plugin" | "model" | "channel"

export interface ResourceRef {
  kind: ResourceKind
  /** The connector / plugin / model id, or the channel name a `channel_call` targets. */
  name: string
  /** A target computed per message — a JSONLogic `channel` or `model`. */
  dynamic?: boolean
}

export const resourceKey = (r: Pick<ResourceRef, "kind" | "name">) => `${r.kind}:${r.name}`

const CONNECTOR_KEYS = ["connector", "connector_name", "connector_id"]

/** The id of the plugin serving each function, from `dependencies.plugins`. */
export type PluginOf = ReadonlyMap<string, string>

/** What one task touches, or null for an in-memory step. */
export function stepResource(task: Task, pluginOf?: PluginOf): ResourceRef | null {
  const fn = task.function?.name
  const input = task.function?.input ?? {}
  if (fn === "channel_call") {
    if (typeof input.channel === "string") return { kind: "channel", name: input.channel }
    if (input.channel !== undefined || input.channel_logic !== undefined)
      return { kind: "channel", name: "computed per message", dynamic: true }
    return null
  }
  if (fn === "model_infer") {
    if (typeof input.model === "string") return { kind: "model", name: input.model }
    if (input.model !== undefined) return { kind: "model", name: "computed per message", dynamic: true }
    return null
  }
  const plugin = fn ? pluginOf?.get(fn) : undefined
  if (plugin) return { kind: "plugin", name: plugin }
  for (const key of CONNECTOR_KEYS) {
    const v = input[key]
    if (typeof v === "string" && v) return { kind: "connector", name: v }
  }
  return null
}

/**
 * Where a task says it writes, from its definition: a `map`'s mapping paths,
 * otherwise an `output` path. Best effort — the trace's `changes` are what it
 * actually wrote.
 */
export function declaredWrites(task: Task): string[] {
  const input = task.function?.input ?? {}
  const out: string[] = []
  if (Array.isArray(input.mappings)) {
    for (const m of input.mappings) if (isObject(m) && typeof m.path === "string") out.push(m.path)
  }
  if (typeof input.output === "string") out.push(input.output)
  return [...new Set(out)]
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type LensPhase = "setup" | "body" | "main"

export interface LensGroupRow {
  kind: "group"
  id: string
  name: string
  depth: number
  phase: LensPhase
  conditional: boolean
  terminal: boolean
}

export interface LensTaskRow {
  kind: "task"
  id: string
  name: string
  fn: string
  task: Task
  depth: number
  phase: LensPhase
  /** Position among the leaf tasks, in run order. */
  order: number
  op: StepOp | null
  resource: ResourceRef | null
  /** A `filter`: halts the run when its condition does not hold. */
  gate: boolean
  conditional: boolean
  terminal: boolean
  haltOnFailure: boolean
  writes: string[]
}

export type LensRow = LensGroupRow | LensTaskRow

export interface LensSection {
  phase: LensPhase
  rows: LensRow[]
}

const hasCondition = (c: unknown) => c !== undefined && c !== null && c !== true

/**
 * The step tree as lens rows: one section for a loop's `setup`, one for its
 * body, or a single `main` section without a loop. Task groups become a row
 * of their own with their members one level deeper.
 */
export function lensSections(
  workflow: Pick<Workflow, "tasks" | "loop">,
  pluginOf?: PluginOf,
): LensSection[] {
  const pluginFunctions = pluginOf ? new Set(pluginOf.keys()) : undefined
  let order = 0
  const walk = (list: Step[], depth: number, phase: LensPhase, rows: LensRow[]) => {
    for (const step of list) {
      if (!step) continue
      if (isTaskGroup(step)) {
        rows.push({
          kind: "group",
          id: step.id,
          name: step.name ?? "",
          depth,
          phase,
          conditional: hasCondition(step.condition),
          terminal: step.terminal === true,
        })
        walk(groupMembers(step), depth + 1, phase, rows)
        continue
      }
      const fn = step.function?.name ?? ""
      rows.push({
        kind: "task",
        id: step.id,
        name: step.name ?? "",
        fn,
        task: step,
        depth,
        phase,
        order: order++,
        op: classifyOp(fn, pluginFunctions),
        resource: stepResource(step, pluginOf),
        gate: fn === "filter",
        conditional: hasCondition(step.condition),
        terminal: step.terminal === true,
        haltOnFailure: step.halt_on === "failure",
        writes: declaredWrites(step),
      })
    }
  }
  const tasks = Array.isArray(workflow.tasks) ? workflow.tasks : []
  if (!workflow.loop) {
    const rows: LensRow[] = []
    walk(tasks, 0, "main", rows)
    return [{ phase: "main", rows }]
  }
  const setup: LensRow[] = []
  const body: LensRow[] = []
  walk(Array.isArray(workflow.loop.setup) ? workflow.loop.setup : [], 0, "setup", setup)
  walk(tasks, 0, "body", body)
  return [
    ...(setup.length ? [{ phase: "setup" as const, rows: setup }] : []),
    { phase: "body", rows: body },
  ]
}

export const taskRows = (sections: LensSection[]): LensTaskRow[] =>
  sections.flatMap((s) => s.rows.filter((r): r is LensTaskRow => r.kind === "task"))

/** `temp_data.plan` for `{"var": "temp_data.plan"}`; a short phrase otherwise. */
export function loopOverLabel(loop: WorkflowLoop | undefined): string | null {
  if (!loop || loop.over === undefined || loop.over === null) return null
  const over = loop.over
  if (typeof over === "string") return over
  if (isObject(over) && "var" in over) {
    const v = over.var
    if (typeof v === "string") return v
    if (Array.isArray(v) && typeof v[0] === "string") return v[0]
  }
  return "an expression"
}

/** The section heading: `loop.setup · once per run`, `loop body · per element of temp_data.plan`. */
export function sectionLabel(phase: LensPhase, loop: WorkflowLoop | undefined): { title: string; detail: string } {
  if (phase === "setup") return { title: "loop.setup", detail: "once per run" }
  if (phase === "body") {
    const over = loopOverLabel(loop)
    if (over) return { title: "loop body", detail: `per element of ${over}` }
    const max = typeof loop?.max === "number" ? `, at most ${loop.max} times` : ""
    return { title: "loop body", detail: `repeats while the workflow condition holds${max}` }
  }
  return { title: "", detail: "" }
}

// ---------------------------------------------------------------------------
// Resources (the dependency map and the matrix columns)
// ---------------------------------------------------------------------------

export interface ResourceColumn {
  key: string
  ref: ResourceRef
  /** How many steps do each op to it. */
  ops: Partial<Record<StepOp, number>>
  /** Step ids that touch it, in run order. */
  steps: string[]
}

const OP_ORDER: StepOp[] = ["read", "write", "incr", "call", "publish", "send", "presign", "infer"]

/** One column per resource, in the order a run first touches it. */
export function resourceColumns(sections: LensSection[]): ResourceColumn[] {
  const out = new Map<string, ResourceColumn>()
  for (const row of taskRows(sections)) {
    if (!row.resource) continue
    const key = resourceKey(row.resource)
    const col = out.get(key) ?? { key, ref: row.resource, ops: {}, steps: [] }
    const op = row.op ?? "call"
    col.ops[op] = (col.ops[op] ?? 0) + 1
    col.steps.push(row.id)
    out.set(key, col)
  }
  return [...out.values()]
}

/**
 * Adds what the server's dependency walk found and the rows did not — a
 * connector named under a key this client does not read, say. Such a column
 * has ops but no steps: the server says it is used, not by which step.
 */
export function mergeServerResources(
  columns: ResourceColumn[],
  server: { connectors?: { connector: string; function: string }[]; plugins?: { id: string; functions: string[] }[] } | null | undefined,
): ResourceColumn[] {
  if (!server) return columns
  const out = [...columns]
  const has = new Set(columns.map((c) => c.key))
  for (const dep of server.connectors ?? []) {
    const key = resourceKey({ kind: "connector", name: dep.connector })
    if (has.has(key)) continue
    const op = classifyOp(dep.function) ?? "call"
    out.push({ key, ref: { kind: "connector", name: dep.connector }, ops: { [op]: 1 }, steps: [] })
    has.add(key)
  }
  for (const p of server.plugins ?? []) {
    const key = resourceKey({ kind: "plugin", name: p.id })
    if (has.has(key)) continue
    out.push({ key, ref: { kind: "plugin", name: p.id }, ops: { call: Math.max(1, p.functions.length) }, steps: [] })
    has.add(key)
  }
  return out
}

/** `3 read · 1 write`. */
export function formatOps(ops: Partial<Record<StepOp, number>>): string {
  return OP_ORDER.filter((op) => (ops[op] ?? 0) > 0)
    .map((op) => `${ops[op]} ${op}`)
    .join(" · ")
}

/** The op a resource is mostly used for — what colours its edge. */
export function dominantOp(ops: Partial<Record<StepOp, number>>): StepOp {
  let best: StepOp = "call"
  let n = -1
  for (const op of OP_ORDER) {
    const v = ops[op] ?? 0
    if (v > n) {
      best = op
      n = v
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/** What `useWorkflowCost` measures, as far as the lens needs it. */
export interface CostInput {
  runs: number
  meanMs: number | null
  p95Ms: number | null
  tasks: ReadonlyMap<string, { runs: number; meanMs: number | null; p95Ms: number | null }>
  overheadMs: number | null
}

export interface CostCell {
  runs: number
  meanMs: number | null
  p95Ms: number | null
  /** Mean time this step adds to a run: mean × its runs per workflow run. */
  perRunMs: number | null
  /** perRunMs as a share of the mean run. */
  sharePct: number | null
}

export interface CostView {
  runs: number
  meanMs: number | null
  p95Ms: number | null
  cells: Map<string, CostCell>
  overheadMs: number | null
  overheadPct: number | null
  /** The step with the largest share, when it has one. */
  dominant: string | null
  /** Most times a body step ran — the loop's iterations — or null without a loop. */
  iterations: number | null
}

export function costView(sections: LensSection[], cost: CostInput): CostView {
  const cells = new Map<string, CostCell>()
  const runs = cost.runs
  const mean = cost.meanMs
  let dominant: string | null = null
  let best = 0
  let iterations: number | null = null
  for (const row of taskRows(sections)) {
    const t = cost.tasks.get(row.id)
    const tRuns = t?.runs ?? 0
    const perRunMs = t?.meanMs != null && runs > 0 ? t.meanMs * (tRuns / runs) : null
    const sharePct = perRunMs != null && mean != null && mean > 0 ? (perRunMs / mean) * 100 : null
    cells.set(row.id, { runs: tRuns, meanMs: t?.meanMs ?? null, p95Ms: t?.p95Ms ?? null, perRunMs, sharePct })
    if (sharePct != null && sharePct > best) {
      best = sharePct
      dominant = row.id
    }
    if (row.phase === "body" && t) iterations = Math.max(iterations ?? 0, tRuns)
  }
  return {
    runs,
    meanMs: mean,
    p95Ms: cost.p95Ms,
    cells,
    overheadMs: cost.overheadMs,
    overheadPct: cost.overheadMs != null && mean != null && mean > 0 ? (cost.overheadMs / mean) * 100 : null,
    dominant,
    iterations,
  }
}

/** `<0.01 ms`, `5.49 ms`, `88.4 ms`, `129 ms`, `1.24 s`. */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—"
  if (ms < 0.01) return "<0.01 ms"
  if (ms < 10) return `${ms.toFixed(2)} ms`
  if (ms < 100) return `${ms.toFixed(1)} ms`
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

/** `68%`, `3.5%`, `<0.1%`. */
export function formatPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—"
  if (pct < 0.1) return "<0.1%"
  if (pct < 10) return `${pct.toFixed(1)}%`
  return `${Math.round(pct)}%`
}

// ---------------------------------------------------------------------------
// Last run
// ---------------------------------------------------------------------------

export type RunStatus = "ok" | "failed" | "skipped" | "not-reached"

export interface RunCell {
  status: RunStatus
  /** Summed over every time the step ran (a loop body runs per iteration). */
  durationUs: number | null
  executions: number
  /** Paths it wrote, from the trace's `changes`. */
  changes: string[]
}

/** A trace laid over the rows. A task the trace never mentions was not reached. */
export function runOverlay(sections: LensSection[], timeline: Timeline): Map<string, RunCell> {
  const out = new Map<string, RunCell>()
  for (const row of taskRows(sections)) {
    out.set(row.id, { status: "not-reached", durationUs: null, executions: 0, changes: [] })
  }
  for (const s of timeline.steps) {
    const cell = out.get(s.taskId)
    if (!cell) continue
    if (s.outcome === "failed") cell.status = "failed"
    else if (s.outcome === "ok" && cell.status !== "failed") cell.status = "ok"
    else if (s.outcome === "skipped" && cell.status === "not-reached") cell.status = "skipped"
    if (s.outcome !== "skipped") {
      cell.executions++
      if (s.durationUs != null) cell.durationUs = (cell.durationUs ?? 0) + s.durationUs
    }
    for (const c of s.changes) if (!cell.changes.includes(c.path)) cell.changes.push(c.path)
  }
  return out
}

// ---------------------------------------------------------------------------
// Read-outs
// ---------------------------------------------------------------------------

/** A run of text, with `code` for identifiers and `b` for the point of the sentence. */
export type Seg = string | { code: string } | { b: string }

export interface Insight {
  tone: "info" | "warn" | "bad"
  segs: Seg[]
}

/** The read-out as plain text — for a `title`, and for tests. */
export function insightText(i: Insight): string {
  return i.segs.map((s) => (typeof s === "string" ? s : "code" in s ? s.code : s.b)).join("")
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** `3 reads and 1 write` — how a resource is used, as prose. */
function opsPhrase(ops: Partial<Record<StepOp, number>>): string {
  const parts = OP_ORDER.filter((op) => (ops[op] ?? 0) > 0).map((op) => {
    const n = ops[op]!
    const noun: Record<StepOp, [string, string]> = {
      read: ["read", "reads"],
      write: ["write", "writes"],
      incr: ["increment", "increments"],
      call: ["call", "calls"],
      publish: ["publish", "publishes"],
      send: ["send", "sends"],
      presign: ["presign", "presigns"],
      infer: ["inference", "inferences"],
    }
    return `${n} ${n === 1 ? noun[op][0] : noun[op][1]}`
  })
  if (parts.length <= 1) return parts.join("")
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

const resourceLabel = (r: ResourceRef) => (r.dynamic ? `a ${r.kind} ${r.name}` : r.name)

export interface DepsContext {
  sections: LensSection[]
  columns: ResourceColumn[]
  workflowId: string
  workflowName: string
  /** Active workflows calling each plugin (`plugins/{id}/dependencies`); absent while unknown. */
  pluginUsers?: ReadonlyMap<string, string[]>
  pluginVersions?: ReadonlyMap<string, number>
  /** Channels referencing each connector, from the entity index. */
  connectorUsers?: ReadonlyMap<string, number>
  cost?: CostView | null
}

export function depsInsights(ctx: DepsContext): Insight[] {
  const out: Insight[] = []
  const rows = taskRows(ctx.sections)

  // 1. The last external step after a side-effecting write: what a retry re-runs.
  const external = rows.filter((r) => r.resource)
  const last = external[external.length - 1]
  if (last) {
    const writes = external.filter((r) => r.order < last.order && r.op && SIDE_EFFECT_OPS.has(r.op))
    const w = writes[writes.length - 1]
    if (w && w.resource) {
      const isLast = last.order === rows[rows.length - 1]?.order
      const col = ctx.columns.find((c) => c.key === resourceKey(last.resource!))
      const uses = col ? col.steps.length : 1
      out.push({
        tone: "warn",
        segs: [
          { b: resourceLabel(last.resource!) },
          ` is used ${uses === 1 ? "once, " : ""}by `,
          isLast ? "the last step, " : "",
          { code: last.id },
          ", after ",
          { code: w.id },
          ` has written to ${resourceLabel(w.resource)}. When ${resourceLabel(last.resource!)} fails, that write has already happened, and a retry has to tolerate making it again.`,
        ],
      })
    }
  }

  // 2. Plugins: who else a failed load or an archive would reach.
  for (const col of ctx.columns) {
    if (col.ref.kind !== "plugin") continue
    const users = ctx.pluginUsers?.get(col.ref.name)
    if (!users) continue
    const v = ctx.pluginVersions?.get(col.ref.name)
    const name = `${col.ref.name}${v != null ? ` v${v}` : ""}`
    const others = users.filter((u) => u !== ctx.workflowId)
    if (others.length === 0) {
      out.push({
        tone: "info",
        segs: [
          { b: name },
          ` serves only this workflow. Archiving it affects nothing else, and a failed plugin load quarantines only ${ctx.workflowName}.`,
        ],
      })
    } else {
      out.push({
        tone: "info",
        segs: [
          { b: name },
          ` is also called by ${plural(others.length, "other active workflow")}. A failed plugin load quarantines all of them, and archiving it is refused while they call it.`,
        ],
      })
    }
    break
  }

  // 3. The most-shared connector: what an outage of it takes down.
  if (ctx.connectorUsers) {
    let top: ResourceColumn | null = null
    let topUsers = 0
    for (const col of ctx.columns) {
      if (col.ref.kind !== "connector") continue
      const n = ctx.connectorUsers.get(col.ref.name) ?? 0
      if (n > topUsers) {
        top = col
        topUsers = n
      }
    }
    if (top && topUsers > 1) {
      const segs: Seg[] = [
        { b: top.ref.name },
        ` is shared by ${plural(topUsers, "channel")}; this workflow makes ${opsPhrase(top.ops)} to it.`,
      ]
      // The step that would feel it first: its heaviest user here.
      let heaviest: string | null = null
      let heaviestMs = 0
      for (const id of top.steps) {
        const ms = ctx.cost?.cells.get(id)?.meanMs ?? 0
        if (ms > heaviestMs) {
          heaviest = id
          heaviestMs = ms
        }
      }
      if (heaviest) segs.push(` A slow ${top.ref.name} shows up first in `, { code: heaviest }, ", its heaviest step here.")
      out.push({ tone: "info", segs })
    }
  }

  return out.slice(0, 3)
}

export function costInsights(sections: LensSection[], view: CostView): Insight[] {
  const out: Insight[] = []
  const rows = taskRows(sections)
  if (view.runs === 0 || view.meanMs == null) return out

  // 1. The dominant step.
  if (view.dominant) {
    const c = view.cells.get(view.dominant)!
    const share = c.sharePct ?? 0
    const segs: Seg[] = [
      { b: `${view.dominant} is ${formatPct(share)} of a typical run` },
      ` (${formatMs(c.perRunMs)} of ${formatMs(view.meanMs)}).`,
    ]
    if (c.p95Ms != null) segs.push(` Its p95 is ${formatMs(c.p95Ms)}`)
    if (c.p95Ms != null && view.p95Ms != null) segs.push(`, against ${formatMs(view.p95Ms)} for the whole run.`)
    else if (c.p95Ms != null) segs.push(".")
    out.push({ tone: share >= 30 ? "warn" : "info", segs })
  }

  // 2. The writes: what a run's stored effect costs, weighted by how often it runs.
  const writes = rows.filter((r) => r.op === "write" && view.cells.get(r.id)?.perRunMs != null)
  if (writes.length > 0 && writes[0].id !== view.dominant) {
    const w = writes[0]
    const c = view.cells.get(w.id)!
    const only = writes.length === 1 ? ", the only write," : ""
    const segs: Seg[] = [{ code: w.id }, `${only} costs ${formatMs(c.perRunMs)} per run on average`]
    if (w.phase === "body" && c.meanMs != null && view.runs > 0) {
      segs.push(`: ${formatMs(c.meanMs)} per iteration × ${(c.runs / view.runs).toFixed(2)} iterations per run.`)
    } else segs.push(".")
    out.push({ tone: "info", segs })
  }

  // 3. The engine's own time, and the gates that cost nothing.
  if (view.overheadMs != null) {
    const gates = rows.filter((r) => r.gate)
    const freeGates = gates.filter((r) => (view.cells.get(r.id)?.meanMs ?? 0) < 0.05)
    const segs: Seg[] = [`Engine overhead is ${formatMs(view.overheadMs)} (${formatPct(view.overheadPct)}): conditions, loop bookkeeping and audit between steps.`]
    if (gates.length > 0 && freeGates.length === gates.length) {
      segs.push(gates.length === 1 ? " The filter costs nothing measurable." : ` The ${gates.length} filters cost nothing measurable.`)
    }
    out.push({ tone: "info", segs })
  }
  return out.slice(0, 3)
}

/** `11,600×` — a ratio rounded to what a person can compare. */
export function formatRatio(r: number): string {
  if (r < 0.1) return "<0.1×"
  if (r < 10) return `${r.toFixed(1)}×`
  if (r < 100) return `${Math.round(r)}×`
  return `${Number(r.toPrecision(3)).toLocaleString("en")}×`
}

export function runInsights(
  sections: LensSection[],
  overlay: ReadonlyMap<string, RunCell>,
  timeline: Timeline,
  cost: CostView | null,
  error?: string | null,
): Insight[] {
  const out: Insight[] = []
  const failedId = timeline.failed?.taskId ?? null
  const ok = timeline.steps.filter((s) => s.outcome === "ok")
  const okUs = ok.reduce((a, s) => a + (s.durationUs ?? 0), 0)
  const p95Of = (id: string) => cost?.cells.get(id)?.p95Ms ?? null
  const over = ok.filter((s) => {
    const p95 = p95Of(s.taskId)
    return p95 != null && s.durationUs != null && s.durationUs > p95 * 1000
  })
  const judged = ok.filter((s) => p95Of(s.taskId) != null).length

  // 1. The healthy part of the run, against normal.
  if (ok.length > 0) {
    const segs: Seg[] = [`${plural(ok.length, "step")} ran in ${formatMicros(okUs)}`]
    if (judged > 0 && over.length === 0) segs.push(ok.length === 1 ? ", inside its p95." : ", each inside its p95.")
    else if (over.length > 0) {
      const worst = over.reduce((a, b) =>
        a.durationUs! / (p95Of(a.taskId)! * 1000) >= b.durationUs! / (p95Of(b.taskId)! * 1000) ? a : b,
      )
      segs.push(`; ${over.length === 1 ? "one was" : `${over.length} were`} over its p95, worst `, { code: worst.taskId }, ` at ${formatRatio(worst.durationUs! / (p95Of(worst.taskId)! * 1000))}.`)
    } else segs.push(".")
    out.push({ tone: over.length > 0 ? "warn" : "info", segs })
  }

  // 2. The failure.
  if (timeline.failed) {
    const f = timeline.failed
    const p95 = p95Of(failedId!)
    const segs: Seg[] = ["The run then spent ", { b: `${formatMicros(f.durationUs)} in ${f.taskId}` }]
    if (p95 != null && f.durationUs != null) segs.push(`, about ${formatRatio(f.durationUs / (p95 * 1000))} its p95,`)
    segs.push(" before it failed")
    const reason = error ? error.replace(/^[A-Z_]+:\s*/, "").replace(/^Task \S+ error:\s*/, "") : ""
    segs.push(reason ? `: ${reason}` : ".")
    const unreached = [...overlay.values()].filter((c) => c.status === "not-reached").length
    if (unreached > 0) segs.push(` ${plural(unreached, "step")} after it ${unreached === 1 ? "was" : "were"} not reached.`)
    out.push({ tone: "bad", segs })
  } else {
    const skipped = [...overlay.values()].filter((c) => c.status === "skipped").length
    const unreached = taskRows(sections).filter((r) => overlay.get(r.id)?.status === "not-reached")
    if (unreached.length > 0) {
      const halter = [...timeline.steps].reverse().find((s) => s.outcome === "ok")
      out.push({
        tone: "info",
        segs: [
          `${plural(unreached.length, "step")} ${unreached.length === 1 ? "was" : "were"} not reached`,
          ...(halter ? [" — the run ended after ", { code: halter.taskId } as Seg, " (a filter or terminal step halts it)."] : ["."]),
        ],
      })
    } else if (skipped > 0) {
      out.push({ tone: "info", segs: [`${plural(skipped, "step")} skipped on ${skipped === 1 ? "its" : "their"} condition.`] })
    }
  }
  return out.slice(0, 3)
}

/** Whether a step changes something outside the message. */
export const isSideEffect = (row: Pick<LensTaskRow, "op">) => !!row.op && SIDE_EFFECT_OPS.has(row.op)
