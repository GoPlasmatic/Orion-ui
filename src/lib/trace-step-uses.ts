import type { Timeline, TimelineStep } from "@/lib/trace-timeline"
import {
  RETRY_EFFECT_LABEL,
  isRetryRisk,
  isWrite,
  stepEffect,
  type FunctionIndex,
  type StepEffect,
  type StepResource,
} from "@/lib/function-effects"
import { formatRatio } from "@/lib/traffic-encoding"

/**
 * How the trace timeline words a step's effect, against its baseline, and
 * what a retry would repeat. The effect itself is `stepEffect`'s; this only
 * says it.
 */

/** `soma-db`, `tb.pairing v2`, `(computed connector)`. */
export function resourceLabel(r: StepResource): string {
  if (!r.name) return `(computed ${r.kind})`
  return r.kind === "plugin" && r.version != null ? `${r.name} v${r.version}` : r.name
}

/** One line for the "uses" column: `incr soma-cache`, `halts the run`, `in memory`. */
export function effectLabel(effect: StepEffect | null): string {
  if (!effect) return "—"
  if (effect.gate) return "halts the run"
  if (effect.resource) return `${effect.op} ${resourceLabel(effect.resource)}`
  return effect.op === "compute" ? "in memory" : effect.op
}

/** What a second run does, with the deciding input when the client could not resolve it. */
export function retryLabel(effect: StepEffect): string {
  const base = RETRY_EFFECT_LABEL[effect.retry]
  return effect.retry === "unknown" && effect.decidedBy ? `${base} (${effect.decidedBy})` : base
}

export interface VsP95 {
  ratio: number | null
  text: string
  /** Ten times the p95 or more — rendered in destructive ink. */
  severe: boolean
}

/** A step's duration over its task's p95 from metrics: `0.3×`, `<0.1×`, `11,600×`. */
export function vsP95(durationUs: number | null, p95Ms: number | null | undefined): VsP95 {
  if (durationUs == null || p95Ms == null || !(p95Ms > 0)) return { ratio: null, text: "—", severe: false }
  const ratio = durationUs / (p95Ms * 1000)
  return { ratio, text: formatRatio(ratio), severe: ratio >= 10 }
}

/** How many of `steps` ran past their task's p95, out of those with a baseline. */
export function overP95(
  steps: TimelineStep[],
  p95MsOf: (taskId: string) => number | null | undefined,
): { judged: number; over: number } {
  let judged = 0
  let over = 0
  for (const s of steps) {
    const p95 = p95MsOf(s.taskId)
    if (s.durationUs == null || p95 == null || !(p95 > 0)) continue
    judged++
    if (s.durationUs > p95 * 1000) over++
  }
  return { judged, over }
}

export interface PriorWrite {
  step: TimelineStep
  effect: StepEffect
  /** True when a second run may repeat the effect (`isRetryRisk`). */
  risk: boolean
  /** Microseconds between this write finishing and the failing step starting. */
  gapUs: number | null
}

/**
 * Steps that completed before `failed` and changed state outside the message
 * — a retry starts the workflow from the top, so they run again. A
 * `depends_on` function is judged by its own input (an `http_call` GET is a
 * read, not a write). Empty until the catalogue has loaded, since without it
 * every unknown function would read as a possible write.
 */
export function writesBefore(timeline: Timeline, failed: TimelineStep, index: FunctionIndex): PriorWrite[] {
  if (index.size === 0) return []
  const out: PriorWrite[] = []
  for (const s of timeline.steps) {
    if (s.index >= failed.index) break
    if (s.outcome !== "ok" || !s.task) continue
    const effect = stepEffect(s.task, index)
    if (!isWrite(effect)) continue
    const end = s.startUs != null && s.durationUs != null ? s.startUs + s.durationUs : null
    out.push({
      step: s,
      effect,
      risk: isRetryRisk(effect),
      gapUs: end != null && failed.startUs != null ? Math.max(0, failed.startUs - end) : null,
    })
  }
  return out
}
