import { Link } from "react-router"
import { Callout } from "@/components/ui/callout"
import { useRetryRisks } from "@/hooks/use-retry-safety"
import { countLeafSteps } from "@/lib/workflow-steps"
import { cn } from "@/lib/utils"

/**
 * The guard in front of a requeue or an occurrence retry: which of the
 * workflow's tasks a second run may repeat with a second effect. Renders
 * nothing while the answer is unknown, a quiet line when every task is safe,
 * and a warning naming the tasks when one is not. The decision stays with the
 * operator — a duplicate email is sometimes the right price for a delivery.
 */
export function RetrySafetyWarning({
  workflowId,
  action = "A retry",
  className,
}: {
  workflowId: string | null | undefined
  /** The verb phrase the sentence starts with: "A requeue", "Retrying this occurrence". */
  action?: string
  className?: string
}) {
  const { risks, workflow, ready } = useRetryRisks(workflowId)
  if (!workflowId || !ready || !workflow) return null

  const tasks = countLeafSteps(workflow.tasks)
  if (risks.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {action} re-runs <span className="font-mono">{workflow.workflow_id}</span> from the start;
        every one of its {tasks} {tasks === 1 ? "task is" : "tasks are"} safe to run again.
      </p>
    )
  }

  return (
    <Callout variant="warning" className={className}>
      <p className="text-sm font-medium">
        {action} re-runs{" "}
        <Link to={`/workflows/${workflow.workflow_id}`} className="font-mono underline underline-offset-2">
          {workflow.workflow_id}
        </Link>{" "}
        from the start, and {risks.length} of its {tasks} {tasks === 1 ? "task" : "tasks"} may repeat
        a side effect:
      </p>
      <ul className="mt-1 space-y-0.5 text-xs">
        {risks.map((r) => (
          <li key={`${r.task}-${r.function}`}>
            <span className="font-mono">{r.task}</span>{" "}
            <span className="text-muted-foreground">
              ({r.function}) —{" "}
              {r.kind === "unsafe_write"
                ? "unsafe to retry: a second run duplicates the effect"
                : `depends on its ${r.input ?? "input"}: an upsert repeats safely, an insert does not`}
            </span>
          </li>
        ))}
      </ul>
    </Callout>
  )
}
