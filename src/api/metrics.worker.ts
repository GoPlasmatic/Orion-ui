/// <reference lib="webworker" />
// Fetches and parses `/metrics` off the main thread. See `fetchMetrics` in
// `./metrics.ts` for why, and `WorkerReply` there for the reply.
//
// The reply is columnar: the series' values as a transferred Float64Array
// (zero-copy), and the series descriptors (key, name, labels) only when the
// set of series changed since the last reply. On a stable server that is
// every poll after the first, so the main thread deserialises one buffer
// rather than ~45k objects every 10 s.
import { parsePrometheus } from "./prometheus"

declare const self: DedicatedWorkerGlobalScope

let lastSignature: string | null = null
let version = 0

self.onmessage = async (ev: MessageEvent<{ id: number; url: string }>) => {
  const { id, url } = ev.data
  try {
    const res = await fetch(url, {
      headers: { Accept: "text/plain" },
      credentials: "same-origin",
      priority: "low",
    } as RequestInit)
    if (!res.ok) {
      self.postMessage({ id, ok: false, status: res.status, message: res.statusText || "Failed to fetch metrics" })
      return
    }
    const snap = parsePrometheus(await res.text())
    const keys = snap.lines.map((l) => l.key ?? l.name)
    const signature = keys.join("\n")
    let table: { keys: string[]; names: string[]; labels: Record<string, string>[] } | undefined
    if (signature !== lastSignature) {
      lastSignature = signature
      version++
      table = { keys, names: snap.lines.map((l) => l.name), labels: snap.lines.map((l) => l.labels) }
    }
    const values = new Float64Array(snap.lines.length)
    for (let i = 0; i < snap.lines.length; i++) values[i] = snap.lines[i].value
    self.postMessage({ id, ok: true, t: snap.t, version, table, values }, [values.buffer])
  } catch (e) {
    self.postMessage({ id, ok: false, status: 0, message: e instanceof Error ? e.message : String(e) })
  }
}
