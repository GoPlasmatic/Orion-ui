// Prometheus text-format parsing, with no imports: this module is also loaded
// by the metrics worker (`metrics.worker.ts`), so it must not pull the API
// client, React or anything that touches the DOM into the worker bundle.

export interface MetricLine {
  name: string
  labels: Record<string, string>
  value: number
}

export interface MetricsSnapshot {
  t: number
  lines: MetricLine[]
}

const LABEL_RE = /(\w+)="((?:[^"\\]|\\.)*)"/g

export function parseValue(raw: string): number {
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

