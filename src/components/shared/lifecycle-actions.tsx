import { Button } from "@/components/ui/button"
import type { EntityStatus } from "@/api/types"
import { Play, Archive, GitBranch, Trash2 } from "lucide-react"
import { useState } from "react"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"

interface LifecycleActionsProps {
  status: EntityStatus
  onActivate?: () => void
  onArchive?: () => void
  onNewVersion?: () => void
  onDelete?: () => void
  isPending?: boolean
}

export function LifecycleActions({
  status,
  onActivate,
  onArchive,
  onNewVersion,
  onDelete,
  isPending,
}: LifecycleActionsProps) {
  const [confirmAction, setConfirmAction] = useState<"archive" | "delete" | null>(null)

  return (
    <>
      <div className="flex items-center gap-2">
        {status === "draft" && onActivate && (
          <Button size="sm" onClick={onActivate} disabled={isPending}>
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
