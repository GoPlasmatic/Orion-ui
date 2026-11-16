import { useQuery } from "@tanstack/react-query"
import { engineApi } from "@/api/engine"

export function useEngineStatus() {
  return useQuery({
    queryKey: ["engine", "status"],
    queryFn: () => engineApi.status(),
    refetchInterval: 30000,
  })
}

/**
 * Whether this instance serves its OpenAPI spec and Swagger UI. A server
 * running with `environment = "production"` withholds both, and nothing in
 * `/engine/status` says so — one HEAD, kept for the session. A raw fetch
 * rather than the API client: the route is not an admin route and is not in
 * the contract the client is tested against.
 */
export function useDocsServed() {
  return useQuery({
    queryKey: ["openapi-served"],
    queryFn: async () => {
      const res = await fetch("/api/v2/openapi.json", { method: "HEAD" })
      return res.ok || res.status === 405
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
}
