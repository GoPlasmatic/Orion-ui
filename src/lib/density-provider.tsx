import { useEffect, useState, type ReactNode } from "react"
import { DensityContext } from "./density-context"

/** Provides the table/console density preference, persisted to localStorage. */
export function DensityProvider({ children }: { children: ReactNode }) {
  const [compact, setCompact] = useState(
    () => localStorage.getItem("orion-density") === "compact"
  )

  useEffect(() => {
    localStorage.setItem("orion-density", compact ? "compact" : "comfortable")
  }, [compact])

  return (
    <DensityContext.Provider value={{ compact, setCompact }}>
      {children}
    </DensityContext.Provider>
  )
}
