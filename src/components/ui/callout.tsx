import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"

const calloutVariants = cva(
  "flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm [&_a]:underline [&_a]:underline-offset-2",
  {
    variants: {
      variant: {
        info: "border-info/40 bg-info/10 text-info",
        success: "border-success/40 bg-success/10 text-success",
        warning: "border-warning/40 bg-warning/10 text-warning",
        destructive: "border-destructive/40 bg-destructive/10 text-destructive",
        muted: "border-border bg-muted/50 text-muted-foreground",
      },
    },
    defaultVariants: { variant: "info" },
  }
)

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
  muted: Info,
} as const

export interface CalloutProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof calloutVariants> {
  /** Set false for dense stacks (e.g. one row per validation error). */
  icon?: boolean
}

/**
 * The inline status banner: form save errors, validation verdicts, dry-run
 * warnings. Replaces the hand-rolled
 * `rounded-md border border-X/40 bg-X/10 … text-X` divs that had drifted across
 * the forms, and keeps them on the semantic tokens rather than chart-*.
 */
const Callout = React.forwardRef<HTMLDivElement, CalloutProps>(
  ({ className, variant, icon = true, children, ...props }, ref) => {
    const Icon = ICONS[variant ?? "info"]
    return (
      <div ref={ref} className={cn(calloutVariants({ variant }), className)} {...props}>
        {icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    )
  }
)
Callout.displayName = "Callout"

export { Callout }
