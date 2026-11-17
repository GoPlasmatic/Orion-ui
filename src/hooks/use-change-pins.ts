import { useMemo } from "react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { deploymentsApi } from "@/api/deployments"
import { useNow } from "@/lib/use-now"
import { serverTime } from "@/lib/utils"
import { buildChangePins, PIN_REVISIONS, PIN_WINDOW_MS, type ChangePins } from "@/lib/change-pins"
import type { DeploymentRevision } from "@/api/types"
import type { SystemGraph } from "@/lib/system-graph"

/**
 * The map's change pins: the newest `PIN_REVISIONS` deployment revisions
 * committed in the last day, each read with its parent (a committed revision
 * never changes, so every read is cached) and diffed. One list request and a
 * handful of revision reads, rather than anything per node.
 */
export function useChangePins(graph: SystemGraph): ChangePins {
  const now = useNow(600_000)
  const list = useQuery({
    queryKey: ["deployments", "pins", PIN_REVISIONS],
    queryFn: () => deploymentsApi.list({ limit: PIN_REVISIONS }),
    refetchInterval: 60_000,
  })
  const recent = useMemo(
    () =>
      (list.data?.data ?? []).filter(
        (r) => !r.members_compacted && (serverTime(r.created_at) ?? 0) >= now - PIN_WINDOW_MS,
      ),
    [list.data, now],
  )
  // Each recent revision and its parent.
  const wanted = useMemo(
    () => [
      ...new Set(recent.flatMap((r) => (r.parent_revision != null ? [r.revision, r.parent_revision] : [r.revision]))),
    ],
    [recent],
  )
  const revisions = useQueries({
    queries: wanted.map((revision) => ({
      queryKey: ["deployments", "revision", revision],
      queryFn: () => deploymentsApi.get(revision),
      staleTime: 5 * 60_000,
    })),
    combine: (results) => results.map((r) => r.data).filter((r): r is DeploymentRevision => !!r),
  })
  return useMemo(() => {
    const byRevision = new Map(revisions.map((r) => [r.revision, r]))
    const loaded = recent.map((r) => byRevision.get(r.revision)).filter((r): r is DeploymentRevision => !!r)
    return buildChangePins(loaded, (n) => byRevision.get(n), graph)
  }, [revisions, recent, graph])
}
