import { useEffect, useMemo, useState, type ReactNode } from "react"
import { DensityContext } from "./density-context"

/** Provides the table/console density preference, persisted to localStorage. */
export function DensityProvider({ children }: { children: ReactNode }) {
  const [compact, setCompact] = useState(
    () => localStorage.getItem("orion-density") === "compact"
  )

  useEffect(() => {
    localStorage.setItem("orion-density", compact ? "compact" : "comfortable")
  }, [compact])

  // Stable identity so density consumers (every table cell) only re-render when it flips.
  const value = useMemo(() => ({ compact, setCompact }), [compact])

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>
}
