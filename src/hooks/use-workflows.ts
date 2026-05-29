import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { workflowsApi } from "@/api/workflows"
import type {
  ListWorkflowsParams,
  StatusChangeRequest,
  WorkflowRolloutRequest,
  WorkflowTestRequest,
} from "@/api/types"

const errorDescription = (e: unknown) => (e instanceof Error ? e.message : undefined)

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
    onSuccess: (_data, { req }) => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] })
      queryClient.invalidateQueries({ queryKey: ["engine"] })
      toast.success(`Workflow ${req.status === "active" ? "activated" : req.status}`)
    },
    onError: (e) => toast.error("Failed to change workflow status", { description: errorDescription(e) }),
  })
}

export function useSetWorkflowRollout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: WorkflowRolloutRequest }) =>
      workflowsApi.setRollout(id, req),
    onSuccess: (_data, { id, req }) => {
      queryClient.invalidateQueries({ queryKey: ["workflows", id] })
      toast.success(`Rollout set to ${req.rollout_percentage}%`)
    },
    onError: (e) => toast.error("Failed to set rollout", { description: errorDescription(e) }),
  })
}

export function useTestWorkflow() {
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: WorkflowTestRequest }) =>
      workflowsApi.test(id, req),
  })
}

export function useValidateWorkflow() {
  return useMutation({
    mutationFn: (req: unknown) => workflowsApi.validate(req),
  })
}

export function useImportWorkflows() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ items, dryRun }: { items: unknown[]; dryRun: boolean }) =>
      workflowsApi.import(items, dryRun),
    onSuccess: (result, { dryRun }) => {
      if (dryRun) return
      queryClient.invalidateQueries({ queryKey: ["workflows"] })
      toast.success(`Imported ${result.imported} workflow${result.imported !== 1 ? "s" : ""}`)
    },
    onError: (e) => toast.error("Failed to import workflows", { description: errorDescription(e) }),
  })
}

export function useCreateWorkflowVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => workflowsApi.createVersion(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["workflows", id] })
      queryClient.invalidateQueries({ queryKey: ["workflows", id, "versions"] })
      toast.success("New workflow version created")
    },
    onError: (e) => toast.error("Failed to create workflow version", { description: errorDescription(e) }),
  })
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => workflowsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] })
      toast.success("Workflow deleted")
    },
    onError: (e) => toast.error("Failed to delete workflow", { description: errorDescription(e) }),
  })
}
