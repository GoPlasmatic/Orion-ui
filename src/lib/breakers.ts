import type { CircuitBreakerStatus } from "@/api/types"

/** One breaker: the `channel:connector` key the server uses, split. */
export interface BreakerRow {
  key: string
  channel: string
  connector: string
  state: string
}

/**
 * A breaker key is `channel:connector`. A key without the colon names the
 * connector alone — nothing on the map or the channel list matches it, and the
 * breakers page shows it under no channel.
 */
export function parseBreakerKey(key: string): { channel: string; connector: string } {
  const sep = key.indexOf(":")
  return sep === -1
    ? { channel: "", connector: key }
    : { channel: key.slice(0, sep), connector: key.slice(sep + 1) }
}

/** A breaker that is not closed is one an operator may want to reset. */
export const isBreakerOpen = (state: string): boolean => state !== "closed"

/** Every breaker this node reports, keyed and sorted; none when breakers are disabled. */
export function breakerRows(status: CircuitBreakerStatus | undefined): BreakerRow[] {
  if (!status?.enabled) return []
  return Object.entries(status.breakers ?? {})
    .map(([key, state]) => ({ key, state, ...parseBreakerKey(key) }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/** The breakers that are open or half-open on this node. */
export function openBreakers(status: CircuitBreakerStatus | undefined): BreakerRow[] {
  return breakerRows(status).filter((row) => isBreakerOpen(row.state))
}
