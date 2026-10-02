import { useContext, type ReactNode } from "react"
import { MoreHorizontal, Trash2 } from "lucide-react"
import { ConfirmButton } from "@/components/shared/confirm-button"
import { MenuItem, PopoverMenu } from "@/components/ui/popover-menu"
import { DetailTitleContext } from "@/components/admin/detail-context"

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

  if (!onDelete && !children) return null

  const menu = (openDelete?: () => void) => (
    <PopoverMenu label="More actions" trigger={() => <MoreHorizontal className="h-4 w-4" />}>
      {children}
      {openDelete && (
        <MenuItem destructive disabled={disabled} onSelect={openDelete}>
          <Trash2 /> Delete…
        </MenuItem>
      )}
    </PopoverMenu>
  )

  if (!onDelete) return menu()

  // The dialog sits beside the menu, not inside it: the menu's panel unmounts
  // the moment an item is chosen.
  return (
    <ConfirmButton
      label="Delete"
      pending={disabled}
      trigger={menu}
      dialog={{
        title: `Delete ${name}?`,
        description: deleteDescription,
        confirmText: name,
        destructive: true,
      }}
      onConfirm={(close) => {
        close()
        onDelete()
      }}
    />
  )
}
