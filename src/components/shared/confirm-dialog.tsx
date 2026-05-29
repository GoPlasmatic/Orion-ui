import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"

interface ConfirmDialogProps {
  title: string
  description: string
  onConfirm: () => void
  onCancel: () => void
  destructive?: boolean
}

export function ConfirmDialog({
  title,
  description,
  onConfirm,
  onCancel,
  destructive,
}: ConfirmDialogProps) {
  return (
    <Dialog open onClose={onCancel} className="max-w-md" aria-label={title}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <p className="text-sm text-muted-foreground">{description}</p>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
          Confirm
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
