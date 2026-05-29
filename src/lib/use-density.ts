import { useContext } from "react"
import { DensityContext } from "./density-context"

export function useDensity() {
  const ctx = useContext(DensityContext)
  if (!ctx) throw new Error("useDensity must be used within DensityProvider")
  return ctx
}
