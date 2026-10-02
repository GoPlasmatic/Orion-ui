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
  return parsePrometheus(await res.text())
}

type WorkerReply =
  | { id: number; ok: true; t: number; lines: MetricLine[] }
  | { id: number; ok: false; status: number; message: string }

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
      if (reply.ok) waiter.resolve({ t: reply.t, lines: reply.lines })
      else if (reply.status > 0) waiter.reject(new ApiError(reply.status, reply.message))
      else waiter.reject(new Error(reply.message))
    }
    worker.onerror = () => {
      workerBroken = true
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

function matches(line: MetricLine, name: string, filter?: LabelFilter): boolean {
  if (line.name !== name) return false
  if (filter) {
    for (const k in filter) if (line.labels[k] !== filter[k]) return false
  }
  return true
}

export function counterTotal(snap: MetricsSnapshot, name: string, filter?: LabelFilter): number {
  let sum = 0
  for (const l of snap.lines) if (matches(l, name, filter)) sum += l.value
  return sum
}

export function sumByLabel(
  snap: MetricsSnapshot,
  name: string,
  label: string,
  filter?: LabelFilter,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of snap.lines) {
    if (!matches(l, name, filter)) continue
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
  for (const l of snap.lines) {
    if (!matches(l, name, filter)) continue
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
  for (const l of snap.lines) {
    if (!matches(l, bucketName, filter)) continue
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
