import { useMemo } from "react"
import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-error"
import { workflowsApi } from "@/api/workflows"
import type {
  CreateWorkflowRequest,
  ImportOptions,
  ListWorkflowsParams,
  StatusChangeRequest,
  UpdateWorkflowRequest,
  WorkflowRolloutRequest,
  WorkflowTestRequest,
} from "@/api/types"

export function useCreateWorkflow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateWorkflowRequest) => workflowsApi.create(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] })
      toast.success("Workflow created as draft")
    },
    onError: (e) => toastError("Failed to create workflow", e),
  })
}

export function useUpdateWorkflow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateWorkflowRequest }) =>
      workflowsApi.update(id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] })
      toast.success("Workflow updated")
    },
    onError: (e) => toastError("Failed to update workflow", e),
  })
}

export function useSetWorkflowRollout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: WorkflowRolloutRequest }) =>
      workflowsApi.setRollout(id, req),
    onSuccess: (_data, { req }) => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] })
      toast.success(`Rollout set to ${req.rollout_percentage}%`)
    },
    onError: (e) => toastError("Failed to update rollout", e),
  })
}

export function useWorkflows(params: ListWorkflowsParams = {}, enabled = true) {
  return useQuery({
    queryKey: ["workflows", params],
    queryFn: () => workflowsApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
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

/**
 * The version that runs: the active one, or the newest when none is active.
 * `useWorkflow(id)` answers the *latest* version, which is the draft while
 * one is open — the wrong witness for what a retry or a requeue will execute.
 */
export function useActiveWorkflow(id: string) {
  const versions = useWorkflowVersions(id)
  const workflow = useMemo(() => {
    const rows = versions.data?.data ?? []
    return rows.find((w) => w.status === "active") ?? [...rows].sort((a, b) => b.version - a.version)[0] ?? null
  }, [versions.data])
  return { workflow, isLoading: versions.isLoading }
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
    onError: (e) => toastError("Failed to change workflow status", e),
  })
}

export function useTestWorkflow() {
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: WorkflowTestRequest }) =>
      workflowsApi.test(id, req),
  })
}

/**
 * What the workflow's tasks reference, per the server rather than per
 * client-side task parsing — see lib/topology.ts for why that distinction
 * matters.
 */
export function useWorkflowDependencies(id: string) {
  return useQuery({
    queryKey: ["workflows", id, "dependencies"],
    queryFn: () => workflowsApi.dependencies(id),
    enabled: !!id,
  })
}

export function useValidateWorkflow() {
  return useMutation({
    mutationFn: (req: unknown) => workflowsApi.validate(req),
  })
}

/**
 * Pre-flight a status transition. Untoasted: the findings render inline, and a
 * "failure" here is information, not an error.
 */
export function useWorkflowStatusDryRun() {
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: StatusChangeRequest }) =>
      workflowsApi.changeStatusDryRun(id, req),
  })
}

export function useImportWorkflows() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ items, ...opts }: { items: unknown[] } & ImportOptions) =>
      workflowsApi.import(items, opts),
    onSuccess: (result, { dryRun }) => {
      if (dryRun) return
      queryClient.invalidateQueries({ queryKey: ["workflows"] })
      toast.success(`Imported ${result.imported} workflow${result.imported !== 1 ? "s" : ""}`)
    },
    onError: (e) => toastError("Failed to import workflows", e),
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
    onError: (e) => toastError("Failed to create workflow version", e),
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
    onError: (e) => toastError("Failed to delete workflow", e),
  })
}
