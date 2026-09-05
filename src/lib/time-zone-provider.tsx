import { useMemo, useState, type ReactNode } from "react"
import { TimeZoneContext } from "@/lib/time-zone-context"
import {
  getTimeZonePreference,
  localZoneName,
  setTimeZonePreference,
  zoneOffsetLabel,
  type TimeZonePreference,
} from "@/lib/time-zone"

/** Provides the display zone; the module setting behind `formatDate` follows it. */
export function TimeZoneProvider({ children }: { children: ReactNode }) {
  const [zone, setZoneState] = useState<TimeZonePreference>(() => getTimeZonePreference())
  const value = useMemo(
    () => ({
      zone,
      setZone: (next: TimeZonePreference) => {
        setTimeZonePreference(next)
        setZoneState(next)
      },
      label: zoneOffsetLabel(zone),
      localName: localZoneName(),
    }),
    [zone],
  )
  return <TimeZoneContext.Provider value={value}>{children}</TimeZoneContext.Provider>
}
