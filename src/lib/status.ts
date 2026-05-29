import type { EntityStatus } from "@/api/types"

// Single source of truth for status → color across the app. Colors are built from
// theme chart tokens (identical in light/dark) and semantic tokens so badges read
// correctly in both themes. Standardised on the outline Badge variant + a tinted
// className, avoiding the filled-variant look for a calmer, on-brand palette.

const NEUTRAL = "border-border text-muted-foreground"
const GOOD = "border-chart-2/40 text-chart-2 bg-chart-2/10" // green  (#4CBD97)
const INFO = "border-chart-1/40 text-chart-1 bg-chart-1/10" // cyan   (#119FCD)
const WARN = "border-chart-3/40 text-chart-3 bg-chart-3/10" // amber  (#FFD167)
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
  executed: "bg-chart-2",
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
