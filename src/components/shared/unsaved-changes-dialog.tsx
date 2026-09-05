import type { useBlocker } from "react-router"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"

type Blocker = ReturnType<typeof useBlocker>

/** Pairs with `useUnsavedChanges`: the question, when a navigation was stopped. */
export function UnsavedChangesDialog({ blocker }: { blocker: Blocker }) {
  if (blocker.state !== "blocked") return null
  return (
    <ConfirmDialog
      title="Leave without saving?"
      description="This form has changes that have not been saved. Leaving discards them."
      destructive
      onConfirm={() => blocker.proceed()}
      onCancel={() => blocker.reset()}
    />
  )
}
