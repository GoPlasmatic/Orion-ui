import { ApiError } from "@/api/client"

// Generic Prometheus text-format parsing + query helpers. The `/metrics` endpoint
// returns plain text (not JSON), so this bypasses the JSON-only `api` client.
// Orion-specific KPI semantics live in `@/hooks/use-metrics`, not here.

export interface MetricLine {
  name: string
  labels: Record<string, string>
  value: number
}

export interface MetricsSnapshot {
  t: number
  lines: MetricLine[]
}

export type LabelFilter = Record<string, string>

const LABEL_RE = /(\w+)="((?:[^"\\]|\\.)*)"/g

function parseValue(raw: string): number {
  if (raw === "+Inf") return Infinity
  if (raw === "-Inf") return -Infinity
  if (raw === "NaN") return NaN
  return Number(raw)
}

export function parsePrometheus(text: string, t: number = Date.now()): MetricsSnapshot {
  const lines: MetricLine[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue

    let name: string
    let labelStr = ""
    let rest: string
    const brace = line.indexOf("{")
    if (brace !== -1) {
      const close = line.lastIndexOf("}")
      if (close === -1) continue
      name = line.slice(0, brace)
      labelStr = line.slice(brace + 1, close)
      rest = line.slice(close + 1).trim()
    } else {
      const sp = line.indexOf(" ")
      if (sp === -1) continue
      name = line.slice(0, sp)
      rest = line.slice(sp + 1).trim()
    }

    const value = parseValue(rest.split(/\s+/)[0])
    const labels: Record<string, string> = {}
    if (labelStr) {
      LABEL_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = LABEL_RE.exec(labelStr)) !== null) {
        labels[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\")
      }
    }
    lines.push({ name, labels, value })
  }
  return { t, lines }
}

export async function fetchMetrics(): Promise<MetricsSnapshot> {
  const res = await fetch("/metrics", { headers: { Accept: "text/plain" } })
  if (!res.ok) throw new ApiError(res.status, res.statusText || "Failed to fetch metrics")
  return parsePrometheus(await res.text())
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
