import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
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