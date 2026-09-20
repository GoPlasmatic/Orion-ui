import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-error"
import { engineApi } from "@/api/engine"
import { countLoadIssues } from "@/api/types"

export function useEngineStatus() {
  return useQuery({
    queryKey: ["engine", "status"],
    queryFn: () => engineApi.status(),
    refetchInterval: 30000,
  })
}

/**
 * Rebuild the running generation.
 *
 * A reload does not *fail* because an entity did not load — the entity is
 * quarantined and everything else serves — so a 200 here is not proof that
 * what was activated is serving. Since 1.9 the answer carries the generation
 * it published and what that generation refused, which is what the toast
 * reports: "reloaded" alone was the one word that could not be trusted.
 *
 * `/health` is invalidated too: a quarantine this reload created is what its
 * `channels`, `connectors`, `plugins` and `models` components are about.
 */
export function useEngineReload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => engineApi.reload(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["engine"] })
      queryClient.invalidateQueries({ queryKey: ["health"] })
      const quarantined = countLoadIssues(result.load_issues)
      const generation =
        result.generation != null && result.generation > 0 ? ` (generation ${result.generation})` : ""
      if (quarantined > 0) {
        toast.warning(
          `Engine reloaded${generation} — ${quarantined} ${quarantined === 1 ? "entity is" : "entities are"} not serving`,
          { description: "The reload succeeded; these were quarantined. See the generation report on the Engine page." },
        )
      } else {
        toast.success(`Engine reloaded${generation}`)
      }
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
