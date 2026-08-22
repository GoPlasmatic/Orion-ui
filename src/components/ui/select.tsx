import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { fieldBase } from "./field"

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Escape hatch for styling the <select> itself; `className` sizes the control. */
  selectClassName?: string
}

/**
 * Native <select> with the shared field chrome. The browser's own arrow is
 * suppressed (`appearance-none`) and replaced with a lucide chevron so it tracks
 * --muted-foreground in both themes; the wrapper carries `className` so callers
 * keep sizing the control the way they always have (e.g. `className="w-40"`).
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, selectClassName, children, ...props }, ref) => {
    return (
      <div className={cn("relative w-full", className)}>
        <select
          ref={ref}
          className={cn(
            fieldBase,
            "h-9 cursor-pointer appearance-none py-2 pl-3 pr-9 text-sm",
            selectClassName
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    )
  }
)
Select.displayName = "Select"

const SelectOption = React.forwardRef<
  HTMLOptionElement,
  React.OptionHTMLAttributes<HTMLOptionElement>
>(({ className, ...props }, ref) => {
  return (
    <option
      ref={ref}
      className={cn("bg-popover text-popover-foreground", className)}
      {...props}
    />
  )
})
SelectOption.displayName = "SelectOption"

export { Select, SelectOption }
