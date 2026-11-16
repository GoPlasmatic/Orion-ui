import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { deploymentsApi } from "@/api/deployments"
import { definitionsApi } from "@/api/definitions"
import { useCursorList } from "@/hooks/use-cursor-list"
import type {
  ConvergenceTarget,
  DeploymentsPage,
  EntityKind,
  RollbackDeploymentRequest,
} from "@/api/types"

/** The deployment history, newest first, a page at a time; `first` carries the head and what this node serves. */
export function useDeploymentList() {
  return useCursorList<DeploymentsPage>(
    ["deployments", "list"],
    (cursor) => deploymentsApi.list({ limit: 20, cursor }),
    { refetchInterval: 15_000 },
  )
}

/** The head and this node's applied revision, from one small read. */
export function useDeploymentHead() {
  return useQuery({
    queryKey: ["deployments", "head"],
    queryFn: () => deploymentsApi.list({ limit: 1 }),
    refetchInterval: 15_000,
    select: (p) => ({ head: p.head_revision, applied: p.applied_revision, epoch: p.epoch, latest: p.data[0] }),
  })
}

/**
 * One revision with its manifest. A committed revision never changes — only
 * the collector can later compact its members away — so it is held for a
 * while rather than refetched on every mount.
 */
export function useDeployment(revision: number | null | undefined) {
  return useQuery({
    queryKey: ["deployments", "revision", revision],
    queryFn: () => deploymentsApi.get(revision!),
    enabled: revision != null && revision > 0,
    staleTime: 5 * 60_000,
  })
}

/**
 * The deployed state: the head revision's manifest. The single source for
 * "what serves now" — the entity pages, the map and the palette read it
 * rather than listing entities, which 2.0 cannot do.
 */
export function useDeployedState() {
  const head = useDeploymentHead()
  const revision = head.data?.head
  const manifest = useDeployment(revision)
  return {
    head: head.data,
    revision: manifest.data,
    members: manifest.data?.manifest.members ?? [],
    /** True before the first apply: nothing is deployed. */
    empty: head.data != null && head.data.head === 0,
    isLoading: head.isLoading || (revision != null && revision > 0 && manifest.isLoading),
    error: head.error ?? manifest.error,
  }
}

/**
 * Which nodes serve `revision`. Polls quickly while it has not converged —
 * a rebuild takes seconds — and slowly once it has.
 */
export function useConvergence(revision: number | null | undefined, target: ConvergenceTarget, enabled = true) {
  return useQuery({
    queryKey: ["deployments", "convergence", revision, target],
    queryFn: () => deploymentsApi.convergence(revision!, target),
    enabled: enabled && revision != null && revision > 0,
    refetchInterval: (q) => (q.state.data && q.state.data.converged ? 15_000 : 2_000),
  })
}

/** Kinds whose member names a stored definition; a connection names a configuration digest instead. */
export const hasDefinition = (kind: EntityKind) => kind !== "connection"

/** A stored definition. Content-addressed, so it never changes: fetched once, held for the session. */
export function useDefinition(digest: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["definitions", digest],
    queryFn: () => definitionsApi.get(digest!),
    enabled: enabled && !!digest,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  })
}

/**
 * Roll back: commit an earlier revision's manifest again as the next
 * revision. The caller holds the idempotency key for the dialog's lifetime,
 * so a retry after a dropped response replays rather than committing twice.
 * Not toasted: the dialog shows the receipt, the warnings and any local error.
 */
export function useRollback() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ req, changeContext }: { req: RollbackDeploymentRequest; changeContext?: string }) =>
      deploymentsApi.rollback(req, changeContext ? { changeContext } : undefined),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["deployments"] })
      void queryClient.invalidateQueries({ queryKey: ["runtime-capabilities"] })
      void queryClient.invalidateQueries({ queryKey: ["engine"] })
      void queryClient.invalidateQueries({ queryKey: ["health"] })
      void queryClient.invalidateQueries({ queryKey: ["audit-logs"] })
    },
  })
}
