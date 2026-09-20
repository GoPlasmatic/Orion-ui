import type { Channel, ChannelConfig, CronScheduleStatus, CronTransportConfig } from "@/api/types"
import { CRON_SLOTS_MAX, CRON_SLOTS_MIN } from "@/api/types"

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
  // Not on the server's own refusal list, because it is refused transitively:
  // `principal_rate_limit` requires `auth.mode = "jwt"`, and a cron channel is
  // refused `auth` outright. Stripping it here keeps a protocol switch saveable
  // — leaving it behind drops `auth` and then fails the save on a block that
  // can never be valid without it.
  "principal_rate_limit",
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
    hint: "At most `slots` occurrences per key at a time (one by default); a contender is recorded skipped_singleton.",
  },
] as const

/**
 * How many runs of the key this schedule admits at once (Orion 1.9).
 *
 * `slots` is `forbid`-only and defaults to 1, so a `forbid` channel that never
 * set it reads as one — which is exactly what it meant before 1.9.
 */
export function concurrencySlots(
  tc: Pick<CronTransportConfig, "concurrency"> | null | undefined,
): number | null {
  if (tc?.concurrency?.policy !== "forbid") return null
  return tc.concurrency.slots ?? 1
}

/**
 * Client-side bounds check for `concurrency.slots`, while typing. The server
 * refuses it outright with `policy: "allow"` rather than ignoring it, so the
 * editor only offers it under `forbid` and this covers the range.
 */
export function lintSlots(slots: number | undefined): string | null {
  if (slots == null) return null
  if (!Number.isInteger(slots)) return "Slots is a whole number"
  if (slots < CRON_SLOTS_MIN || slots > CRON_SLOTS_MAX) {
    return `Slots is ${CRON_SLOTS_MIN}–${CRON_SLOTS_MAX}`
  }
  return null
}

/**
 * A status row's lock as "held/slots", or null when the channel takes none.
 *
 * `slots_held` counts live leases across *every* channel sharing the key, so
 * it can legitimately exceed this channel's own `slots` — when a peer channel
 * declares more, or just after `slots` was lowered and a run still holds a
 * higher one. `over` is what says the reading is that case rather than a fault.
 */
export function slotUsage(
  row: Pick<CronScheduleStatus, "concurrency_policy" | "slots" | "slots_held">,
): { held: number; slots: number; over: boolean } | null {
  if (row.concurrency_policy !== "forbid") return null
  const slots = row.slots ?? 1
  const held = row.slots_held ?? 0
  return { held, slots, over: held > slots }
}

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
  skipped_singleton: "Skipped (every slot held)",
}

export function occurrenceStatusLabel(status: string | null | undefined): string {
  if (!status) return "—"
  return OCCURRENCE_STATUS_LABELS[status] ?? status
}
