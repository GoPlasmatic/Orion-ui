import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-error"
import { engineApi } from "@/api/engine"

export function useEngineStatus() {
  return useQuery({
    queryKey: ["engine", "status"],
    queryFn: () => engineApi.status(),
    refetchInterval: 30000,
  })
}

export function useEngineReload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => engineApi.reload(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["engine"] })
      toast.success("Engine reloaded")
    },
    onError: (e) =>
      toastError("Failed to reload engine", e),
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
      const res = await fetch("/api/v1/openapi.json", { method: "HEAD" })
      return res.ok || res.status === 405
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
}
