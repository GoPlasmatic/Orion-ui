import type { Step, Task, Workflow } from "@/api/types"
import {
  isRetryRisk,
  isWrite,
  stepEffect,
  type FunctionIndex,
  type StepEffect,
  type StepOp,
  type StepResource,
} from "@/lib/function-effects"
import { parseEngineError } from "@/lib/trace-error"
import { formatMicros, type StepPhase, type Timeline } from "@/lib/trace-timeline"
import { formatMs, formatPct, formatRatio } from "@/lib/traffic-encoding"
import { plural } from "@/lib/utils"
import { groupMembers, isObject, isTaskGroup, loopBinding } from "@/lib/workflow-steps"

/**
 * The workflow page's four lenses over one step tree.
 *
 * *Structure* is the dataflow-ui visualizer. The other three share the rows
 * built here — `workflowSteps` order, so a loop's `setup` comes first, then
 * the body — and each adds columns: what a step touches (*Dependencies*), what
 * it costs in a steady-state run (*Cost*) and what it did in one trace
 * (*Last run*). What a step touches and whether a retry repeats it come from
 * `lib/function-effects` (the catalogue's answer), so this page and the retry
 * guard cannot disagree. Everything here is pure, so the read-outs under each
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
// Rows
// ---------------------------------------------------------------------------

/** How a chip reads: a read, a write a retry may repeat, neutral, or a filter. */
export type EffectTone = "read" | "write" | "neutral" | "gate"

const READ_VERBS = new Set(["read", "get", "head", "options", "infer", "presign"])

export function effectTone(e: Pick<StepEffect, "gate" | "retry" | "op" | "resource">): EffectTone {
  if (e.gate) return "gate"
  if (e.retry === "read") return "read"
  if (e.retry === "unsafe_write" || e.retry === "idempotent_write") return "write"
  if (e.retry === "pure") return "neutral"
  // Unknown (a computed deciding input, or the catalogue not loaded yet): the
  // verb is the best guess left, and anything touching a resource may write.
  if (READ_VERBS.has(e.op)) return "read"
  return e.resource ? "write" : "neutral"
}

export interface LensGroupRow {
  kind: "group"
  id: string
  name: string
  depth: number
  phase: StepPhase
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
  phase: StepPhase
  /** Position among the leaf tasks, in run order. */
  order: number
  /** What it touches and what a retry repeats — `lib/function-effects`. */
  effect: StepEffect
  conditional: boolean
  terminal: boolean
  haltOnFailure: boolean
  writes: string[]
}

export type LensRow = LensGroupRow | LensTaskRow

export interface LensSection {
  phase: StepPhase
  rows: LensRow[]
}

const hasCondition = (c: unknown) => c !== undefined && c !== null && c !== true

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

/**
 * The step tree as lens rows: one section for a loop's `setup`, one for its
 * body, or a single `main` section without a loop. Task groups become a row
 * of their own with their members one level deeper. Pass the catalogue index
 * whenever it is loaded — it is what recognises a plugin's functions.
 */
export function lensSections(workflow: Pick<Workflow, "tasks" | "loop">, index?: FunctionIndex): LensSection[] {
  let order = 0
  const walk = (list: Step[], depth: number, phase: StepPhase, rows: LensRow[]) => {
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
      rows.push({
        kind: "task",
        id: step.id,
        name: step.name ?? "",
        fn: step.function?.name ?? "",
        task: step,
        depth,
        phase,
        order: order++,
        effect: stepEffect(step, index),
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
  return [...(setup.length ? [{ phase: "setup" as const, rows: setup }] : []), { phase: "body", rows: body }]
}

export const taskRows = (sections: LensSection[]): LensTaskRow[] =>
  sections.flatMap((s) => s.rows.filter((r): r is LensTaskRow => r.kind === "task"))

/** The section heading: `loop.setup · once per run`, `loop body · per element of temp_data.plan`. */
export function sectionLabel(phase: StepPhase, workflow: Pick<Workflow, "loop">): { title: string; detail: string } {
  if (phase === "setup") return { title: "loop.setup", detail: "once per run" }
  if (phase === "body") {
    const binding = loopBinding(workflow)
    if (binding) return { title: "loop body", detail: `per element of ${binding.over}, as ${binding.as}` }
    const loop = workflow.loop
    if (loop?.over != null) return { title: "loop body", detail: "per element of a computed list" }
    const max = typeof loop?.max === "number" ? `, at most ${loop.max} times` : ""
    return { title: "loop body", detail: `repeats while the workflow condition holds${max}` }
  }
  return { title: "", detail: "" }
}

// ---------------------------------------------------------------------------
// Resources (the dependency map and the matrix columns)
// ---------------------------------------------------------------------------

/** `connector:soma-db`; a target computed per message keys as `channel:(computed)`. */
export const resourceKey = (r: Pick<StepResource, "kind" | "name">) => `${r.kind}:${r.name ?? "(computed)"}`

export interface ResourceColumn {
  key: string
  ref: StepResource
  /** How many steps use it for each verb, in first-use order. */
  ops: Record<string, number>
  /** The loudest tone among its uses — what colours its edge. */
  tone: EffectTone
  /** Step ids that touch it, in run order. */
  steps: string[]
}

const TONE_RANK: Record<EffectTone, number> = { gate: 0, neutral: 1, read: 2, write: 3 }

function addUse(out: Map<string, ResourceColumn>, ref: StepResource, op: StepOp, tone: EffectTone, step?: string) {
  const key = resourceKey(ref)
  const col = out.get(key) ?? { key, ref, ops: {}, tone, steps: [] }
  col.ops[op] = (col.ops[op] ?? 0) + 1
  if (TONE_RANK[tone] > TONE_RANK[col.tone]) col.tone = tone
  if (step) col.steps.push(step)
  out.set(key, col)
}

/** One column per resource, in the order a run first touches it. */
export function resourceColumns(sections: LensSection[]): ResourceColumn[] {
  const out = new Map<string, ResourceColumn>()
  for (const row of taskRows(sections)) {
    if (row.effect.resource) addUse(out, row.effect.resource, row.effect.op, effectTone(row.effect), row.id)
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
  server:
    | { connectors?: { connector: string; function: string }[]; plugins?: { id: string; version: number; functions: string[] }[] }
    | null
    | undefined,
  index?: FunctionIndex,
): ResourceColumn[] {
  if (!server) return columns
  const out = new Map(columns.map((c) => [c.key, c]))
  for (const dep of server.connectors ?? []) {
    const ref: StepResource = { kind: "connector", name: dep.connector, dynamic: false }
    if (out.has(resourceKey(ref))) continue
    const e = stepEffect({ function: { name: dep.function, input: { connector: dep.connector } } }, index)
    addUse(out, ref, e.op, effectTone(e))
  }
  for (const p of server.plugins ?? []) {
    const ref: StepResource = { kind: "plugin", name: p.id, dynamic: false, version: p.version }
    if (!out.has(resourceKey(ref))) addUse(out, ref, "call", "neutral")
  }
  return [...out.values()]
}

/** `3 read · 1 write`. */
export function formatOps(ops: Record<string, number>): string {
  return Object.entries(ops)
    .filter(([, n]) => n > 0)
    .map(([op, n]) => `${n} ${op}`)
    .join(" · ")
}

const NOUNS: Record<string, [string, string]> = {
  read: ["read", "reads"],
  write: ["write", "writes"],
  delete: ["delete", "deletes"],
  incr: ["increment", "increments"],
  call: ["call", "calls"],
  publish: ["publish", "publishes"],
  send: ["send", "sends"],
  infer: ["inference", "inferences"],
}

/** `3 reads and 1 write` — how a resource is used, as prose. */
function opsPhrase(ops: Record<string, number>): string {
  const parts = Object.entries(ops)
    .filter(([, n]) => n > 0)
    .map(([op, n]) => (NOUNS[op] ? plural(n, NOUNS[op][0], NOUNS[op][1]) : `${n} × ${op}`))
  if (parts.length <= 1) return parts.join("")
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
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

/** The read-out as plain text — for a key, a `title`, and tests. */
export function insightText(i: Insight): string {
  return i.segs.map((s) => (typeof s === "string" ? s : "code" in s ? s.code : s.b)).join("")
}

const resourceLabel = (r: StepResource) => r.name ?? `a ${r.kind} computed per message`

export interface DepsContext {
  sections: LensSection[]
  columns: ResourceColumn[]
  workflowId: string
  workflowName: string
  /** Active workflows calling each plugin (`plugins/{id}/dependencies`); absent while unknown. */
  pluginUsers?: ReadonlyMap<string, string[]>
  /** Channels referencing each connector, from the entity index. */
  connectorUsers?: ReadonlyMap<string, number>
  cost?: CostView | null
}

export function depsInsights(ctx: DepsContext): Insight[] {
  const out: Insight[] = []
  const rows = taskRows(ctx.sections)

  // 1. The last external step after a write a retry would repeat. The same
  //    rule as the retry guard: `isRetryRisk` on the write, from the catalogue.
  const external = rows.filter((r) => r.effect.resource)
  const last = external[external.length - 1]
  if (last) {
    const writes = external.filter((r) => r.order < last.order && isWrite(r.effect) && isRetryRisk(r.effect))
    const w = writes[writes.length - 1]
    if (w) {
      const res = last.effect.resource!
      const isLast = last.order === rows[rows.length - 1]?.order
      const uses = ctx.columns.find((c) => c.key === resourceKey(res))?.steps.length ?? 1
      out.push({
        tone: "warn",
        segs: [
          { b: resourceLabel(res) },
          ` is used ${uses === 1 ? "once, " : ""}by `,
          isLast ? "the last step, " : "",
          { code: last.id },
          ", after ",
          { code: w.id },
          ` has written to ${resourceLabel(w.effect.resource!)}. When ${resourceLabel(res)} fails, that write has already happened, and a retry has to tolerate making it again.`,
        ],
      })
    }
  }

  // 2. Plugins: who else a failed load or an archive would reach.
  for (const col of ctx.columns) {
    if (col.ref.kind !== "plugin" || !col.ref.name) continue
    const users = ctx.pluginUsers?.get(col.ref.name)
    if (!users) continue
    const name = `${col.ref.name}${col.ref.version != null ? ` v${col.ref.version}` : ""}`
    const others = users.filter((u) => u !== ctx.workflowId)
    out.push({
      tone: "info",
      segs:
        others.length === 0
          ? [
              { b: name },
              ` serves only this workflow. Archiving it affects nothing else, and a failed plugin load quarantines only ${ctx.workflowName}.`,
            ]
          : [
              { b: name },
              ` is also called by ${plural(others.length, "other active workflow")}. A failed plugin load quarantines all of them, and archiving it is refused while they call it.`,
            ],
    })
    break
  }

  // 3. The most-shared connector: what an outage of it takes down.
  if (ctx.connectorUsers) {
    let top: ResourceColumn | null = null
    let topUsers = 0
    for (const col of ctx.columns) {
      if (col.ref.kind !== "connector" || !col.ref.name) continue
      const n = ctx.connectorUsers.get(col.ref.name) ?? 0
      if (n > topUsers) {
        top = col
        topUsers = n
      }
    }
    if (top && topUsers > 1) {
      const segs: Seg[] = [
        { b: top.ref.name! },
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
    if (c.p95Ms != null) {
      segs.push(` Its p95 is ${formatMs(c.p95Ms)}`)
      segs.push(view.p95Ms != null ? `, against ${formatMs(view.p95Ms)} for the whole run.` : ".")
    }
    out.push({ tone: share >= 30 ? "warn" : "info", segs })
  }

  // 2. The writes: what a run's side effects cost, weighted by how often they
  //    run. The costliest one is named; a filter on tone keeps a read whose
  //    retry safety is merely unknown out of it.
  const writes = rows
    .filter((r) => isWrite(r.effect) && effectTone(r.effect) === "write" && view.cells.get(r.id)?.perRunMs != null)
    .sort((a, b) => view.cells.get(b.id)!.perRunMs! - view.cells.get(a.id)!.perRunMs!)
  if (writes.length > 0 && writes[0].id !== view.dominant) {
    const w = writes[0]
    const c = view.cells.get(w.id)!
    const which = writes.length === 1 ? ", the only write," : `, the costliest of ${writes.length} writes,`
    const segs: Seg[] = [{ code: w.id }, `${which} costs ${formatMs(c.perRunMs)} per run on average`]
    if (w.phase === "body" && c.meanMs != null && view.runs > 0) {
      segs.push(`: ${formatMs(c.meanMs)} per iteration × ${(c.runs / view.runs).toFixed(2)} iterations per run.`)
    } else segs.push(".")
    out.push({ tone: "info", segs })
  }

  // 3. The engine's own time, and the gates that cost nothing.
  if (view.overheadMs != null) {
    const gates = rows.filter((r) => r.effect.gate)
    const free = gates.filter((r) => (view.cells.get(r.id)?.meanMs ?? 0) < 0.05)
    const segs: Seg[] = [
      `Engine overhead is ${formatMs(view.overheadMs)} (${formatPct(view.overheadPct)}): conditions, loop bookkeeping and audit between steps.`,
    ]
    if (gates.length > 0 && free.length === gates.length) {
      segs.push(gates.length === 1 ? " The filter costs nothing measurable." : ` The ${gates.length} filters cost nothing measurable.`)
    }
    out.push({ tone: "info", segs })
  }
  return out.slice(0, 3)
}

export function runInsights(
  sections: LensSection[],
  overlay: ReadonlyMap<string, RunCell>,
  timeline: Timeline,
  cost: CostView | null,
  error?: string | null,
): Insight[] {
  const out: Insight[] = []
  const ok = timeline.steps.filter((s) => s.outcome === "ok")
  const okUs = ok.reduce((a, s) => a + (s.durationUs ?? 0), 0)
  const p95Of = (id: string) => cost?.cells.get(id)?.p95Ms ?? null
  const ratio = (s: { taskId: string; durationUs: number | null }) => {
    const p95 = p95Of(s.taskId)
    return p95 != null && p95 > 0 && s.durationUs != null ? s.durationUs / (p95 * 1000) : null
  }
  const over = ok.filter((s) => (ratio(s) ?? 0) > 1)
  const judged = ok.filter((s) => ratio(s) != null).length

  // 1. The healthy part of the run, against normal.
  if (ok.length > 0) {
    const segs: Seg[] = [`${plural(ok.length, "step")} ran in ${formatMicros(okUs)}`]
    if (over.length > 0) {
      const worst = over.reduce((a, b) => (ratio(a)! >= ratio(b)! ? a : b))
      segs.push(
        `; ${over.length === 1 ? "one was" : `${over.length} were`} over its p95, worst `,
        { code: worst.taskId },
        ` at ${formatRatio(ratio(worst))}.`,
      )
    } else if (judged > 0) segs.push(ok.length === 1 ? ", inside its p95." : ", each inside its p95.")
    else segs.push(".")
    out.push({ tone: over.length > 0 ? "warn" : "info", segs })
  }

  // 2. The failure, or where the run stopped.
  const unreached = taskRows(sections).filter((r) => overlay.get(r.id)?.status === "not-reached").length
  if (timeline.failed) {
    const f = timeline.failed
    const r = ratio(f)
    const segs: Seg[] = ["The run then spent ", { b: `${formatMicros(f.durationUs)} in ${f.taskId}` }]
    if (r != null) segs.push(`, about ${formatRatio(r)} its p95,`)
    const cause = parseEngineError(error).cause
    segs.push(" before it failed", cause ? `: ${cause}` : ".")
    if (unreached > 0) segs.push(` ${plural(unreached, "step")} after it ${unreached === 1 ? "was" : "were"} not reached.`)
    out.push({ tone: "bad", segs })
  } else if (unreached > 0) {
    const halter = [...timeline.steps].reverse().find((s) => s.outcome === "ok")
    out.push({
      tone: "info",
      segs: [
        `${plural(unreached, "step")} ${unreached === 1 ? "was" : "were"} not reached`,
        ...(halter ? [" — the run ended after ", { code: halter.taskId } as Seg, " (a filter or terminal step halts it)."] : ["."]),
      ],
    })
  } else {
    const skipped = [...overlay.values()].filter((c) => c.status === "skipped").length
    if (skipped > 0) out.push({ tone: "info", segs: [`${plural(skipped, "step")} skipped on ${skipped === 1 ? "its" : "their"} condition.`] })
  }
  return out.slice(0, 3)
}
