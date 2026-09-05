import { useContext } from "react"
import { TimeZoneContext } from "@/lib/time-zone-context"

export function useTimeZone() {
  const ctx = useContext(TimeZoneContext)
  if (!ctx) throw new Error("useTimeZone must be used within TimeZoneProvider")
  return ctx
}
