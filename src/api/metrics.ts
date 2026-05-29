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

// Read a precomputed quantile from a Prometheus summary, e.g.
// `message_duration_seconds{channel="payments",quantile="0.95"}`. `q` is the
// quantile label string ("0.5", "0.95", ...). Returns the value (point-in-time)
// or null if the series is absent.
export function summaryQuantile(
  snap: MetricsSnapshot,
  name: string,
  q: string,
  filter?: LabelFilter,
): number | null {
  for (const l of snap.lines) {
    if (l.name !== name || l.labels.quantile !== q) continue
    if (filter) {
      let ok = true
      for (const k in filter) {
        if (l.labels[k] !== filter[k]) {
          ok = false
          break
        }
      }
      if (!ok) continue
    }
    return l.value
  }
  return null
}
