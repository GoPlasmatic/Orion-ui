import { useMemo } from "react"
import { useWorkflow } from "@/hooks/use-workflows"
import { useFunctions } from "@/hooks/use-functions"
import { retryRisks } from "@/lib/retry-safety"

/**
 * What a retry of `workflowId` could do twice. Reads the workflow's *current*
 * definition rather than the one a failed run used, because that is what a
 * retry runs: a requeue and an occurrence retry both execute the active
 * generation at claim time.
 */
export function useRetryRisks(workflowId: string | null | undefined) {
  const { data: workflow, isLoading: workflowLoading } = useWorkflow(workflowId ?? "")
  const { data: catalogue, isLoading: catalogueLoading } = useFunctions()
  const risks = useMemo(() => retryRisks(workflow?.tasks, catalogue), [workflow?.tasks, catalogue])
  return {
    risks,
    workflow,
    /** False until both the workflow and the catalogue have answered. */
    ready: !!workflowId && !workflowLoading && !catalogueLoading && !!workflow && !!catalogue,
  }
}
