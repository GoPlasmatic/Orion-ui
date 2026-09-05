import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * A timestamp as the server writes it. Orion's admin plane serialises
 * `chrono::NaiveDateTime` — `2026-09-05T12:13:55`, no zone suffix — and every
 * such value is a UTC instant. `new Date()` on a zoneless ISO string reads it
 * as *local* time, which put every timestamp in the console off by the
 * viewer's UTC offset and made "next fire in 5s" render as "5.5h ago" in
 * Kolkata. So a zoneless string is pinned to UTC here; one that carries a
 * zone (`Z`, `+02:00`) is left alone.
 */
export function parseServerDate(value: string | number): Date {
  if (typeof value === "number") return new Date(value)
  return new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value) ? `${value}Z` : value)
}

/** Epoch milliseconds for a server timestamp — for durations and "ago" labels. */
export function serverTime(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null
  const t = parseServerDate(value).getTime()
  return Number.isNaN(t) ? null : t
}

export function formatDate(date: string) {
  return parseServerDate(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Format a millisecond duration with an appropriate unit (ns / µs / ms / s / m s).
 * Input is in milliseconds (may be a noisy float). Returns "--" for null/undefined.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "--"
  const abs = Math.abs(ms)
  if (abs === 0) return "0ms"
  if (abs < 0.001) return `${Math.round(ms * 1e6)}ns`
  if (abs < 1) return `${Math.round(ms * 1000)}µs`
  if (abs < 1000) return `${Math.round(ms)}ms`
  if (abs < 60_000) return `${(ms / 1000).toFixed(2)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

/** Safely parse a JSON string; returns the original string on failure. */
export function parseJson(value: string | null | undefined): unknown {
  if (value == null) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
/**
 * Hand the browser a JSON file. `filename` gets today's date appended, matching
 * the export naming the CLI uses.
 */
export function downloadJson(data: unknown, basename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${basename}-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
