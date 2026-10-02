import { useId, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"

interface ConfirmDialogProps {
  title: string
  description: ReactNode
  onConfirm: () => void
  onCancel: () => void
  destructive?: boolean
  /** The confirm button's label; "Confirm" when omitted. */
  confirmLabel?: string
  /**
   * Type-to-confirm: the confirm button stays disabled until this exact text
   * is typed. For an action that cannot be undone (deleting every version of
   * an entity), where a reflexive click on a modal is the failure to guard.
   */
  confirmText?: string
  /** Disables the confirm button while the action is in flight. */
  pending?: boolean
}

export function ConfirmDialog({
  title,
  description,
  onConfirm,
  onCancel,
  destructive,
  confirmLabel = "Confirm",
  confirmText,
  pending,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("")
  const inputId = useId()
  const matches = confirmText == null || typed === confirmText

  return (
    <Dialog open onClose={onCancel} className="max-w-md" aria-label={title}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        {typeof description === "string" ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : (
          <div className="space-y-2 text-sm text-muted-foreground">{description}</div>
        )}
        {confirmText != null && (
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (matches && !pending) onConfirm()
            }}
          >
            <label htmlFor={inputId} className="block text-sm">
              Type <code className="rounded bg-muted px-1 font-mono text-xs">{confirmText}</code> to
              confirm
            </label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </form>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant={destructive ? "destructive" : "default"}
          onClick={onConfirm}
          disabled={!matches || pending}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
