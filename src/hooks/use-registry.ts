import { useMemo } from "react"
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query"
import { deploymentsApi } from "@/api/deployments"
import { definitionQuery, hasDefinition, useDeployedState, useDeploymentHead } from "@/hooks/use-deployments"
import { useRuntimeCapabilities } from "@/hooks/use-runtime-capabilities"
import { buildRegistry, type DeployedRegistry } from "@/lib/deployed-registry"
import { entityHistory, memberRefKey, type EntityHistoryEntry } from "@/lib/deployment-diff"
import type { DeploymentRevision, EntityRef, ManifestMember, StoredDefinition } from "@/api/types"

const NO_MEMBERS: ManifestMember[] = []

interface Definitions {
  byDigest: Map<string, StoredDefinition>
  pending: boolean
  error: unknown
}

// Module scope, so TanStack can keep the combined value stable between
// renders that change nothing (a new function each render would defeat it).
function combineDefinitions(results: UseQueryResult<StoredDefinition>[], digests: string[]): Definitions {
  const byDigest = new Map<string, StoredDefinition>()
  results.forEach((r, i) => {
    if (r.data) byDigest.set(digests[i], r.data)
  })
  return {
    byDigest,
    pending: results.some((r) => r.isPending && r.fetchStatus !== "idle"),
    error: results.find((r) => r.error)?.error ?? null,
  }
}

/**
 * Built once per (members, loaded definitions), at module scope: the map, the
 * dashboard, the sidebar and a detail page all read the registry, and each
 * would otherwise build it again. Definitions only ever arrive (they are
 * content-addressed), so the count of loaded ones is a sound cache key.
 */
const built = new WeakMap<ManifestMember[], { loaded: number; registry: DeployedRegistry }>()

function registryFor(members: ManifestMember[], defs: Map<string, StoredDefinition>): DeployedRegistry {
  const hit = built.get(members)
  if (hit && hit.loaded === defs.size) return hit.registry
  const registry = buildRegistry(members, (d) => defs.get(d))
  built.set(members, { loaded: defs.size, registry })
  return registry
}

export interface RegistryState extends DeployedRegistry {
  /** The head revision the registry reads; absent before the first apply. */
  revision?: DeploymentRevision
  members: ManifestMember[]
  /** True before the first apply: nothing is deployed. */
  empty: boolean
  /** The head, or its member definitions, are still loading. */
  isLoading: boolean
  error: unknown
  /** Read the head again (and any definition that failed to load). */
  refetch: () => void
}

/**
 * What the head deploys, as entities — the single source for "which
 * channels, workflows and plugins exist" in 2.0, which has no listing. Reads
 * the head manifest, then every workflow, channel and plugin definition it
 * names (each fetched once; they never change).
 */
export function useRegistry(): RegistryState {
  const queryClient = useQueryClient()
  const state = useDeployedState()
  const members = state.revision?.manifest.members ?? NO_MEMBERS
  const digests = useMemo(
    () => [...new Set(members.filter((m) => hasDefinition(m.entity.kind)).map((m) => m.definition_digest))],
    [members],
  )
  const defs = useQueries({
    queries: digests.map((d) => definitionQuery(d)),
    combine: (results) => combineDefinitions(results, digests),
  })
  const registry = registryFor(members, defs.byDigest)
  return {
    ...registry,
    revision: state.revision,
    members,
    empty: state.empty,
    isLoading: state.isLoading || defs.pending,
    error: state.error ?? defs.error,
    refetch: () => {
      void queryClient.invalidateQueries({ queryKey: ["deployments"] })
      void queryClient.invalidateQueries({ queryKey: ["definitions"], predicate: (q) => q.state.status === "error" })
    },
  }
}

/** How many of the newest deployment revisions an entity's history reads. */
export const HISTORY_DEPTH = 25

/**
 * An entity's states across the newest `HISTORY_DEPTH` deployment revisions
 * (each revision fetched once and cached — a committed revision never
 * changes). `truncated` says older history exists that this did not read;
 * `compacted` counts revisions the collector emptied, which say nothing.
 */
export function useEntityHistory(target: { kind: string; id: string } | null) {
  const list = useQuery({
    queryKey: ["deployments", "history-window", HISTORY_DEPTH],
    queryFn: () => deploymentsApi.list({ limit: HISTORY_DEPTH }),
    enabled: !!target,
    refetchInterval: 15_000,
  })
  const summaries = useMemo(() => list.data?.data ?? [], [list.data])
  const revisions = useQueries({
    queries: summaries.map((s) => ({
      queryKey: ["deployments", "revision", s.revision],
      queryFn: () => deploymentsApi.get(s.revision),
      enabled: !!target && !s.members_compacted,
      staleTime: 5 * 60_000,
    })),
    combine: (results) => ({
      data: results.map((r) => r.data).filter((r): r is DeploymentRevision => !!r),
      pending: results.some((r) => r.isPending && r.fetchStatus !== "idle"),
    }),
  })
  const entries: EntityHistoryEntry[] = useMemo(
    () => (target ? entityHistory(revisions.data, target) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the target's identity is its kind and id
    [revisions.data, target?.kind, target?.id],
  )
  return {
    entries,
    isLoading: list.isLoading || revisions.pending,
    error: list.error,
    truncated: !!list.data?.next_cursor,
    compacted: summaries.filter((s) => s.members_compacted).length,
    oldestRead: summaries.at(-1)?.revision,
  }
}

/**
 * Where this node stands against the head: whether it serves it yet, and
 * which of its members it quarantined (keyed by `memberRefKey`). A
 * quarantine is only meaningful for the revision the node applied, so it is
 * empty while the node still serves an older one.
 */
export function useNodeHealth() {
  const runtime = useRuntimeCapabilities()
  const head = useDeploymentHead()
  const node = runtime.data?.node_status
  const headRevision = head.data?.head
  const quarantined = useMemo(() => {
    if (!node || headRevision == null || node.applied_revision !== headRevision) return new Map<string, string>()
    return new Map(node.quarantined_entities.map((q) => [memberRefKey(q.entity), q.reason]))
  }, [node, headRevision])
  return {
    quarantined,
    /** Undefined until both answers are in. */
    servesHead: node && headRevision != null ? node.applied_revision === headRevision : undefined,
    applied: node?.applied_revision,
    head: headRevision,
    lastError: node?.last_error ?? null,
  }
}

/** Why this node quarantined a member, or undefined when it serves it (or has not applied the head yet). */
export function useQuarantineReason(entity: EntityRef | undefined): string | undefined {
  const { quarantined } = useNodeHealth()
  return entity ? quarantined.get(memberRefKey(entity)) : undefined
}
