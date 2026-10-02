import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * A button that opens a small panel anchored under it — the overflow "More"
 * menu on a detail header, the display preferences in the header. Closes on
 * Escape (focus returns to the trigger), on a click outside, and once a
 * `MenuItem` is chosen.
 *
 * `role="menu"` only when every child is a `MenuItem`; a panel of form
 * controls (the display preferences) is a plain dialog-like group instead.
 */
export function PopoverMenu({
  trigger,
  label,
  children,
  align = "end",
  role = "menu",
  className,
  panelClassName,
}: {
  /** The trigger's content; the button itself is drawn here so it carries the ARIA wiring. */
  trigger: (props: { open: boolean }) => ReactNode
  /** Accessible name for the trigger and the panel. */
  label: string
  children: ReactNode
  align?: "start" | "end"
  role?: "menu" | "group"
  /** Classes on the trigger button. */
  className?: string
  panelClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    // Focus the first item so the keyboard lands inside the panel.
    const first = panelRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), select, input, a[href], [tabindex]:not([tabindex="-1"])'
    )
    first?.focus()
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation()
      close()
      return
    }
    if (role !== "menu" || !open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []
    )
    if (items.length === 0) return
    e.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length
    items[next].focus()
  }

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup={role === "menu" ? "menu" : "true"}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={className}
      >
        {trigger({ open })}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role={role}
          aria-label={label}
          // Choosing an item closes the menu; the item's own handler runs first.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[role="menuitem"]')) close()
          }}
          className={cn(
            "absolute top-full z-40 mt-1 min-w-44 rounded-lg border bg-card p-1 text-card-foreground shadow-lg animate-in fade-in-0 zoom-in-95 duration-100",
            align === "end" ? "right-0" : "left-0",
            panelClassName
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** One action in a `PopoverMenu`. */
export function MenuItem({
  onSelect,
  children,
  destructive,
  disabled,
  title,
}: {
  onSelect: () => void
  children: ReactNode
  destructive?: boolean
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-none transition-colors",
        "hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:size-3.5 [&_svg]:shrink-0",
        destructive && "text-destructive"
      )}
    >
      {children}
    </button>
  )
}
