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

// Cron occurrence status (1.6). A skip is the scheduler doing what the
// channel's policy told it to — visible, not a failure — so it reads as a
// warning rather than red. The wire value is open: an unknown one is neutral.
export const occurrenceStatusClass: Record<string, string> = {
  pending: NEUTRAL,
  claimed: INFO,
  running: INFO,
  completed: GOOD,
  failed: BAD,
  skipped_misfire: WARN,
  skipped_singleton: WARN,
}

export function occurrenceStatusBadgeClass(status: string | null | undefined): string {
  return (status && occurrenceStatusClass[status]) || NEUTRAL
}

// A plugin version's load state on the answering node (1.6): loaded / failed /
// disabled (the sandbox is off here) / inactive (not this generation's version).
export const pluginHealthClass: Record<string, string> = {
  loaded: GOOD,
  failed: BAD,
  disabled: NEUTRAL,
  inactive: NEUTRAL,
}

export function pluginHealthBadgeClass(state: string | null | undefined): string {
  return (state && pluginHealthClass[state]) || NEUTRAL
}

// A `/health` component state. `disabled` is a state, not a fault — a node
// without the plugin sandbox serves everything else — so it is neutral.
export const componentStateClass: Record<string, string> = {
  ok: GOOD,
  degraded: WARN,
  error: BAD,
  disabled: NEUTRAL,
}

export function componentStateBadgeClass(state: string | null | undefined): string {
  return (state && componentStateClass[state]) || WARN
}

/** Whether a component state is something a person should act on. */
export function isComponentFault(state: string | null | undefined): boolean {
  return state !== undefined && state !== null && state !== "ok" && state !== "disabled"
}

// Concrete chart colors (hex) for status segments in SVG charts (recharts), where
// CSS-variable fills don't resolve. These mirror the --chart-* / --destructive
// theme tokens, which are identical in light and dark.
const STATUS_CHART_COLORS: Record<string, string> = {
  completed: "#4CBD97",
  success: "#4CBD97",
  ok: "#4CBD97",
  complete: "#4CBD97",
  running: "#119FCD",
  claimed: "#119FCD",
  pending: "#7FAFC0",
  failed: "#EF476F",
  error: "#EF476F",
  skipped_misfire: "#FFD167",
  skipped_singleton: "#FFD167",
  // `orion_messages_total{status}` beyond ok/error: a timeout is the engine
  // giving up (amber), `unauthorized` was refused at the edge and never ran
  // (info blue, the colour the map paints it), a duplicate was suppressed by
  // the dedup guard (muted). Without these all three fell to the same grey as
  // `pending`, so a timeout read as a suppressed duplicate.
  timeout: "#FFD167",
  unauthorized: "#119FCD",
  duplicate: "#7FAFC0",
}

export function statusChartColor(status: string): string {
  return STATUS_CHART_COLORS[status] ?? "#7FAFC0"
}
