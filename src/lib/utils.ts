import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { getTimeZonePreference } from "@/lib/time-zone"

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

/**
 * A short distance label for a server timestamp — `just now`, `12s ago`,
 * `4m ago`, `3h ago`, `2d ago`, or `in 40m` for an instant still ahead. Null
 * when the value does not parse. Pair it with the absolute `formatDate` in a
 * `title`, so a live list reads at a glance and the exact instant is a hover
 * away.
 */
export function formatRelative(
  value: string | number | null | undefined,
  now = Date.now()
): string | null {
  const t = serverTime(value)
  if (t == null) return null
  const diff = t - now
  const abs = Math.abs(diff)
  if (abs < 5_000) return "just now"
  const unit =
    abs < 60_000
      ? `${Math.round(abs / 1000)}s`
      : abs < 3_600_000
        ? `${Math.round(abs / 60_000)}m`
        : abs < 86_400_000
          ? `${Math.round(abs / 3_600_000)}h`
          : `${Math.round(abs / 86_400_000)}d`
  return diff > 0 ? `in ${unit}` : `${unit} ago`
}

/**
 * An absolute timestamp in the display zone (Engine → Display), with the zone
 * named: `Sep 5, 2026, 05:36 PM GMT+5:30` or `… 12:06 PM UTC`. It used to omit
 * the zone, so a timestamp on screen and one in a server log could differ by
 * hours with nothing to say why.
 */
export function formatDate(date: string | number) {
  const utc = getTimeZonePreference() === "utc"
  return parseServerDate(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: utc ? "UTC" : undefined,
    timeZoneName: "short",
  })
}

/** The time of day in the display zone, for an axis tick: `05:36 PM`. */
export function formatClock(date: string | number): string {
  const utc = getTimeZonePreference() === "utc"
  return parseServerDate(date).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: utc ? "UTC" : undefined,
  })
}

/** The instant as the server wrote it, for tooltips: `2026-09-05T12:06:11.000Z`. */
export function formatInstant(date: string | number): string {
  const t = parseServerDate(date)
  return Number.isNaN(t.getTime()) ? String(date) : t.toISOString()
}

/**
 * Relative while it is recent, absolute once it is history: `12m ago` for
 * anything under a day old, `formatDate` after that. For "Updated" columns
 * and version lists, where the question is "how long ago" until it is not.
 */
export function formatWhen(date: string | number | null | undefined): string {
  const t = serverTime(date)
  if (t == null) return "—"
  if (Date.now() - t < 86_400_000) return formatRelative(date) ?? formatDate(date as string | number)
  return formatDate(date as string | number)
}

/**
 * A `datetime-local` value ("YYYY-MM-DDTHH:mm") as RFC 3339 for the server,
 * read in the display zone: local time by default, UTC when the preference
 * says so — the same zone the timestamps beside the filter are shown in.
 */
export function toRfc3339(local: string): string | undefined {
  if (!local) return undefined
  const utc = getTimeZonePreference() === "utc"
  const d = new Date(utc ? `${local}:00Z` : local)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
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
  downloadText(JSON.stringify(data, null, 2), basename, "json", "application/json")
}

/** Hand the browser a text file: `<basename>-<date>.<ext>`. */
export function downloadText(text: string, basename: string, ext: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${basename}-${new Date().toISOString().slice(0, 10)}.${ext}`
  a.click()
  URL.revokeObjectURL(url)
}
