import { useQuery } from "@tanstack/react-query"
import { engineApi } from "@/api/engine"

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => engineApi.health(),
    refetchInterval: 15000,
  })
}
