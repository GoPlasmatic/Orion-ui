import { useContext, useState, type ReactNode } from "react"
import { MoreHorizontal, Trash2 } from "lucide-react"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { MenuItem, PopoverMenu } from "@/components/admin/popover-menu"
import { DetailTitleContext } from "@/components/admin/detail-context"
import { cn } from "@/lib/utils"

/**
 * The overflow menu on a detail header. Delete lives here rather than as the
 * header's loudest button: on an active entity the solid red Delete used to
 * be the most prominent control on the page, for the one action that cannot
 * be undone. Here it takes two deliberate steps — open the menu, then type
 * the entity's name.
 *
 * `entityName` defaults to the enclosing `DetailHeader`'s title.
 */
export function MoreActions({
  onDelete,
  entityName,
  deleteDescription = "This permanently deletes every version. It cannot be undone.",
  disabled,
  children,
}: {
  onDelete?: () => void
  entityName?: string
  deleteDescription?: ReactNode
  disabled?: boolean
  /** Extra `MenuItem`s above Delete. */
  children?: ReactNode
}) {
  const title = useContext(DetailTitleContext)
  const name = entityName ?? title ?? "delete"
  const [confirming, setConfirming] = useState(false)

  if (!onDelete && !children) return null

  return (
    <>
      <PopoverMenu
        label="More actions"
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-card text-muted-foreground shadow-xs transition-colors outline-none",
          "hover:border-border-strong hover:bg-accent hover:text-accent-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "aria-expanded:bg-accent aria-expanded:text-accent-foreground"
        )}
        trigger={() => <MoreHorizontal className="h-4 w-4" />}
      >
        {children}
        {onDelete && (
          <MenuItem destructive disabled={disabled} onSelect={() => setConfirming(true)}>
            <Trash2 /> Delete…
          </MenuItem>
        )}
      </PopoverMenu>
      {confirming && onDelete && (
        <ConfirmDialog
          title={`Delete ${name}?`}
          description={deleteDescription}
          confirmText={name}
          confirmLabel="Delete"
          destructive
          pending={disabled}
          onConfirm={() => {
            setConfirming(false)
            onDelete()
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
