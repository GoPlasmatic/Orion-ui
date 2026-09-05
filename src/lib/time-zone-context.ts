import { createContext } from "react"
import type { TimeZonePreference } from "@/lib/time-zone"

export interface TimeZoneContextValue {
  zone: TimeZonePreference
  setZone: (zone: TimeZonePreference) => void
  /** `UTC` or `UTC+05:30` — what a caption should say times are in. */
  label: string
  /** The viewer's IANA zone, for the Display card. */
  localName: string
}

export const TimeZoneContext = createContext<TimeZoneContextValue | null>(null)
