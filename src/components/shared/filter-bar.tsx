import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * The filter row above a list table. Exists so every list page lays its filters
 * out identically and so the controls stay at a sane width — a bare
 * `<Select>` is `w-full`, which stretched two dropdowns across the whole page.
 * Give each control an explicit width (`FILTER_W` unless it needs more).
 */
export function FilterBar({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>
  )
}

/** Default width for a filter control, so rows line up across pages. */
export const FILTER_W = "w-full sm:w-44"
