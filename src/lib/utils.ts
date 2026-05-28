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

/** Safely parse a JSON string; returns the original string on failure. */
export function parseJson(value: string | null | undefined): unknown {
  if (value == null) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}