import * as React from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

export interface CheckboxProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  className?: string
  "aria-label"?: string
}

/**
 * Controlled checkbox drawn from tokens, so it matches Switch and the field
 * chrome instead of falling back to the OS control (which ignores the theme).
 */
const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ checked, onCheckedChange, disabled, id, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border-strong bg-card hover:border-ring",
        className
      )}
      {...props}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  )
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
