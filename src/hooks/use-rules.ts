import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { rulesApi } from "@/api/rules"
import type { ListRulesParams, StatusChangeRequest, TestRuleRequest } from "@/api/types"

export function useRules(params: ListRulesParams = {}) {
  return useQuery({
    queryKey: ["rules", params],
    queryFn: () => rulesApi.list(params),
  })
}

export function useRule(id: string) {
  return useQuery({
    queryKey: ["rules", id],
    queryFn: () => rulesApi.get(id),
    enabled: !!id,
  })
}

export function useChangeRuleStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & StatusChangeRequest) =>
      rulesApi.changeStatus(id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] })
    },
  })
}

export function useTestRule() {
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & TestRuleRequest) =>
      rulesApi.test(id, req),
  })
}
