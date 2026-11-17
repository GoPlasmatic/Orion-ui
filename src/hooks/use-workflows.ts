import { useMemo } from "react"
import { useMutation } from "@tanstack/react-query"
import { definitionsApi } from "@/api/definitions"
import { useRegistry } from "@/hooks/use-registry"
import type { TestDefinitionRequest } from "@/api/types"

/** Every deployed workflow, one per id (its primary revision). Reads the head manifest (`useRegistry`). */
export function useWorkflows() {
  const registry = useRegistry()
  return { data: registry.workflows, isLoading: registry.isLoading, error: registry.error, empty: registry.empty, refetch: registry.refetch }
}

/**
 * One deployed workflow: its primary revision — the one serving the most of
 * its channels' buckets, which is what a retry or a requeue most likely runs
 * — and every revision the head deploys (more than one only under a canary).
 */
export function useWorkflow(id: string) {
  const registry = useRegistry()
  const workflow = useMemo(() => registry.workflows.find((w) => w.workflow_id === id), [registry.workflows, id])
  const revisions = useMemo(
    () => registry.workflowRevisions.filter((w) => w.workflow_id === id),
    [registry.workflowRevisions, id],
  )
  return {
    data: workflow,
    revisions,
    isLoading: registry.isLoading && !workflow,
    error: registry.error,
    refetch: registry.refetch,
    notDeployed: !registry.isLoading && !registry.error && !workflow,
  }
}

/**
 * Run a workflow definition once, without deploying it. Untoasted: the run
 * renders inline, and a run that stopped short is information, not an error.
 */
export function useTestDefinition() {
  return useMutation({ mutationFn: (req: TestDefinitionRequest) => definitionsApi.test(req) })
}
