import type { CronOccurrenceSummary } from "@/api/types"
import { ConfirmButton } from "@/components/shared/confirm-button"
import { useCancelOccurrence } from "@/hooks/use-cron"
import { isCancellable } from "@/lib/cron"
import { Ban } from "lucide-react"

/**
 * Cancel for one occurrence, with the confirmation that says what cancelling
 * does to the lease: the attempt is settled as `failed`, and the singleton
 * slot it held frees within two scheduler heartbeats — so the next run of the
 * key can start before this one's work has necessarily stopped.
 *
 * Renders nothing for a status the server would refuse (409 once settled).
 */
export function CancelOccurrenceButton({
  occurrence,
  size = "xs",
}: {
  occurrence: Pick<CronOccurrenceSummary, "id" | "status" | "channel_name">
  size?: "xs" | "sm"
}) {
  const cancel = useCancelOccurrence()
  if (!isCancellable(occurrence.status)) return null

  return (
    <ConfirmButton
      icon={Ban}
      label="Cancel"
      pendingLabel="Cancelling..."
      pending={cancel.isPending}
      size={size}
      title="Stop this attempt and settle it as failed"
      dialog={{
        title: "Cancel occurrence",
        confirmLabel: "Cancel occurrence",
        destructive: true,
        description: (
          <>
            <p>
              The {occurrence.status} attempt of{" "}
              <span className="font-medium text-foreground">{occurrence.channel_name}</span> is
              settled as <code className="font-mono">failed</code>, and its trace with it.
            </p>
            <p>
              The lease is released: the singleton slot it holds frees within two scheduler
              heartbeats, so the next run of the key can start. Work the workflow already did (a
              write, a call out) is not undone. A failed occurrence can be retried later.
            </p>
          </>
        ),
      }}
      onConfirm={(close) => cancel.mutate(occurrence.id, { onSettled: close })}
    />
  )
}
