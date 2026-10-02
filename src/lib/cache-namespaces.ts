import type { Channel, EntityStatus } from "@/api/types"

/**
 * Response-cache invalidation namespaces (Orion 1.10).
 *
 * A channel's `config.cache.namespaces` names 1–8 namespaces its cached
 * responses belong to; each is a version counter in the cache store, and
 * `POST admin/cache/namespaces/{ns}/invalidate` bumps it. The server has no
 * listing endpoint, so the console reads the namespaces in use off the channel
 * registry — which is also the only place that says *who shares* one.
 */

/** What the server accepts as a namespace name: 1–64 chars of `a-z0-9_-.:`. */
export const NAMESPACE_PATTERN = /^[a-z0-9_.:-]{1,64}$/
export const MAX_NAMESPACES = 8

/** Why one name is refused, or null when it is accepted. */
export function lintNamespace(name: string): string | null {
  if (name.length === 0) return "A namespace cannot be empty."
  if (name.length > 64) return `"${name}" is ${name.length} characters; the limit is 64.`
  if (!NAMESPACE_PATTERN.test(name)) {
    return `"${name}" may use only lower-case letters, digits and _ - . :`
  }
  return null
}

/** Every finding for a channel's `cache.namespaces`, in input order. Empty means valid. */
export function lintNamespaces(names: string[] | undefined): string[] {
  if (!names) return []
  const out: string[] = []
  if (names.length === 0) out.push("Declare at least one namespace, or remove the list.")
  if (names.length > MAX_NAMESPACES) {
    out.push(`${names.length} namespaces declared; a channel may declare at most ${MAX_NAMESPACES}.`)
  }
  for (const n of names) {
    const finding = lintNamespace(n)
    if (finding) out.push(finding)
  }
  return out
}

export interface NamespaceChannel {
  channel_id: string
  name: string
  status: EntityStatus
  /** Whether the channel's cache is switched on; a declared namespace on a disabled cache stores nothing. */
  cacheEnabled: boolean
  connector?: string
}

export interface CacheNamespace {
  namespace: string
  /** Channels declaring it, active first, then by name. */
  channels: NamespaceChannel[]
  /** Distinct cache connectors behind those channels (absent = the in-memory store). */
  connectors: string[]
  /** How many of `channels` are active with the cache on — the ones whose entries an invalidation reaches. */
  live: number
}

const STATUS_ORDER: Record<string, number> = { active: 0, draft: 1, archived: 2 }

/**
 * Every namespace declared across `channels`, with the channels that declare
 * it. Sorted by how many live channels share it, then by name. A channel
 * listed twice (several versions in the registry) counts once, by id.
 */
export function cacheNamespaces(
  channels: Pick<Channel, "channel_id" | "name" | "status" | "config">[]
): CacheNamespace[] {
  const byNs = new Map<string, Map<string, NamespaceChannel>>()
  for (const c of channels) {
    const cache = c.config?.cache
    const names = cache?.namespaces
    if (!names || names.length === 0) continue
    for (const ns of new Set(names)) {
      const members = byNs.get(ns) ?? new Map<string, NamespaceChannel>()
      const prev = members.get(c.channel_id)
      // Keep the most live version of a channel the registry returns twice.
      if (!prev || (STATUS_ORDER[c.status] ?? 9) < (STATUS_ORDER[prev.status] ?? 9)) {
        members.set(c.channel_id, {
          channel_id: c.channel_id,
          name: c.name,
          status: c.status,
          cacheEnabled: cache?.enabled === true,
          connector: cache?.connector || undefined,
        })
      }
      byNs.set(ns, members)
    }
  }

  const out: CacheNamespace[] = []
  for (const [namespace, members] of byNs) {
    const list = [...members.values()].sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.name.localeCompare(b.name)
    )
    const connectors = [...new Set(list.map((c) => c.connector).filter((c): c is string => !!c))].sort()
    const live = list.filter((c) => c.status === "active" && c.cacheEnabled).length
    out.push({ namespace, channels: list, connectors, live })
  }
  return out.sort((a, b) => b.live - a.live || a.namespace.localeCompare(b.namespace))
}

/**
 * Hit ratio across a set of channels from per-channel hit/miss counters, as a
 * percentage, or null when none of them has looked the cache up.
 */
export function hitRatio(
  channels: string[],
  byChannel: Map<string, { hits: number; misses: number }>
): { pct: number | null; hits: number; misses: number } {
  let hits = 0
  let misses = 0
  for (const name of channels) {
    const v = byChannel.get(name)
    if (!v) continue
    hits += v.hits
    misses += v.misses
  }
  const total = hits + misses
  return { pct: total > 0 ? (hits / total) * 100 : null, hits, misses }
}
