import { middleTruncate, shortName, type DomainIndex } from "@/lib/domains"
import { domainLoad, type DomainLoad } from "@/lib/dependency-graph"
import type { SystemNode } from "@/lib/system-graph"
import type { ChannelTraffic } from "@/hooks/use-metrics"
import {
  levelFor,
  rawSize,
  sqrtScale,
  worstLevel,
  type ColorMetric,
  type EffectiveLoad,
  type HealthLevel,
  type SizeMetric,
} from "@/lib/traffic-encoding"

/**
 * The System Map's **health grid lens**: every channel as a tile, grouped into
 * domain sections, sized by the size metric and coloured by the colour metric.
 *
 * A node-link diagram stops being legible somewhere past a hundred nodes; a
 * grid does not, which is why this is the lens for 500 channels and for a
 * wall screen. Tiles keep a fixed height and take their *width* from a
 * square-root scale — the same scale the map's dots use — so every tile can
 * carry a readable name, and a busier channel is visibly wider without one
 * hub swallowing a row.
 *
 * Order inside a section is by name, never by rate: a wall that reshuffles on
 * every ten-second poll cannot be read by position.
 */

export const TILE_H = 44
export const TILE_MIN_W = 152
export const TILE_MAX_W = 288
/** Pixels a tile spends on its padding and health dot before the label. */
const TILE_CHROME = 40
/** Average advance of the 12px label font, generous so a label never overflows. */
const CHAR_PX = 6.6

export interface GridTile {
  /** Channel name. */
  id: string
  /** The name inside its domain, cut in the middle to fit the tile. */
  label: string
  width: number
  level: HealthLevel
  /** What the size metric read, for the hover. */
  value: number
}

export interface GridSection {
  domain: string
  tiles: GridTile[]
  load: DomainLoad
  /** The loudest member — one failing channel among sixty must not average away. */
  level: HealthLevel
}

export interface HealthGridInput {
  nodes: SystemNode[]
  domains: Pick<DomainIndex, "prefix" | "domainOf" | "members">
  byChannel: ReadonlyMap<string, ChannelTraffic>
  load?: ReadonlyMap<string, EffectiveLoad>
  colorMetric: ColorMetric
  sizeMetric: SizeMetric
}

/** Characters of label a tile of this width holds. */
export function tileChars(width: number): number {
  return Math.max(6, Math.floor((width - TILE_CHROME) / CHAR_PX))
}

export function buildHealthGrid({
  nodes,
  domains,
  byChannel,
  load,
  colorMetric,
  sizeMetric,
}: HealthGridInput): GridSection[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let max = 0
  const values = new Map<string, number>()
  for (const n of nodes) {
    const v = rawSize(sizeMetric, n, byChannel.get(n.id), load?.get(n.id))
    values.set(n.id, v)
    max = Math.max(max, v)
  }

  const sections: GridSection[] = []
  for (const [domain, members] of domains.members) {
    const present = members.filter((m) => byId.has(m))
    if (present.length === 0) continue
    const tiles = present
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((id) => {
        const node = byId.get(id)!
        const value = values.get(id) ?? 0
        const width = sqrtScale(value, max, TILE_MIN_W, TILE_MAX_W)
        return {
          id,
          label: middleTruncate(shortName(id, domains), tileChars(width)),
          width,
          level: levelFor(colorMetric, node, byChannel.get(id)),
          value,
        }
      })
    sections.push({
      domain,
      tiles,
      load: domainLoad(present, byChannel),
      level: worstLevel(tiles.map((t) => t.level)),
    })
  }
  return sections
}
