import { useMemo } from "react"
import { useAuditLogs } from "@/hooks/use-audit"
import { useNow } from "@/lib/use-now"
import { buildChangePins, PIN_LIMIT, PIN_WINDOW_MS, type ChangePins } from "@/lib/change-pins"
import type { SystemGraph } from "@/lib/system-graph"

/**
 * The map's change pins: one audit query — the latest `PIN_LIMIT` rows of the
 * last day — rather than one per node. The window's start moves in
 * ten-minute steps, so the query key, and the request, is stable between them.
 */
export function useChangePins(graph: SystemGraph): ChangePins {
  const now = useNow(600_000)
  const start = useMemo(() => {
    const step = 600_000
    return new Date(Math.floor((now - PIN_WINDOW_MS) / step) * step).toISOString()
  }, [now])
  const { data } = useAuditLogs({ limit: PIN_LIMIT, start_time: start }, { refetchInterval: 60_000 })
  return useMemo(() => buildChangePins(data?.data ?? [], graph), [data, graph])
}
