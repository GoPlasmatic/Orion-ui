import * as React from "react"

import { cn } from "@/lib/utils"

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Appends a destructive asterisk. */
  required?: boolean
  /** Secondary line under the label, for units/format hints. */
  hint?: React.ReactNode
}

/**
 * The form-label primitive. Every field caption should use it rather than a bare
 * <label> so weight, size and the required marker stay consistent across the
 * channel / connector / workflow forms and the config editors.
 */
const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, hint, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "mb-1.5 block text-sm font-medium leading-none text-foreground peer-disabled:opacity-60",
        className
      )}
      {...props}
    >
      {children}
      {required && <span className="ml-0.5 text-destructive">*</span>}
      {hint && (
        <span className="mt-1 block text-xs font-normal text-muted-foreground">{hint}</span>
      )}
    </label>
  )
)
Label.displayName = "Label"

export { Label }
