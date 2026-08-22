import type { EntityStatus } from "@/api/types"

// Single source of truth for status → color across the app. Colors are built from
// the semantic --success / --warning / --info / --destructive tokens, which carry
// a *readable* ink value per theme (the raw brand green and amber fall to ~2:1 as
// text on white). Standardised on the outline Badge variant + a tinted className,
// avoiding the filled-variant look for a calmer, on-brand palette.
//
// Do not reach for chart-* here: those are data-viz fills, tuned for area against
// a background rather than for text contrast.

const NEUTRAL = "border-border text-muted-foreground bg-muted/40"
const GOOD = "border-success/40 text-success bg-success/10"
const INFO = "border-info/40 text-info bg-info/10"
const WARN = "border-warning/40 text-warning bg-warning/10"
const BAD = "border-destructive/40 text-destructive bg-destructive/10"

// Entity lifecycle: draft / active / archived
export const entityStatusClass: Record<EntityStatus, string> = {
  draft: INFO,
  active: GOOD,
  archived: NEUTRAL,
}

// Trace status: pending / running / completed / failed
export const traceStatusClass: Record<string, string> = {
  completed: GOOD,
  running: INFO,
  pending: NEUTRAL,
  failed: BAD,
}

export function traceStatusBadgeClass(status: string): string {
  return traceStatusClass[status] ?? NEUTRAL
}

// Per-task execution result: executed / skipped / error
export const stepResultClass: Record<string, string> = {
  executed: GOOD,
  skipped: NEUTRAL,
  error: BAD,
}

export function stepResultBadgeClass(result: string | undefined): string {
  return (result && stepResultClass[result]) || NEUTRAL
}

// Solid dot color for the step-flow timeline.
const stepResultDot: Record<string, string> = {
  executed: "bg-success",
  skipped: "bg-muted-foreground/40",
  error: "bg-destructive",
}

export function stepResultDotClass(result: string | undefined): string {
  return (result && stepResultDot[result]) || "bg-muted-foreground/40"
}

// Circuit breaker state: closed / open / half_open (also tolerates "half-open")
export const breakerStateClass: Record<string, string> = {
  closed: GOOD,
  open: BAD,
  half_open: WARN,
  "half-open": WARN,
}

export function breakerStateBadgeClass(state: string): string {
  return breakerStateClass[state] ?? WARN
}

// Connector enabled flag
export const enabledBadgeClass = GOOD
export const disabledBadgeClass = NEUTRAL

// Concrete chart colors (hex) for status segments in SVG charts (recharts), where
// CSS-variable fills don't resolve. These mirror the --chart-* / --destructive
// theme tokens, which are identical in light and dark.
const STATUS_CHART_COLORS: Record<string, string> = {
  completed: "#4CBD97",
  success: "#4CBD97",
  ok: "#4CBD97",
  complete: "#4CBD97",
  running: "#119FCD",
  pending: "#7FAFC0",
  failed: "#EF476F",
  error: "#EF476F",
}

export function statusChartColor(status: string): string {
  return STATUS_CHART_COLORS[status] ?? "#7FAFC0"
}
