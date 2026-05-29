import * as React from "react"

import { cn } from "@/lib/utils"

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

export interface DialogProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
  /** Accessible label for the dialog when no DialogTitle id is wired. */
  "aria-label"?: string
}

/**
 * Accessible modal: backdrop + centered panel, Esc-to-close, focus trap, and body
 * scroll lock while open. Replaces the hand-rolled `fixed inset-0` overlays used
 * before (e.g. ImportDialog). Compose with DialogHeader/Title/Body/Footer.
 */
export function Dialog({ open, onClose, children, className, ...props }: DialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)

  // Lock body scroll while open.
  React.useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Move focus into the panel on open.
  React.useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    const first = panel.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel).focus()
  }, [open])

  if (!open) return null

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== "Tab") return
    const panel = panelRef.current
    if (!panel) return
    const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => n.offsetParent !== null
    )
    if (nodes.length === 0) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const active = document.activeElement
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border bg-card text-card-foreground outline-none",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  )
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 border-b p-4", className)} {...props} />
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 space-y-3 overflow-y-auto p-4", className)} {...props} />
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex justify-end gap-2 border-t p-4", className)} {...props} />
}
