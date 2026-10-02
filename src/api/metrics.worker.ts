/// <reference lib="webworker" />
// Fetches and parses `/metrics` off the main thread. See `fetchMetrics` in
// `./metrics.ts` for why; the reply shape is `WorkerReply` there.
import { parsePrometheus } from "./prometheus"

declare const self: DedicatedWorkerGlobalScope

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
    self.postMessage({ id, ok: true, t: snap.t, lines: snap.lines })
  } catch (e) {
    self.postMessage({ id, ok: false, status: 0, message: e instanceof Error ? e.message : String(e) })
  }
}
