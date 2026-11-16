import { useId, useState } from "react"
import { Link } from "react-router"
import { useDeployment, useRollback } from "@/hooks/use-deployments"
import { ApiError } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RevisionChanges } from "@/components/deployments/revision-changes"
import { describeError } from "@/lib/toast-error"
import type { CreateDeploymentResponse } from "@/api/types"

/** A fresh idempotency key for one rollback attempt. */
function newKey(target: number): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `ui-rollback-${target}-${random}`
}

/**
 * Roll back to `target`: commit its manifest again as the next revision,
 * on top of `head`. The preview is the diff from the head to the target —
 * exactly what the rollback changes. The idempotency key is minted when the
 * dialog opens and kept until it closes, so retrying after a dropped
 * response replays the first commit instead of making a second.
 */
export function RollbackDialog({
  target,
  head,
  onClose,
  onHeadMoved,
}: {
  target: number
  head: number
  onClose: () => void
  /** The head moved under the dialog (409): the caller refreshes it, and the dialog reopens against the new one. */
  onHeadMoved: () => void
}) {
  const [key] = useState(() => newKey(target))
  const [reason, setReason] = useState(`Roll back to revision ${target}`)
  const [result, setResult] = useState<CreateDeploymentResponse | null>(null)
  const reasonId = useId()
  const from = useDeployment(head)
  const to = useDeployment(target)
  const rollback = useRollback()
  const conflict = rollback.error instanceof ApiError && rollback.error.code === "DEPLOYMENT_HEAD_CONFLICT"

  const submit = () => {
    if (!reason.trim() || rollback.isPending) return
    rollback.mutate(
      {
        req: { idempotency_key: key, base_revision: head, rollback_to: target, reason: reason.trim() },
        changeContext: `orion-ui rollback to ${target}`,
      },
      { onSuccess: setResult },
    )
  }

  if (result) {
    return (
      <Dialog open onClose={onClose} className="max-w-xl" aria-label="Rolled back">
        <DialogHeader>
          <DialogTitle>Committed revision {result.committed_revision}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Revision {result.committed_revision} carries revision {target}'s manifest. Each node rebuilds
            onto it by itself.
          </p>
          {result.local_error ? (
            <Callout variant="destructive">
              The node that took the write could not build it and keeps serving the revision before:{" "}
              {result.local_error}
            </Callout>
          ) : (
            <Callout variant={result.evaluation.converged ? "success" : "info"}>
              {result.evaluation.converged
                ? "This node already serves it."
                : "This node is still building it."}
            </Callout>
          )}
          {result.warnings.length > 0 && (
            <Callout variant="warning">
              <ul className="list-disc space-y-1 pl-4">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Callout>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button asChild>
            <Link to={`/deployments/${result.committed_revision}?tab=convergence`} onClick={onClose}>
              Watch convergence
            </Link>
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  return (
    <Dialog open onClose={onClose} className="max-w-3xl" aria-label={`Roll back to revision ${target}`}>
      <DialogHeader>
        <DialogTitle>Roll back to revision {target}?</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <DialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Revision {target}'s manifest is committed again as revision {head + 1}, on top of the head
            ({head}). Nothing is deleted: history keeps every revision. A rollback does not undo what
            already happened outside the server — rows written, messages sent.
          </p>
          {from.isLoading || to.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : from.data && to.data ? (
            <RevisionChanges
              before={from.data.manifest.members}
              after={to.data.manifest.members}
              emptyText={`Revision ${target} serves exactly what the head does: the rollback changes nothing but the revision number.`}
            />
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor={reasonId} required>
              Reason
            </Label>
            <Input id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="text-xs text-muted-foreground">Recorded on the revision and in the audit log.</p>
          </div>
          {conflict ? (
            <Callout variant="warning">
              The head moved past revision {head} while this was open. Review the rollback against the new
              head.{" "}
              <button type="button" className="font-medium underline underline-offset-2" onClick={onHeadMoved}>
                Reload the head
              </button>
            </Callout>
          ) : rollback.error ? (
            <Callout variant="destructive">{describeError(rollback.error)}</Callout>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={!reason.trim() || rollback.isPending || conflict}>
            {rollback.isPending ? "Rolling back…" : `Roll back to ${target}`}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
