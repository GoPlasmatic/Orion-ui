import { Button } from "@/components/ui/button"
import type { EntityStatus, ValidationResponse } from "@/api/types"
import { Play, Archive, GitBranch, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { ValidationResults } from "@/components/shared/validation-results"
import { MoreActions } from "@/components/admin/more-actions"

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
  /**
   * The name a delete is confirmed by typing. Defaults to the enclosing
   * `DetailHeader`'s title, which is what every detail page shows.
   */
  entityName?: string
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
  entityName,
}: LifecycleActionsProps) {
  const [confirmArchive, setConfirmArchive] = useState(false)

  // One primary action, and it follows the lifecycle: a draft's next step is
  // Activate, an active entity's is a new version to change it. Archive is a
  // secondary outline button; Delete sits in the overflow menu behind
  // type-to-confirm (`MoreActions`).
  return (
    <>
      <div className="flex items-center gap-2">
        {status === "draft" && onPreflight && (
          <Button size="sm" variant="outline" onClick={onPreflight} disabled={preflightPending}>
            <ShieldCheck className="h-3.5 w-3.5" />
            {preflightPending ? "Checking..." : "Pre-flight"}
          </Button>
        )}
        {status === "active" && onArchive && (
          <Button size="sm" variant="outline" onClick={() => setConfirmArchive(true)} disabled={isPending}>
            <Archive className="h-3.5 w-3.5" />
            Archive
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
        {status === "active" && onNewVersion && (
          <Button size="sm" onClick={onNewVersion} disabled={isPending}>
            <GitBranch className="h-3.5 w-3.5" />
            New Version
          </Button>
        )}
        <MoreActions
          onDelete={onDelete}
          entityName={entityName}
          disabled={isPending}
          deleteDescription="This permanently deletes every version — drafts, the active one and the archive. It cannot be undone; archiving keeps the history."
        />
      </div>

      {preflight && (
        <div className="mt-3">
          <ValidationResults result={preflight} validLabel="Ready to activate." />
        </div>
      )}

      {confirmArchive && onArchive && (
        <ConfirmDialog
          title="Archive"
          description="This will remove it from the engine and stop handling traffic. Are you sure?"
          onConfirm={() => {
            onArchive()
            setConfirmArchive(false)
          }}
          onCancel={() => setConfirmArchive(false)}
        />
      )}
    </>
  )
}
