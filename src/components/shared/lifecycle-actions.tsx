import { Button } from "@/components/ui/button"
import type { EntityStatus, ValidationResponse } from "@/api/types"
import { Play, Archive, GitBranch, Trash2, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { ValidationResults } from "@/components/shared/validation-results"

interface LifecycleActionsProps {
  status: EntityStatus
  onActivate?: () => void
  onArchive?: () => void
  onNewVersion?: () => void
  onDelete?: () => void
  isPending?: boolean
  /**
   * Pre-flight the activation. Runs every gate the real transition runs —
   * draft existence, connector existence, route collisions, and (for channels)
   * the workflow-active gate — and reports the findings without writing.
   * Omit to keep the plain Activate button.
   */
  onPreflight?: () => void
  preflight?: ValidationResponse | null
  preflightPending?: boolean
  /**
   * Why activation is refused right now, when that is knowable *before* the
   * request. The button is disabled and carries this as its tooltip.
   *
   * Only for a gate the loaded entity already answers — a model whose
   * admission verdict is not `passed` (409), say. A gate that needs the server
   * to evaluate it belongs in the pre-flight, not here: disabling a button on
   * a guess is worse than a refusal that explains itself.
   */
  activateRefusedReason?: string | null
}

export function LifecycleActions({
  status,
  onActivate,
  onArchive,
  onNewVersion,
  onDelete,
  isPending,
  onPreflight,
  preflight,
  preflightPending,
  activateRefusedReason,
}: LifecycleActionsProps) {
  const [confirmAction, setConfirmAction] = useState<"archive" | "delete" | null>(null)

  return (
    <>
      <div className="flex items-center gap-2">
        {status === "draft" && onPreflight && (
          <Button size="sm" variant="outline" onClick={onPreflight} disabled={preflightPending}>
            <ShieldCheck className="h-3.5 w-3.5" />
            {preflightPending ? "Checking..." : "Pre-flight"}
          </Button>
        )}
        {status === "draft" && onActivate && (
          <Button
            size="sm"
            onClick={onActivate}
            disabled={isPending || !!activateRefusedReason}
            title={activateRefusedReason ?? undefined}
          >
            <Play className="h-3.5 w-3.5" />
            Activate
          </Button>
        )}
        {status === "active" && onArchive && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmAction("archive")}
            disabled={isPending}
          >
            <Archive className="h-3.5 w-3.5" />
            Archive
          </Button>
        )}
        {status === "active" && onNewVersion && (
          <Button size="sm" variant="outline" onClick={onNewVersion} disabled={isPending}>
            <GitBranch className="h-3.5 w-3.5" />
            New Version
          </Button>
        )}
        {onDelete && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmAction("delete")}
            disabled={isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        )}
      </div>

      {preflight && (
        <div className="mt-3">
          <ValidationResults result={preflight} validLabel="Ready to activate." />
        </div>
      )}

      {confirmAction === "archive" && onArchive && (
        <ConfirmDialog
          title="Archive"
          description="This will remove it from the engine and stop handling traffic. Are you sure?"
          onConfirm={() => {
            onArchive()
            setConfirmAction(null)
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "delete" && onDelete && (
        <ConfirmDialog
          title="Delete"
          description="This will permanently delete all versions. This action cannot be undone."
          onConfirm={() => {
            onDelete()
            setConfirmAction(null)
          }}
          onCancel={() => setConfirmAction(null)}
          destructive
        />
      )}
    </>
  )
}
