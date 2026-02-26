import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
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
    },
  })
}
