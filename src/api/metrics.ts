import { ApiError } from "@/api/client"

// Generic Prometheus text-format parsing + query helpers. The `/metrics` endpoint
// returns plain text (not JSON), so this bypasses the JSON-only `api` client.
// Orion-specific KPI semantics live in `@/hooks/use-metrics`, not here.

export type { MetricLine, MetricsSnapshot } from "./prometheus"
export { parsePrometheus } from "./prometheus"
import { parsePrometheus, parseValue, type MetricLine, type MetricsSnapshot } from "./prometheus"

export type LabelFilter = Record<string, string>

/**
 * Fetch and parse `/metrics`, off the main thread where the platform allows.
 *
 * On a busy server the scrape is large — QA's 148 channels serialise to ~900 KB
 * and 7.5k series, most of them per-task histogram buckets — and it is read on
 * every page every 10 s. In a worker the text never reaches the main thread,
 * only the parsed lines do. Under test (jsdom has no Worker) and on any failure
 * to start one, the same work runs inline.
 *
 * The request goes out at `priority: "low"`: a scrape is background telemetry,
 * and it was observed holding up the page's own admin reads.
 */
export async function fetchMetrics(): Promise<MetricsSnapshot> {
  const viaWorker = metricsWorker()
  if (viaWorker) {
    try {
      return await viaWorker()
    } catch (e) {
      if (e instanceof ApiError) throw e
      // A worker that failed to load (CSP, an old browser) falls back inline.
      workerBroken = true
    }
  }
  const res = await fetch("/metrics", {
    headers: { Accept: "text/plain" },
    priority: "low",
  } as RequestInit)
  if (!res.ok) throw new ApiError(res.status, res.statusText || "Failed to fetch metrics")
  const parsed = parsePrometheus(await res.text())
  return { t: parsed.t, lines: parsed.lines.map((l) => internLine(l.key ?? l.name, l.name, l.labels, l.value)) }
}

// ---------------------------------------------------------------------------
// Interning
//
// The ring buffer in `use-metrics.ts` keeps 60 snapshots of ~7.5k series. A
// freshly parsed snapshot owns a labels object and three strings per series,
// so the buffer held ~100 MB on a large instance. Each series' descriptor is
// interned here instead: every snapshot's line for one series shares the same
// `name`, `labels` and `key`, and a line costs one small object.
// ---------------------------------------------------------------------------

interface SeriesMeta {
  key: string
  name: string
  labels: Record<string, string>
}

let metaByKey = new Map<string, SeriesMeta>()
const META_LIMIT = 100_000

function internMeta(key: string, name: string, labels: Record<string, string>): SeriesMeta {
  let m = metaByKey.get(key)
  if (!m) {
    if (metaByKey.size >= META_LIMIT) metaByKey = new Map()
    m = { key, name, labels }
    metaByKey.set(key, m)
  }
  return m
}

function internLine(key: string, name: string, labels: Record<string, string>, value: number): MetricLine {
  const m = internMeta(key, name, labels)
  return { name: m.name, labels: m.labels, key: m.key, value }
}

type WorkerReply =
  | {
      id: number
      ok: true
      t: number
      version: number
      table?: { keys: string[]; names: string[]; labels: Record<string, string>[] }
      values: Float64Array
    }
  | { id: number; ok: false; status: number; message: string }

/** The worker's current series table, by its version. */
let table: { version: number; metas: SeriesMeta[] } | null = null

function fromWorker(reply: Extract<WorkerReply, { ok: true }>): MetricsSnapshot {
  if (reply.table) {
    const { keys, names, labels } = reply.table
    table = { version: reply.version, metas: keys.map((k, i) => internMeta(k, names[i], labels[i])) }
  }
  if (!table || table.version !== reply.version || table.metas.length !== reply.values.length) {
    throw new Error("metrics worker reply does not match its series table")
  }
  const metas = table.metas
  const lines: MetricLine[] = new Array(metas.length)
  for (let i = 0; i < metas.length; i++) {
    const m = metas[i]
    lines[i] = { name: m.name, labels: m.labels, key: m.key, value: reply.values[i] }
  }
  return { t: reply.t, lines }
}

let worker: Worker | null = null
let workerBroken = false
let nextId = 0
const pending = new Map<number, { resolve: (s: MetricsSnapshot) => void; reject: (e: unknown) => void }>()

function metricsWorker(): (() => Promise<MetricsSnapshot>) | null {
  if (workerBroken || typeof Worker === "undefined" || import.meta.env.MODE === "test") return null
  if (!worker) {
    try {
      worker = new Worker(new URL("./metrics.worker.ts", import.meta.url), { type: "module" })
    } catch {
      workerBroken = true
      return null
    }
    worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
      const reply = ev.data
      const waiter = pending.get(reply.id)
      if (!waiter) return
      pending.delete(reply.id)
      if (reply.ok) {
        try {
          waiter.resolve(fromWorker(reply))
        } catch (e) {
          waiter.reject(e)
        }
      }
      else if (reply.status > 0) waiter.reject(new ApiError(reply.status, reply.message))
      else waiter.reject(new Error(reply.message))
    }
    worker.onerror = () => {
      workerBroken = true
      table = null
      for (const w of pending.values()) w.reject(new Error("metrics worker failed"))
      pending.clear()
      worker?.terminate()
      worker = null
    }
  }
  const w = worker
  return () =>
    new Promise<MetricsSnapshot>((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      w.postMessage({ id, url: new URL("/metrics", location.href).toString() })
    })
}

// ---------------------------------------------------------------------------
// Family index
//
// Every reader asks for one family at a time (`orion_messages_total`,
// `orion_task_duration_seconds_bucket`, …). Scanning all ~7.5k lines per ask
// made a dashboard poll cost several hundred full passes; grouping the lines
// by family once per snapshot makes each ask proportional to its family.
// ---------------------------------------------------------------------------

const familyCache = new WeakMap<MetricsSnapshot, Map<string, MetricLine[]>>()
const NO_LINES: readonly MetricLine[] = []

/** The lines of one metric family in a snapshot, indexed once per snapshot. */
export function family(snap: MetricsSnapshot, name: string): readonly MetricLine[] {
  let index = familyCache.get(snap)
  if (!index) {
    index = new Map()
    for (const l of snap.lines) {
      const list = index.get(l.name)
      if (list) list.push(l)
      else index.set(l.name, [l])
    }
    familyCache.set(snap, index)
  }
  return index.get(name) ?? NO_LINES
}

function matchesLabels(line: MetricLine, filter?: LabelFilter): boolean {
  if (filter) {
    for (const k in filter) if (line.labels[k] !== filter[k]) return false
  }
  return true
}

const seriesKey = (l: MetricLine) =>
  l.key ??
  `${l.name}{${Object.keys(l.labels)
    .sort()
    .map((k) => `${k}=${l.labels[k]}`)
    .join(",")}}`

const deltaCache = new WeakMap<MetricsSnapshot, WeakMap<MetricsSnapshot, MetricsSnapshot>>()

/**
 * `cur − base`, series by series: what happened *between* the two scrapes.
 * Counters and histogram buckets are monotonic, so the difference is itself a
 * valid counter set and a valid cumulative histogram — which is what lets
 * `histogramQuantile` answer "p95 in the last five minutes". A restart shows
 * up as a negative delta and clamps to zero. Gauges are not meaningful here.
 *
 * Memoised per (cur, base): every windowed reader on a page asks for the same
 * pair each poll, and one delta is ~7.5k objects.
 */
export function deltaSnapshot(base: MetricsSnapshot, cur: MetricsSnapshot): MetricsSnapshot {
  let byBase = deltaCache.get(cur)
  const hit = byBase?.get(base)
  if (hit) return hit
  const before = new Map<string, number>()
  for (const l of base.lines) before.set(seriesKey(l), l.value)
  const delta: MetricsSnapshot = {
    t: cur.t,
    lines: cur.lines.map((l) => ({
      name: l.name,
      labels: l.labels,
      key: l.key,
      value: Math.max(0, l.value - (before.get(seriesKey(l)) ?? 0)),
    })),
  }
  if (!byBase) {
    byBase = new WeakMap()
    deltaCache.set(cur, byBase)
  }
  byBase.set(base, delta)
  return delta
}

export function counterTotal(snap: MetricsSnapshot, name: string, filter?: LabelFilter): number {
  let sum = 0
  for (const l of family(snap, name)) if (matchesLabels(l, filter)) sum += l.value
  return sum
}

export function sumByLabel(
  snap: MetricsSnapshot,
  name: string,
  label: string,
  filter?: LabelFilter,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of family(snap, name)) {
    if (!matchesLabels(l, filter)) continue
    const key = l.labels[label] ?? ""
    out.set(key, (out.get(key) ?? 0) + l.value)
  }
  return out
}

// Distinct values a label takes across one metric family, in first-seen order.
export function labelValues(
  snap: MetricsSnapshot,
  name: string,
  label: string,
  filter?: LabelFilter,
): string[] {
  const seen = new Set<string>()
  for (const l of family(snap, name)) {
    if (!matchesLabels(l, filter)) continue
    const v = l.labels[label]
    if (v !== undefined) seen.add(v)
  }
  return [...seen]
}

/**
 * Estimate a quantile from a Prometheus **histogram**, the way
 * `histogram_quantile()` does: find the bucket the rank falls in and
 * interpolate linearly within it.
 *
 * Orion sets explicit buckets on every `*_seconds` family
 * (`metrics.rs::LATENCY_BUCKETS`), deliberately — without them
 * `metrics-exporter-prometheus` renders a `histogram!` as a *summary* with
 * pre-computed quantiles, which cannot be aggregated across replicas. So the
 * wire carries `<name>_bucket{le="…"}`, `<name>_sum` and `<name>_count`, and
 * there is no `quantile` label anywhere to read.
 *
 * Returns null when the family is absent or has observed nothing. Resolution is
 * bounded by the bucket edges: a value in the open top bucket reports the
 * highest finite edge rather than +Inf, which is what Prometheus does too.
 */
export function histogramQuantile(
  snap: MetricsSnapshot,
  name: string,
  q: number,
  filter?: LabelFilter,
): number | null {
  const bucketName = `${name}_bucket`
  // Cumulative counts keyed by upper bound. A family split across labels the
  // filter does not pin (e.g. per-task rows) sums into one aggregate histogram,
  // which is valid precisely because the buckets are shared.
  const cumulative = new Map<number, number>()
  for (const l of family(snap, bucketName)) {
    if (!matchesLabels(l, filter)) continue
    const le = parseValue(l.labels.le ?? "")
    if (Number.isNaN(le)) continue
    cumulative.set(le, (cumulative.get(le) ?? 0) + l.value)
  }
  if (cumulative.size === 0) return null

  const edges = [...cumulative.entries()].sort(([a], [b]) => a - b)
  const total = edges[edges.length - 1][1]
  if (!(total > 0)) return null

  const rank = q * total
  let prevEdge = 0
  let prevCount = 0
  for (const [le, count] of edges) {
    if (count >= rank) {
      if (!Number.isFinite(le)) {
        // The rank sits in the open top bucket; report the highest finite edge.
        return prevEdge > 0 ? prevEdge : null
      }
      const span = count - prevCount
      if (span <= 0) return le
      return prevEdge + ((rank - prevCount) / span) * (le - prevEdge)
    }
    prevEdge = Number.isFinite(le) ? le : prevEdge
    prevCount = count
  }
  return prevEdge > 0 ? prevEdge : null
}

/**
 * Mean of a histogram over a window, in seconds: Δ_sum / Δ_count between two
 * scrapes, falling back to the cumulative mean when there is no prior sample.
 */
export function histogramMean(
  prev: MetricsSnapshot | null,
  cur: MetricsSnapshot | null,
  name: string,
  filter?: LabelFilter,
): number | null {
  if (!cur) return null
  const sum = `${name}_sum`
  const count = `${name}_count`
  if (prev) {
    const dSum = counterTotal(cur, sum, filter) - counterTotal(prev, sum, filter)
    const dCount = counterTotal(cur, count, filter) - counterTotal(prev, count, filter)
    if (dCount > 0) return dSum / dCount
  }
  const n = counterTotal(cur, count, filter)
  return n > 0 ? counterTotal(cur, sum, filter) / n : null
}
