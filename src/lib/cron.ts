import type { Channel, ChannelConfig, CronTransportConfig } from "@/api/types"

/**
 * Reading a cron channel (Orion 1.6).
 *
 * A `protocol: "cron"` channel keeps its schedule in `transport_config`, the
 * same untyped bag a Kafka channel keeps its brokers in. These helpers are the
 * one place that bag is read as a schedule, so the form, the detail page, the
 * list and the map agree on what a cron channel is.
 */

export const isCronChannel = (c: Pick<Channel, "protocol"> | undefined): boolean =>
  c?.protocol === "cron"

/** The schedule a cron channel declares, or null when the bag is not one. */
export function cronTransport(
  channel: Pick<Channel, "protocol" | "transport_config"> | undefined,
): CronTransportConfig | null {
  if (!channel || channel.protocol !== "cron") return null
  const tc = channel.transport_config
  if (!tc || typeof tc !== "object" || typeof tc.schedule !== "string") return null
  return tc as unknown as CronTransportConfig
}

/**
 * The `config` keys a cron channel is refused at create, update and import —
 * everything about a caller, because there is not one. Refused rather than
 * ignored, so a stale key is a 400 rather than a guard that silently does
 * nothing. What still applies: `timeout_ms`, `validation_logic`,
 * `backpressure` and `tracing`.
 */
export const CRON_REFUSED_CONFIG_KEYS = [
  "auth",
  "origin_allow_list",
  "rate_limit",
  "deduplication",
  "cache",
  "request",
  "response",
  "oauth2_login",
] as const satisfies readonly (keyof ChannelConfig)[]

/** Drop the keys a cron channel may not carry, so a protocol switch saves. */
export function stripCronRefusedConfig(config: ChannelConfig): ChannelConfig {
  const next: ChannelConfig = { ...config }
  for (const key of CRON_REFUSED_CONFIG_KEYS) delete next[key]
  return next
}

export const MISFIRE_POLICIES = [
  {
    value: "latest",
    label: "Latest (default)",
    hint: "Run the newest missed occurrence — one run brings the world up to date.",
  },
  {
    value: "skip",
    label: "Skip",
    hint: "Run nothing; the misses are recorded as one skipped_misfire row.",
  },
  {
    value: "catch_up",
    label: "Catch up",
    hint: "Replay the missed occurrences oldest-first, bounded by max_catch_up.",
  },
] as const

export const CONCURRENCY_POLICIES = [
  { value: "allow", label: "Allow (default)", hint: "Occurrences may overlap; no lock is taken." },
  {
    value: "forbid",
    label: "Forbid",
    hint: "At most one occurrence per key at a time, cluster-wide; a contender is recorded skipped_singleton.",
  },
] as const

/** The six-field schedule and its zone, the way the status endpoint echoes it. */
export function describeSchedule(tc: Pick<CronTransportConfig, "schedule" | "timezone">): string {
  return `${tc.schedule} · ${tc.timezone ?? "UTC"}`
}

/**
 * Client-side shape check for a cron expression: **six** whitespace-separated
 * fields (second, minute, hour, day-of-month, month, day-of-week). The server
 * refuses five- and seven-field forms rather than guessing — the same text
 * read as five fields means something else entirely — and also refuses an
 * expression with no occurrence in the next five years, which only it can
 * tell. This catches the field count while typing; Validate is the authority.
 */
export function lintCronExpression(expr: string): string | null {
  const fields = expr.trim().split(/\s+/).filter(Boolean)
  if (fields.length === 0) return "A schedule is required"
  if (fields.length === 5) {
    return "Five fields — Orion reads six (a leading seconds field). Prefix a 0."
  }
  if (fields.length === 7) return "Seven fields — a trailing year field is refused"
  if (fields.length !== 6) return `${fields.length} fields — a schedule has exactly six`
  return null
}

/** Statuses `POST admin/cron/occurrences/{id}/retry` accepts; anything else is a 409. */
export const RETRYABLE_STATUSES: ReadonlySet<string> = new Set([
  "failed",
  "skipped_misfire",
  "skipped_singleton",
])

export function isRetryable(status: string | null | undefined): boolean {
  return !!status && RETRYABLE_STATUSES.has(status)
}

/** Human labels for the occurrence statuses, for filters and legends. */
export const OCCURRENCE_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  claimed: "Claimed",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  skipped_misfire: "Skipped (misfire)",
  skipped_singleton: "Skipped (singleton held)",
}

export function occurrenceStatusLabel(status: string | null | undefined): string {
  if (!status) return "—"
  return OCCURRENCE_STATUS_LABELS[status] ?? status
}
