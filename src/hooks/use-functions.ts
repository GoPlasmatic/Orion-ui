import { useQuery } from "@tanstack/react-query"
import { functionsApi } from "@/api/functions"

export function useFunctions() {
  return useQuery({
    queryKey: ["functions"],
    queryFn: () => functionsApi.list(),
    // The built-in half is compiled into the server binary and only changes on
    // deploy, but since 1.6 the catalogue also carries every active plugin's
    // functions, so it moves when a plugin is activated or archived. The
    // plugin mutations invalidate this key; the stale window covers a peer's
    // activation in cluster mode.
    staleTime: 60 * 1000,
  })
}
