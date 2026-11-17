import { useMemo } from "react"
import { useWorkflow } from "@/hooks/use-workflows"
import { useFunctions } from "@/hooks/use-functions"
import { workflowSteps } from "@/lib/workflow-steps"
import { retryRisks } from "@/lib/retry-safety"

/**
 * What a retry of `workflowId` could do twice. Reads the revision the head
 * deploys — a requeue and an occurrence retry both execute the node's current
 * generation at claim time, not the one the failed run saw. Under a canary it
 * is the primary revision (the larger share); the split is per message.
 */
export function useRetryRisks(workflowId: string | null | undefined) {
  const { data: workflow, isLoading: workflowLoading } = useWorkflow(workflowId ?? "")
  const { data: catalogue, isLoading: catalogueLoading } = useFunctions()
  const risks = useMemo(() => retryRisks(workflowSteps(workflow), catalogue), [workflow, catalogue])
  return {
    risks,
    workflow,
    /** False until both the workflow and the catalogue have answered. */
    ready: !!workflowId && !workflowLoading && !catalogueLoading && !!workflow && !!catalogue,
  }
}
