import { useQuery } from "@tanstack/react-query"
import { connectorsApi } from "@/api/connectors"
import type { ListConnectorsParams } from "@/api/types"

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
