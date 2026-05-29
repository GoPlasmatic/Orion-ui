import { createContext } from "react"

export interface DensityContextValue {
  compact: boolean
  setCompact: (compact: boolean) => void
}

export const DensityContext = createContext<DensityContextValue | null>(null)
