import { useMemo } from "react"
import { useHealth } from "@/hooks/use-health"
import { useCircuitBreakers } from "@/hooks/use-connectors"
import { buildFaults, type MapFaults } from "@/lib/faults"

/** The map's fault overlay, from the health report and this node's breakers. */
export function useMapFaults(): MapFaults {
  const { data: health } = useHealth()
  const { data: breakers } = useCircuitBreakers({ refetchInterval: 15_000 })
  return useMemo(() => buildFaults(health, breakers), [health, breakers])
}
