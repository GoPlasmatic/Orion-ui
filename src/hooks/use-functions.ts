import { useQuery } from "@tanstack/react-query"
import { functionsApi } from "@/api/functions"

export function useFunctions() {
  return useQuery({
    queryKey: ["functions"],
    queryFn: () => functionsApi.list(),
    // The registry is compiled into the server binary; it only changes on deploy.
    staleTime: 5 * 60 * 1000,
  })
}
