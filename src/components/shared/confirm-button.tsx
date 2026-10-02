import { useState, type ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Button, type ButtonProps } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"

/**
 * A button that asks first: the trigger, the confirming state and the
 * `ConfirmDialog`, with `onConfirm(close)` so the caller decides when the
 * dialog goes — `mutate(x, { onSettled: close })` keeps it open, its confirm
 * disabled by `pending`, until the request answers.
 *
 * Clicks are kept from bubbling out of both the trigger and the dialog (which
 * renders in place), so it can sit inside a row that opens on click.
 *
 * `trigger` replaces the default button — a menu item, say — and is handed
 * the function that opens the dialog.
 */
export function ConfirmButton({
  icon: Icon,
  label,
  pendingLabel,
  pending = false,
  variant = "outline",
  size = "sm",
  title,
  disabled,
  trigger,
  dialog,
  onConfirm,
}: {
  icon?: LucideIcon
  label: string
  /** Shown on the trigger while `pending`. */
  pendingLabel?: string
  /** The confirmed action is in flight: the trigger and the dialog's confirm are disabled. */
  pending?: boolean
  variant?: ButtonProps["variant"]
  size?: ButtonProps["size"]
  title?: string
  disabled?: boolean
  trigger?: (open: () => void) => ReactNode
  dialog: {
    title: string
    description: ReactNode
    confirmLabel?: string
    /** Type-to-confirm: the exact text the confirm waits for. */
    confirmText?: string
    destructive?: boolean
  }
  /** Run the action; call `close` when the dialog should go (now, or once it settles). */
  onConfirm: (close: () => void) => void
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={disabled || pending}
          title={title}
          onClick={(e) => {
            e.stopPropagation()
            setOpen(true)
          }}
        >
          {Icon && <Icon className={size === "sm" ? "h-3.5 w-3.5" : undefined} />}
          {pending && pendingLabel ? pendingLabel : label}
        </Button>
      )}
      {open && (
        <div onClick={(e) => e.stopPropagation()} className="contents">
          <ConfirmDialog
            title={dialog.title}
            description={dialog.description}
            confirmLabel={dialog.confirmLabel ?? label}
            confirmText={dialog.confirmText}
            destructive={dialog.destructive}
            pending={pending}
            onConfirm={() => onConfirm(close)}
            onCancel={close}
          />
        </div>
      )}
    </>
  )
}
