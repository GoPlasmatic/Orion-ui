/**
 * Grouping channels into **domains** — the unit a 150-channel system is read
 * in. QA names every channel `soma-<domain>-<thing>` (`soma-admin-check`,
 * `soma-clock-pair`): one shared product prefix, then the domain. A list or
 * map of 148 such names is unreadable until it is grouped by that second
 * segment and the shared prefix is dropped from every label.
 *
 * Two ways to group:
 * - `prefix` (default): strip the prefix every channel shares, whole
 *   hyphen-separated segments only, and take the next segment as the domain.
 *   A system with no shared prefix groups on the first segment.
 * - `tag`: a channel's domain is the first of its tags found in `tags`, the
 *   tags the operator picked as domain names. Untagged channels land in
 *   `OTHER_DOMAIN`.
 *
 * Pure and synchronous; the map, the dashboard and the channel list share it
 * so a domain means the same thing on all three.
 */

export const OTHER_DOMAIN = "other"

export type DomainMode = { by: "prefix" } | { by: "tag"; tags: string[] }

export interface DomainIndex {
  /** The shared prefix stripped from labels, with its trailing hyphen ("soma-"), or "". */
  prefix: string
  /** channel name → domain */
  domainOf: Map<string, string>
  /** domain → channel names, domains busiest-first then by name. */
  members: Map<string, string[]>
}

interface Named {
  name: string
  tags?: string[] | null
}

/** The longest run of leading hyphen-separated segments every name shares. */
export function sharedPrefix(names: string[]): string {
  if (names.length < 2) return ""
  const split = names.map((n) => n.split("-"))
  const out: string[] = []
  for (let i = 0; ; i++) {
    const seg = split[0][i]
    // Leave at least one segment after the prefix on every name, plus the
    // segment the domain is read from, or "prefix" would eat a whole name.
    if (seg === undefined || split.some((s) => s.length < i + 3 || s[i] !== seg)) break
    out.push(seg)
  }
  return out.length ? `${out.join("-")}-` : ""
}

export function buildDomains(channels: Named[], mode: DomainMode = { by: "prefix" }): DomainIndex {
  const prefix = mode.by === "prefix" ? sharedPrefix(channels.map((c) => c.name)) : ""
  const domainOf = new Map<string, string>()
  const members = new Map<string, string[]>()
  for (const c of channels) {
    let domain: string
    if (mode.by === "tag") {
      domain = (c.tags ?? []).find((t) => mode.tags.includes(t)) ?? OTHER_DOMAIN
    } else {
      const rest = c.name.startsWith(prefix) ? c.name.slice(prefix.length) : c.name
      const seg = rest.split("-")[0]
      // A name that is all prefix-and-domain ("soma-admin") still belongs to it.
      domain = seg || OTHER_DOMAIN
    }
    domainOf.set(c.name, domain)
    const list = members.get(domain) ?? []
    list.push(c.name)
    members.set(domain, list)
  }
  const sorted = new Map(
    [...members.entries()]
      .map(([d, list]) => [d, list.sort()] as [string, string[]])
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])),
  )
  return { prefix, domainOf, members: sorted }
}

/**
 * A channel's label inside its domain: the shared prefix and the domain
 * segment dropped (`soma-admin-runner-keys-list` in `admin` → `runner-keys-list`).
 * Falls back to the name without the prefix, then the name itself.
 */
export function shortName(name: string, index: Pick<DomainIndex, "prefix" | "domainOf">): string {
  const rest = index.prefix && name.startsWith(index.prefix) ? name.slice(index.prefix.length) : name
  const domain = index.domainOf.get(name)
  if (domain && rest.startsWith(`${domain}-`) && rest.length > domain.length + 1) {
    return rest.slice(domain.length + 1)
  }
  return rest || name
}

/**
 * Cut a label in the middle, keeping both ends: `…runner-keys-list` loses the
 * part that distinguishes it, `soma-adm…keys-list` keeps it. `max` counts the
 * ellipsis.
 */
export function middleTruncate(text: string, max: number): string {
  if (text.length <= max || max < 5) return text
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}
