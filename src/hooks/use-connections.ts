import { useCallback, useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { connectionsApi } from "@/api/connections"
import { connectorPackagesApi } from "@/api/connector-packages"
import { useRegistry } from "@/hooks/use-registry"
import { useRuntimeCapabilities } from "@/hooks/use-runtime-capabilities"
import { fetchAllPages, groupConnections, resolveProvider, type ProviderInfo } from "@/lib/connections"
import type { ConnectionProbe, ConnectorPackageSummary } from "@/api/types"

const PAGE = 200

/**
 * Every revision of every connection. The list has no "latest only", so it
 * is read to the end once (paged, capped) and grouped in the browser.
 */
export function useConnectionRevisions() {
  return useQuery({
    queryKey: ["connections", "all"],
    queryFn: () => fetchAllPages((cursor) => connectionsApi.list({ limit: PAGE, cursor })),
  })
}

/** Every stored provider package, for resolving a connection's `provider_digest`. */
export function useAllProviderPackages() {
  return useQuery({
    queryKey: ["connector-packages", "all"],
    queryFn: () => fetchAllPages<ConnectorPackageSummary>((cursor) => connectorPackagesApi.list({ limit: PAGE, cursor })),
  })
}

/** `provider_digest` → what it is, from this node's backends and the stored packages. */
export function useProviderResolver(): (digest: string) => ProviderInfo {
  const runtime = useRuntimeCapabilities()
  const packages = useAllProviderPackages()
  const backends = runtime.data?.provider_backends
  const list = packages.data?.rows
  return useCallback((digest: string) => resolveProvider(digest, backends, list), [backends, list])
}

/**
 * Connections grouped by id — every stored revision, the newest first, and
 * the one the head deploys. A connection the head deploys is also in
 * `registry.connections`, so the two cannot disagree on what serves.
 */
export function useConnections() {
  const revisions = useConnectionRevisions()
  const registry = useRegistry()
  const groups = useMemo(
    () => groupConnections(revisions.data?.rows ?? [], registry.members),
    [revisions.data, registry.members],
  )
  return {
    data: groups,
    truncated: revisions.data?.truncated ?? false,
    isLoading: revisions.isLoading,
    error: revisions.error,
    refetch: revisions.refetch,
  }
}

/** One connection's revisions, newest first (its own endpoint, so it is complete however many others exist). */
export function useConnection(id: string) {
  const query = useQuery({
    queryKey: ["connections", "one", id],
    queryFn: () => fetchAllPages((cursor) => connectionsApi.revisions(id, { limit: PAGE, cursor })),
    enabled: !!id,
  })
  const revisions = useMemo(
    () => [...(query.data?.rows ?? [])].sort((a, b) => b.revision - a.revision),
    [query.data],
  )
  return { revisions, isLoading: query.isLoading, error: query.error, refetch: query.refetch }
}

/** The last probe of each revision this session, keyed `id@revision`. Probes are not stored by the server. */
export const probeKey = (id: string, revision: number) => ["connections", "probe", `${id}@${revision}`] as const

/** The last probe of one revision this session, if any. */
export function useLastProbe(id: string, revision: number | undefined) {
  return useQuery<ConnectionProbe | null>({
    queryKey: probeKey(id, revision ?? 0),
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

/**
 * Probe a revision's backend from this node. Untoasted: the finding renders
 * inline, and an unhealthy backend is information, not an error. The result
 * is kept for the session under `probeKey`, so the list can show it.
 */
export function useProbeConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, revision }: { id: string; revision: number }) => connectionsApi.probe(id, revision),
    onSuccess: (probe, { id, revision }) => {
      queryClient.setQueryData(probeKey(id, revision), probe)
      void queryClient.invalidateQueries({ queryKey: ["audit-logs"] })
    },
  })
}
