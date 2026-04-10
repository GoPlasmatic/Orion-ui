import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { workflowsApi } from "@/api/workflows"
import type {
  ListWorkflowsParams,
  StatusChangeRequest,
  WorkflowRolloutRequest,
  WorkflowTestRequest,
} from "@/api/types"

export function useWorkflows(params: ListWorkflowsParams = {}) {
  return useQuery({
    queryKey: ["workflows", params],
    queryFn: () => workflowsApi.list(params),
  })
}

export function useWorkflow(id: string) {
  return useQuery({
    queryKey: ["workflows", id],
    queryFn: () => workflowsApi.get(id),
    enabled: !!id,
  })
}

export function useWorkflowVersions(id: string) {
  return useQuery({
    queryKey: ["workflows", id, "versions"],
    queryFn: () => workflowsApi.listVersions(id),
    enabled: !!id,
  })
}

export function useChangeWorkflowStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: StatusChangeRequest }) =>
      workflowsApi.changeStatus(id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] })
      queryClient.invalidateQueries({ queryKey: ["engine"] })
    },
  })
}

export function useSetWorkflowRollout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: WorkflowRolloutRequest }) =>
      workflowsApi.setRollout(id, req),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["workflows", id] })
    },
  })
}

export function useTestWorkflow() {
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: WorkflowTestRequest }) =>
      workflowsApi.test(id, req),
  })
}

export function useCreateWorkflowVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => workflowsApi.createVersion(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["workflows", id] })
      queryClient.invalidateQueries({ queryKey: ["workflows", id, "versions"] })
    },
  })
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => workflowsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] })
    },
  })
}
