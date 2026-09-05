import { useMemo } from "react"
import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-error"
import { connectorsApi } from "@/api/connectors"
import { engineApi } from "@/api/engine"
import { REGISTRY_LIMIT } from "@/lib/use-pagination"
import { reportBatch, settleAll } from "@/lib/batch"
import type {
  ConnectorType,
  CreateConnectorRequest,
  ImportOptions,
  ListConnectorsParams,
  UpdateConnectorRequest,
} from "@/api/types"

/** The list filter, plus a type — which the endpoint does not take. */
export interface ConnectorListFilter extends ListConnectorsParams {
  connector_type?: ConnectorType
}

/**
 * `GET admin/connectors` has no type filter. With one asked for, the whole
 * registry is fetched and paged in the browser, so a filtered page is a real
 * page of matching rows — not the matching slice of an unfiltered one that
 * still offers a full next page. The response keeps the server's shape, so a
 * caller cannot tell which model served it; the day the server grows the
 * parameter this is the one place that changes.
 */
export function useConnectors(params: ConnectorListFilter = {}, enabled = true) {
  const { connector_type, ...rest } = params
  const request: ListConnectorsParams = connector_type
    ? { ...rest, limit: REGISTRY_LIMIT, offset: 0 }
    : rest
  const query = useQuery({
    queryKey: ["connectors", request],
    queryFn: () => connectorsApi.list(request),
    placeholderData: keepPreviousData,
    enabled,
  })
  const pageOffset = rest.offset ?? 0
  const pageLimit = rest.limit
  const data = useMemo(() => {
    if (!connector_type || !query.data) return query.data
    const matching = query.data.data.filter((c) => c.connector_type === connector_type)
    const limit = pageLimit ?? matching.length
    return {
      ...query.data,
      data: matching.slice(pageOffset, pageOffset + limit),
      total: matching.length,
      limit,
      offset: pageOffset,
    }
  }, [query.data, connector_type, pageOffset, pageLimit])
  return { ...query, data }
}

export function useConnector(id: string) {
  return useQuery({
    queryKey: ["connectors", id],
    queryFn: () => connectorsApi.get(id),
    enabled: !!id,
  })
}

export function useCreateConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateConnectorRequest) => connectorsApi.create(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] })
      toast.success("Connector created")
    },
    onError: (e) => toastError("Failed to create connector", e),
  })
}

export function useUpdateConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateConnectorRequest }) =>
      connectorsApi.update(id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] })
      toast.success("Connector updated")
    },
    onError: (e) => toastError("Failed to update connector", e),
  })
}

export function useDeleteConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => connectorsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] })
      toast.success("Connector deleted")
    },
    onError: (e) => toastError("Failed to delete connector", e),
  })
}

/** Untoasted — the validation envelope renders inline in the form. */
export function useValidateConnector() {
  return useMutation({
    mutationFn: (req: CreateConnectorRequest) => connectorsApi.validate(req),
  })
}

/**
 * Probe a saved connector. Untoasted: an unreachable backend is a legitimate
 * 200 answer that the page renders, not a mutation failure.
 */
export function useTestConnector() {
  return useMutation({
    mutationFn: (id: string) => connectorsApi.test(id),
  })
}

export function useImportConnectors() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ items, ...opts }: { items: CreateConnectorRequest[] } & ImportOptions) =>
      connectorsApi.import(items, opts),
    onSuccess: (_data, vars) => {
      if (!vars.dryRun) queryClient.invalidateQueries({ queryKey: ["connectors"] })
    },
  })
}

// There is no dedicated connectors-reload endpoint; connector mutations reload
// the registry server-side. This triggers a full engine reload for the manual
// "reload" affordance still surfaced in the UI.
export function useReloadConnectors() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => engineApi.reload(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] })
      toast.success("Connectors reloaded")
    },
    onError: (e) => toastError("Failed to reload connectors", e),
  })
}

export function useCircuitBreakers(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ["connectors", "circuit-breakers"],
    queryFn: () => connectorsApi.getCircuitBreakers(),
    refetchInterval: options?.refetchInterval,
  })
}

export function useResetCircuitBreaker() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => connectorsApi.resetCircuitBreaker(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors", "circuit-breakers"] })
      toast.success("Circuit breaker reset")
    },
    onError: (e) => toastError("Failed to reset circuit breaker", e),
  })
}

/**
 * Reset every breaker that is not closed — the end-of-incident sweep. One
 * request per key, issued at once; the page refreshes whatever the outcome.
 */
export function useResetCircuitBreakers() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (keys: string[]) => settleAll(keys, (key) => connectorsApi.resetCircuitBreaker(key)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["connectors", "circuit-breakers"] })
      reportBatch(result, "Reset", ["circuit breaker", "circuit breakers"])
    },
    onError: (e) => toastError("Failed to reset circuit breakers", e),
  })
}
