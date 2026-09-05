import { useMemo } from "react"
import { useHealth } from "@/hooks/use-health"
import { useCircuitBreakers } from "@/hooks/use-connectors"
import { useCronStatus } from "@/hooks/use-cron"
import { buildFaults, type MapFaults } from "@/lib/faults"
import type { SystemGraph } from "@/lib/system-graph"

/** The map's fault overlay, from the health report and this node's breakers. */
export function useMapFaults(): MapFaults {
  const { data: health } = useHealth()
  const { data: breakers } = useCircuitBreakers({ refetchInterval: 15_000 })
  return useMemo(() => buildFaults(health, breakers), [health, breakers])
}

/**
 * Everything a canvas draws that is not a counter: the fault overlay and, for
 * a cron channel, its next fire. One hook for both hosts — the System Map and
 * a detail page's neighbourhood — so a cron channel reads the same on either.
 * The ledger is asked only while the graph holds a schedule; a pre-1.6 server
 * has no cron routes.
 */
export function useMapTelemetry(graph: SystemGraph): {
  faults: MapFaults
  /** Channel name → its next fire, an admin-plane instant. */
  nextFire: ReadonlyMap<string, string>
} {
  const faults = useMapFaults()
  const hasSchedules = useMemo(() => graph.nodes.some((n) => n.schedule), [graph.nodes])
  const { data: cronStatus } = useCronStatus({ enabled: hasSchedules })
  const nextFire = useMemo(
    () =>
      new Map(
        (cronStatus ?? [])
          .filter((s) => s.next_fire_at)
          .map((s) => [s.channel_name, s.next_fire_at as string]),
      ),
    [cronStatus],
  )
  return { faults, nextFire }
}
