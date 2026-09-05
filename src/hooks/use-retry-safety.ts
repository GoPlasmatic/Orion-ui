import { useMemo } from "react"
import { useActiveWorkflow } from "@/hooks/use-workflows"
import { useFunctions } from "@/hooks/use-functions"
import { retryRisks } from "@/lib/retry-safety"

/**
 * What a retry of `workflowId` could do twice. Reads the *active* version —
 * a requeue and an occurrence retry both execute the active generation at
 * claim time — not the latest, which is the draft while one is open.
 */
export function useRetryRisks(workflowId: string | null | undefined) {
  const { workflow, isLoading: workflowLoading } = useActiveWorkflow(workflowId ?? "")
  const { data: catalogue, isLoading: catalogueLoading } = useFunctions()
  const risks = useMemo(() => retryRisks(workflow?.tasks, catalogue), [workflow?.tasks, catalogue])
  return {
    risks,
    workflow,
    /** False until both the workflow and the catalogue have answered. */
    ready: !!workflowId && !workflowLoading && !catalogueLoading && !!workflow && !!catalogue,
  }
}
