import { useState } from "react"
import type { CronOccurrenceSummary } from "@/api/types"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { useCancelOccurrence } from "@/hooks/use-cron"
import { Ban } from "lucide-react"

/**
 * What `POST admin/cron/occurrences/{id}/cancel` accepts (1.10): an attempt
 * not yet settled. A finished one answers 409, so the action is not offered.
 */
const CANCELLABLE: ReadonlySet<string> = new Set(["pending", "claimed", "running"])

/**
 * Cancel for one occurrence, with the confirmation that says what cancelling
 * does to the lease: the attempt is settled as `failed`, and the singleton
 * slot it held frees within two scheduler heartbeats — so the next run of the
 * key can start before this one's work has necessarily stopped.
 *
 * Renders nothing for a status the server would refuse.
 */
export function CancelOccurrenceButton({
  occurrence,
  size = "xs",
}: {
  occurrence: Pick<CronOccurrenceSummary, "id" | "status" | "channel_name">
  size?: "xs" | "sm"
}) {
  const [confirming, setConfirming] = useState(false)
  const cancel = useCancelOccurrence()

  if (!CANCELLABLE.has(occurrence.status)) return null

  return (
    <>
      <Button
        variant="outline"
        size={size}
        disabled={cancel.isPending}
        onClick={(e) => {
          e.stopPropagation()
          setConfirming(true)
        }}
        title="Stop this attempt and settle it as failed"
      >
        <Ban className={size === "sm" ? "h-3.5 w-3.5" : undefined} />
        {cancel.isPending ? "Cancelling..." : "Cancel"}
      </Button>
      {confirming && (
        // The dialog renders in place, inside a table row that opens the
        // occurrence on click; keep its clicks from reaching the row.
        <div onClick={(e) => e.stopPropagation()} className="contents">
          <ConfirmDialog
            title="Cancel occurrence"
            confirmLabel="Cancel occurrence"
            destructive
            pending={cancel.isPending}
            description={
              <>
                <p>
                  The {occurrence.status} attempt of{" "}
                  <span className="font-medium text-foreground">{occurrence.channel_name}</span> is
                  settled as <code className="font-mono">failed</code>, and its trace with it.
                </p>
                <p>
                  The lease is released: the singleton slot it holds frees within two scheduler
                  heartbeats, so the next run of the key can start. Work the workflow already did
                  (a write, a call out) is not undone. A failed occurrence can be retried later.
                </p>
              </>
            }
            onConfirm={() =>
              cancel.mutate(occurrence.id, { onSettled: () => setConfirming(false) })
            }
            onCancel={() => setConfirming(false)}
          />
        </div>
      )}
    </>
  )
}
