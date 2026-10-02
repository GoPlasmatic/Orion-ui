import type { Timeline } from "@/lib/trace-timeline"
import { formatMicros } from "@/lib/trace-timeline"

/**
 * The time axis of a step timeline: microseconds from the trace's start to a
 * percentage of the lane.
 *
 * `linear` is the honest picture. When one step dwarfs the rest — an 8.1 s
 * hang beside ten steps that took 93 ms — a linear lane draws the ten as a
 * sliver, so `split` spreads the stretches around the dominant step across
 * most of the width and compresses the dominant step's interior behind a
 * hatched break. Each piece is linear on its own; only the joins jump.
 */

export type AxisMode = "split" | "linear"

export interface AxisSegment {
  fromUs: number
  toUs: number
  startPct: number
  endPct: number
  /** True for a stretch drawn larger than its linear share. */
  zoomed: boolean
}

export interface AxisTick {
  us: number
  pct: number
  label: string
  /** Which way the label runs from its tick: away from a break's hatch. */
  align: "start" | "center" | "end"
}

export interface TimeAxis {
  mode: AxisMode
  totalUs: number
  segments: AxisSegment[]
  /** Hatched gaps between segments, in percent. */
  breaks: { startPct: number; endPct: number }[]
  ticks: AxisTick[]
  /** Inner gridline positions, in percent (ticks without the two ends). */
  grid: number[]
  x: (us: number) => number
}

/** The dominant step must be this many times the rest of the run before split is the default. */
const SPLIT_RATIO = 20
const BREAK_PCT = 3
/** Width the compressed stretch keeps when there is a zoomed piece on each side. */
const MIDDLE_PCT = 22
/** Width the zoomed piece takes when it is the only one — the design's 60 %. */
const ZOOM_PCT = 60

const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

/** Smallest "round" number ≥ v: 98 449 → 100 000, 101 000 → 150 000. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 0
  const mag = 10 ** Math.floor(Math.log10(v))
  for (const n of NICE) if (n * mag >= v - 1e-9) return n * mag
  return 10 * mag
}

/** Largest "round" number ≤ v. */
export function niceFloor(v: number): number {
  if (!(v > 0)) return 0
  const mag = 10 ** Math.floor(Math.log10(v))
  let out = mag
  for (const n of NICE) if (n * mag <= v + 1e-9) out = n * mag
  return out
}

/** A tick spacing near `raw` from 1, 2, 2.5 and 5 × 10ⁿ. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  for (const n of [1, 2, 2.5, 5, 10]) if (n * mag >= raw) return n * mag
  return 10 * mag
}

/** `0`, `250 µs`, `25 ms`, `1.5 s` — a round tick value without trailing zeros. */
export function formatTick(us: number): string {
  if (us === 0) return "0"
  const trim = (n: number) => String(Number(n.toFixed(2)))
  if (us < 1000) return `${trim(us)} µs`
  if (us < 1_000_000) return `${trim(us / 1000)} ms`
  return `${trim(us / 1_000_000)} s`
}

/**
 * Whether split is worth offering, and whether it is the default: the
 * dominant step is more than `SPLIT_RATIO` times everything else in the run.
 */
export function splitAdvice(timeline: Timeline): { available: boolean; preferred: boolean } {
  const d = timeline.dominant
  if (!d || d.startUs == null || d.durationUs == null || timeline.totalUs <= 0) {
    return { available: false, preferred: false }
  }
  const rest = timeline.totalUs - d.durationUs
  const available = rest > 0 && d.durationUs > 0
  return { available, preferred: available && d.durationUs > SPLIT_RATIO * rest }
}

/** Whether any timed step starts after the dominant step has ended. */
function stepsAfterDominant(timeline: Timeline): boolean {
  const d = timeline.dominant
  if (!d || d.startUs == null || d.durationUs == null) return false
  const end = d.startUs + d.durationUs
  return timeline.steps.some((s) => s !== d && s.startUs != null && s.startUs >= end)
}

function piecewise(segments: AxisSegment[], totalUs: number) {
  return (us: number) => {
    const t = Math.min(Math.max(us, 0), totalUs)
    for (const s of segments) {
      if (t <= s.toUs || s === segments[segments.length - 1]) {
        const span = s.toUs - s.fromUs
        const f = span > 0 ? (t - s.fromUs) / span : 0
        return s.startPct + Math.min(Math.max(f, 0), 1) * (s.endPct - s.startPct)
      }
    }
    return 100
  }
}

function splitSegments(timeline: Timeline): AxisSegment[] | null {
  const d = timeline.dominant
  const total = timeline.totalUs
  if (!d || d.startUs == null || d.durationUs == null) return null
  const start = d.startUs
  const end = d.startUs + d.durationUs
  // The break lands on a round value just past the dominant step's start, so
  // everything before it — and the step's first moments — reads in the zoomed
  // piece.
  const b1 = start > 0 ? Math.min(niceCeil(start), end) : 0
  const after = stepsAfterDominant(timeline)
  const b2 = after ? Math.max(niceFloor(end), b1) : total

  if (b1 > 0 && after && b2 > b1 && b2 < total) {
    const pre = b1
    const post = total - b2
    const zoomPct = 100 - MIDDLE_PCT - 2 * BREAK_PCT
    const preW = Math.max(20, Math.min(zoomPct - 20, (zoomPct * pre) / (pre + post)))
    const postW = zoomPct - preW
    const m0 = preW + BREAK_PCT
    const m1 = m0 + MIDDLE_PCT
    return [
      { fromUs: 0, toUs: b1, startPct: 0, endPct: preW, zoomed: true },
      { fromUs: b1, toUs: b2, startPct: m0, endPct: m1, zoomed: false },
      { fromUs: b2, toUs: total, startPct: m1 + BREAK_PCT, endPct: m1 + BREAK_PCT + postW, zoomed: true },
    ]
  }
  if (b1 > 0 && b1 < total) {
    return [
      { fromUs: 0, toUs: b1, startPct: 0, endPct: ZOOM_PCT, zoomed: true },
      { fromUs: b1, toUs: total, startPct: ZOOM_PCT + BREAK_PCT, endPct: 100, zoomed: false },
    ]
  }
  // The dominant step opens the run: zoom what follows it instead.
  if (after && b2 > 0 && b2 < total) {
    return [
      { fromUs: 0, toUs: b2, startPct: 0, endPct: 100 - ZOOM_PCT - BREAK_PCT, zoomed: false },
      { fromUs: b2, toUs: total, startPct: 100 - ZOOM_PCT, endPct: 100, zoomed: true },
    ]
  }
  return null
}

/** Round values inside each segment, thinned so no two labels collide. */
function buildTicks(segments: AxisSegment[], x: (us: number) => number, totalUs: number): AxisTick[] {
  const raw: AxisTick[] = [{ us: 0, pct: 0, label: "0", align: "start" }]
  for (const s of segments) {
    const width = s.endPct - s.startPct
    const n = Math.max(1, Math.round(width / 15))
    const step = niceStep((s.toUs - s.fromUs) / n)
    const first = Math.ceil(s.fromUs / step) * step
    for (let us = first === 0 ? step : first; us <= s.toUs + 1e-6; us += step) {
      if (us >= totalUs) break
      raw.push({ us, pct: x(us), label: formatTick(us), align: "center" })
    }
    // The break value itself is worth naming even when it is not a multiple.
    if (s.toUs < totalUs && !raw.some((t) => t.us === s.toUs)) {
      raw.push({ us: s.toUs, pct: x(s.toUs), label: formatTick(s.toUs), align: "center" })
    }
  }
  raw.sort((a, b) => a.pct - b.pct)
  // A label centred on a break edge would sit on the hatch: one just before a
  // break runs leftwards from its tick, one just after runs rightwards.
  const EDGE = 3
  for (let i = 1; i < segments.length; i++) {
    const before = segments[i - 1].endPct
    const after = segments[i].startPct
    for (const t of raw) {
      if (t.pct > before - EDGE && t.pct <= before) t.align = "end"
      else if (t.pct >= after && t.pct < after + EDGE) t.align = "start"
      else if (t.pct > before && t.pct < after) t.align = "center"
    }
  }
  const end: AxisTick = { us: totalUs, pct: 100, label: formatMicros(totalUs), align: "end" }
  const MIN_GAP = 7
  const kept: AxisTick[] = []
  for (const t of raw) {
    if (100 - t.pct < MIN_GAP) continue
    const prev = kept[kept.length - 1]
    // An end-aligned label and the start-aligned one after the break point
    // away from each other, so they may sit closer.
    const gap = prev && prev.align === "end" && t.align === "start" ? 2 : MIN_GAP
    if (prev && t.pct - prev.pct < gap) continue
    kept.push(t)
  }
  kept.push(end)
  return kept
}

export function buildAxis(timeline: Timeline, mode: AxisMode): TimeAxis {
  const totalUs = Math.max(1, timeline.totalUs)
  const split = mode === "split" ? splitSegments(timeline) : null
  const segments: AxisSegment[] = split ?? [{ fromUs: 0, toUs: totalUs, startPct: 0, endPct: 100, zoomed: false }]
  const x = piecewise(segments, totalUs)
  const breaks: TimeAxis["breaks"] = []
  for (let i = 1; i < segments.length; i++) {
    breaks.push({ startPct: segments[i - 1].endPct, endPct: segments[i].startPct })
  }
  const ticks = buildTicks(segments, x, totalUs)
  return {
    mode: split ? "split" : "linear",
    totalUs,
    segments,
    breaks,
    ticks,
    grid: ticks.slice(1, -1).map((t) => t.pct),
    x,
  }
}

/** Left and width, in percent, of the span `[fromUs, toUs]` on `axis`. */
export function spanPct(axis: TimeAxis, fromUs: number, toUs: number): { left: number; width: number } {
  const left = axis.x(fromUs)
  return { left, width: Math.max(0, axis.x(toUs) - left) }
}
