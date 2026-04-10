import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { connectorsApi } from "@/api/connectors"
import type {
  CreateConnectorRequest,
  ListConnectorsParams,
  UpdateConnectorRequest,
} from "@/api/types"

export function useConnectors(params: ListConnectorsParams = {}) {
  return useQuery({
    queryKey: ["connectors", params],
    queryFn: () => connectorsApi.list(params),
  })
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
    },
  })
}

export function useUpdateConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateConnectorRequest }) =>
      connectorsApi.update(id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] })
    },
  })
}

export function useDeleteConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => connectorsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] })
    },
  })
}

export function useReloadConnectors() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => connectorsApi.reload(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] })
    },
  })
}

export function useCircuitBreakers() {
  return useQuery({
    queryKey: ["connectors", "circuit-breakers"],
    queryFn: () => connectorsApi.getCircuitBreakers(),
  })
}

export function useResetCircuitBreaker() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => connectorsApi.resetCircuitBreaker(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors", "circuit-breakers"] })
    },
  })
}
