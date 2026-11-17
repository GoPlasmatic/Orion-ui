import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { deploymentsApi } from "@/api/deployments"
import { definitionsApi } from "@/api/definitions"
import { useCursorList } from "@/hooks/use-cursor-list"
import type {
  ConvergenceTarget,
  DeploymentsPage,
  EntityKind,
  RollbackDeploymentRequest,
  StoredDefinition,
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

/** `sha256:<hex>` of `bytes`, or undefined where WebCrypto is unavailable (a page served over plain http to a remote host). */
async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string | undefined> {
  if (typeof crypto === "undefined" || !crypto.subtle) return undefined
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return `sha256:${Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("")}`
}

/**
 * A plugin definition carries its WebAssembly component as base64 — up to
 * megabytes. Keep its size and digest and drop the bytes, writing the facts
 * where they were so a viewer or a diff still shows that the component
 * changed. Every other definition passes through.
 */
export async function withoutComponentBytes(stored: StoredDefinition): Promise<StoredDefinition> {
  const component = stored.definition.component
  if (stored.kind !== "plugin" || typeof component !== "string") return stored
  let bytes: Uint8Array<ArrayBuffer> | null = null
  try {
    const raw = atob(component.trim())
    bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  } catch {
    // Not base64: the server would not have stored it, but say so rather than throw.
  }
  const size_bytes = bytes?.length ?? 0
  const digest = bytes ? await sha256(bytes) : undefined
  return {
    ...stored,
    definition: { ...stored.definition, component: `${digest ?? "component"} · ${size_bytes} bytes (base64 omitted)` },
    component: { size_bytes, digest },
  }
}

/** The query for one stored definition — shared by `useDefinition` and the registry's `useQueries`. */
export const definitionQuery = (digest: string | null | undefined, enabled = true) =>
  queryOptions({
    queryKey: ["definitions", digest],
    queryFn: () => definitionsApi.get(digest!).then(withoutComponentBytes),
    enabled: enabled && !!digest,
    // Content-addressed: a definition never changes, so it is fetched once.
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  })

/** A stored definition. Content-addressed, so it never changes: fetched once, held for the session. */
export function useDefinition(digest: string | null | undefined, enabled = true) {
  return useQuery(definitionQuery(digest, enabled))
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
