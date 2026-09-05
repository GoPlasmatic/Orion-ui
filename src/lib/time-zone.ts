/**
 * Which zone the console shows times in.
 *
 * The admin plane serialises UTC instants without a zone suffix
 * (`parseServerDate` pins them); the question is how to *display* them. An
 * operator comparing a trace with a server log wants UTC; one reading a
 * schedule wants the wall clock. The setting is a module variable rather than
 * only React context because `formatDate` is called from column definitions
 * and other plain functions; the page that changes it (Engine → Display)
 * re-renders itself, and every other page renders afresh when visited.
 */
import { readStorage, writeStorage } from "@/lib/storage"

export type TimeZonePreference = "local" | "utc"

const KEY = "orion-timezone"

const readStored = (): TimeZonePreference => (readStorage(KEY) === "utc" ? "utc" : "local")

let current: TimeZonePreference = typeof window === "undefined" ? "local" : readStored()

export function getTimeZonePreference(): TimeZonePreference {
  return current
}

export function setTimeZonePreference(zone: TimeZonePreference): void {
  current = zone
  writeStorage(KEY, zone)
}

/** The viewer's own zone by IANA name, e.g. `Asia/Kolkata`. */
export function localZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return "local time"
  }
}

/** `UTC`, or the viewer's offset as `UTC+05:30`. */
export function zoneOffsetLabel(zone: TimeZonePreference = current): string {
  if (zone === "utc") return "UTC"
  const minutes = -new Date().getTimezoneOffset()
  const sign = minutes >= 0 ? "+" : "-"
  const abs = Math.abs(minutes)
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`
}
