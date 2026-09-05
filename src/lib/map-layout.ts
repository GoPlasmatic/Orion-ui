/**
 * Layout for the System Map canvas: every channel, in lanes, by role.
 *
 * The previous layout split the channels by the wrong criterion. Channels with
 * a `channel_call` edge went through ELK's layered algorithm; everything else
 * was packed into a grid underneath labelled "not reached by any call". But a
 * public entry channel — `achievers-list`, `version-get`, a webhook receiver —
 * is *supposed* to be reached by nothing: it is reached over its route. Those
 * are entry points exactly like `auth-login`, and demoting them to a leftover
 * band under the graph said they were orphans. Worse, when the only channels
 * carrying traffic happened to be ones that make no calls, the whole map
 * collapsed into that band.
 *
 * So there is one layout, and its columns mean something:
 *
 * - **Entry lane** — every channel nothing calls. Reached over its route.
 *   Entries that share the same set of callees are drawn as one **cluster**
 *   with a single edge per callee: eighteen routes that each call
 *   `internal-session-check` and nothing else are one fact, not eighteen
 *   parallel lines, and the lane stays short enough to read. Entries that
 *   call nothing are a cluster like any other — "no calls out" — not a band.
 *   A dependency set shared by only one or two channels is not worth a box, so
 *   those stay bare nodes with their own edges.
 * - **Called lanes** — one per tier, tier being the longest call path from an
 *   entry. A hub sits downstream of everything that reaches it.
 *
 * Ordering inside a column is by barycenter — a few sweeps of "sort by the mean
 * position of your neighbours" — so the callers of one hub end up beside it
 * and the hub sits vertically among them. It is the same heuristic every
 * layered layout uses; the graph here is a few dozen nodes, so a dependency
 * was never warranted for it.
 *
 * Pure and synchronous, so it is unit-testable and can run in a `useMemo`.
 */

export interface LayoutInput {
  id: string
  width: number
  height: number
  /** Longest call path from an entry channel. 0 = nothing calls it. */
  tier: number
}

export interface LayoutEdge {
  id: string
  source: string
  target: string
}

export interface Placement {
  x: number
  y: number
}

export interface Lane {
  tier: number
  x: number
  y: number
  width: number
  height: number
  count: number
}

/** Entry channels that share one dependency set, drawn as a box with one edge per callee. */
export interface Cluster {
  id: string
  members: string[]
  callees: string[]
  x: number
  y: number
  width: number
  height: number
  /** Drawn as one summary node; its members are not laid out. */
  collapsed: boolean
}

export interface LayoutOptions {
  /**
   * Whether a cluster is drawn collapsed — one summary box the size of a node
   * instead of a grid of its members. Decided per cluster because the caller
   * knows things the layout does not: how big the map is, what is selected.
   */
  isCollapsed?: (clusterId: string, members: string[]) => boolean
  /** Footprint of a collapsed cluster; defaults to a full node. */
  collapsedWidth?: number
  collapsedHeight?: number
}

export interface LayoutResult {
  positions: Map<string, Placement>
  lanes: Lane[]
  clusters: Cluster[]
  width: number
  height: number
}

/** Vertical gap between items in a column. */
const ROW_GAP = 10
/** Gap between lanes: room for edges to bend. */
const LANE_GAP = 150
/** Padding inside a lane around its column. */
const LANE_PAD = 16
const BARYCENTER_SWEEPS = 4

/** Fewer members than this and a dependency set is not worth a box. */
const CLUSTER_MIN = 3
/** Rows a cluster grid fills before it grows another column. */
const CLUSTER_ROWS = 6
const CLUSTER_MAX_COLS = 4
const CLUSTER_PAD = 12
const CLUSTER_GAP_X = 12
const CLUSTER_GAP_Y = 8
/** Height of a cluster's caption, above its grid. */
export const CLUSTER_HEADER = 26

/** What the columns are sorted and placed as: a node, or a cluster of them. */
interface Item {
  id: string
  width: number
  height: number
  y: number
  cluster?: {
    members: LayoutInput[]
    callees: string[]
    cols: number
    rowHeights: number[]
    collapsed: boolean
  }
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function centre(item: Item): number {
  return item.y + item.height / 2
}

/** Lay a column out top-down from 0, in the order given. */
function stack(items: Item[]): Item[] {
  let y = 0
  return items.map((item) => {
    const placed = { ...item, y }
    y += item.height + ROW_GAP
    return placed
  })
}

function nodeItem(n: LayoutInput): Item {
  return { id: n.id, width: n.width, height: n.height, y: 0 }
}

function clusterItem(
  id: string,
  members: LayoutInput[],
  callees: string[],
  collapsed: boolean,
  collapsedSize: { width: number; height: number },
): Item {
  if (collapsed) {
    return {
      id,
      width: collapsedSize.width,
      height: collapsedSize.height,
      y: 0,
      cluster: { members, callees, cols: 1, rowHeights: [], collapsed: true },
    }
  }
  const cols = Math.min(CLUSTER_MAX_COLS, Math.ceil(members.length / CLUSTER_ROWS))
  const rows = Math.ceil(members.length / cols)
  const cellW = Math.max(...members.map((m) => m.width))
  const rowHeights = Array.from({ length: rows }, (_, r) =>
    Math.max(...members.slice(r * cols, (r + 1) * cols).map((m) => m.height)),
  )
  return {
    id,
    width: cols * cellW + (cols - 1) * CLUSTER_GAP_X + CLUSTER_PAD * 2,
    height:
      CLUSTER_HEADER +
      rowHeights.reduce((a, b) => a + b, 0) +
      (rows - 1) * CLUSTER_GAP_Y +
      CLUSTER_PAD * 2,
    y: 0,
    cluster: { members, callees, cols, rowHeights, collapsed: false },
  }
}

/**
 * Sort a column by the mean centre of each item's neighbours, keeping the
 * current position for anything with no placed neighbour so a sweep never
 * shuffles an item it has no opinion about.
 */
function sortByBarycenter(
  column: Item[],
  neighbours: Map<string, string[]>,
  centres: Map<string, number>,
): Item[] {
  const keyed = column.map((item, index) => {
    const ys = (neighbours.get(item.id) ?? [])
      .map((id) => centres.get(id))
      .filter((y): y is number => y != null)
    return { item, index, key: mean(ys) ?? centre(item) }
  })
  keyed.sort((a, b) => a.key - b.key || a.index - b.index)
  return stack(keyed.map((k) => k.item))
}

export function layoutSystemGraph(
  nodes: LayoutInput[],
  edges: LayoutEdge[],
  options: LayoutOptions = {},
): LayoutResult {
  const positions = new Map<string, Placement>()
  if (nodes.length === 0) return { positions, lanes: [], clusters: [], width: 0, height: 0 }
  const collapsedSize = {
    width: options.collapsedWidth ?? 260,
    height: options.collapsedHeight ?? 76,
  }

  const present = new Set(nodes.map((n) => n.id))
  const calleesOf = new Map<string, string[]>()
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key) ?? []
    if (!list.includes(value)) list.push(value)
    map.set(key, list)
  }
  const liveEdges = edges.filter(
    (e) => present.has(e.source) && present.has(e.target) && e.source !== e.target,
  )
  for (const e of liveEdges) push(calleesOf, e.source, e.target)

  // One column per tier actually present. A filter that hides a whole tier
  // should not leave an empty lane behind.
  const tiers = [...new Set(nodes.map((n) => n.tier))].sort((a, b) => a - b)

  // Which item a node is drawn as: itself, or the cluster it belongs to.
  const itemOf = new Map<string, string>()
  const columns: Item[][] = tiers.map((tier) => {
    const members = nodes.filter((n) => n.tier === tier)
    if (tier !== 0) {
      for (const n of members) itemOf.set(n.id, n.id)
      return stack(members.map(nodeItem))
    }

    // Entry lane: group by dependency set. The call-less group sorts last so
    // it sits at the bottom of the lane rather than in the middle of the
    // callers, where nothing it does relates to its neighbours.
    const groups = new Map<string, LayoutInput[]>()
    for (const n of members) {
      const key = [...(calleesOf.get(n.id) ?? [])].sort().join(" ")
      groups.set(key, [...(groups.get(key) ?? []), n])
    }
    const items: Item[] = []
    const keys = [...groups.keys()].sort((a, b) =>
      a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
    )
    for (const key of keys) {
      const group = groups.get(key)!
      const callees = key === "" ? [] : key.split(" ")
      if (group.length >= CLUSTER_MIN) {
        const id = `cluster:${callees.join("+") || "none"}`
        for (const n of group) itemOf.set(n.id, id)
        const collapsed = options.isCollapsed?.(id, group.map((n) => n.id)) ?? false
        items.push(clusterItem(id, group, callees, collapsed, collapsedSize))
      } else {
        for (const n of group) {
          itemOf.set(n.id, n.id)
          items.push(nodeItem(n))
        }
      }
    }
    return stack(items)
  })

  // Adjacency at item level, so a cluster's edges pull it toward its callees.
  const callers = new Map<string, string[]>()
  const neighbours = new Map<string, string[]>()
  for (const e of liveEdges) {
    const source = itemOf.get(e.source)!
    const target = itemOf.get(e.target)!
    if (source === target) continue
    push(callers, target, source)
    push(neighbours, source, target)
    push(neighbours, target, source)
  }

  // Barycenter sweeps: left to right, then right to left, a few times. Each
  // column re-sorts by where its neighbours currently are.
  const centres = new Map<string, number>()
  const refresh = (column: Item[]) => {
    for (const item of column) centres.set(item.id, centre(item))
  }
  for (const column of columns) refresh(column)
  for (let sweep = 0; sweep < BARYCENTER_SWEEPS; sweep++) {
    for (let i = 1; i < columns.length; i++) {
      columns[i] = sortByBarycenter(columns[i], neighbours, centres)
      refresh(columns[i])
    }
    for (let i = columns.length - 2; i >= 0; i--) {
      columns[i] = sortByBarycenter(columns[i], neighbours, centres)
      refresh(columns[i])
    }
  }

  // Placement. The first column is a plain stack; every later column puts each
  // item at the mean of its callers and pushes down only as far as needed to
  // clear the item above. That is what lets a hub sit among the channels that
  // reach it rather than at the top of its lane.
  refresh(columns[0])
  for (let i = 1; i < columns.length; i++) {
    let bottom = -Infinity
    columns[i] = columns[i].map((item) => {
      const ys = (callers.get(item.id) ?? [])
        .map((id) => centres.get(id))
        .filter((y): y is number => y != null)
      const wanted = (mean(ys) ?? centre(item)) - item.height / 2
      const y = Math.max(wanted, bottom + ROW_GAP)
      bottom = y + item.height
      return { ...item, y }
    })
    refresh(columns[i])
  }

  // X positions: one column per lane, and expand clusters into their grids.
  // The entry column is right-aligned — a cluster is much wider than a bare
  // node, and a bare node parked at the lane's left edge sends its edge across
  // every box below it. Every later column is left-aligned so arrows land at
  // the lane boundary.
  const lanes: Lane[] = []
  const clusters: Cluster[] = []
  let x = 0
  columns.forEach((column, i) => {
    const columnWidth = Math.max(0, ...column.map((item) => item.width))
    const columnX = x + LANE_PAD
    const alignX = (item: Item) => (i === 0 ? columnX + columnWidth - item.width : columnX)
    let count = 0
    for (const item of column) {
      const itemX = alignX(item)
      if (!item.cluster) {
        positions.set(item.id, { x: itemX, y: item.y })
        count += 1
        continue
      }
      const { members, callees, cols, rowHeights, collapsed } = item.cluster
      if (collapsed) {
        // Members sit under the summary box; the canvas does not draw them,
        // but a position keeps every id resolvable (a reveal, an edge end).
        for (const m of members) positions.set(m.id, { x: itemX, y: item.y })
      } else {
        const cellW = Math.max(...members.map((m) => m.width))
        let rowY = item.y + CLUSTER_HEADER + CLUSTER_PAD
        members.forEach((m, index) => {
          const row = Math.floor(index / cols)
          const col = index % cols
          if (index > 0 && col === 0) rowY += rowHeights[row - 1] + CLUSTER_GAP_Y
          positions.set(m.id, { x: itemX + CLUSTER_PAD + col * (cellW + CLUSTER_GAP_X), y: rowY })
        })
      }
      clusters.push({
        id: item.id,
        members: members.map((m) => m.id),
        callees,
        x: itemX,
        y: item.y,
        width: item.width,
        height: item.height,
        collapsed,
      })
      count += members.length
    }
    const width = columnWidth + LANE_PAD * 2
    lanes.push({ tier: tiers[i], x, y: 0, width, height: 0, count })
    x += width + LANE_GAP
  })

  // Normalise so the topmost item sits at LANE_PAD and give every lane the
  // full height, so the lanes read as one band of columns.
  let minY = Infinity
  let maxY = -Infinity
  for (const column of columns) {
    for (const item of column) {
      minY = Math.min(minY, item.y)
      maxY = Math.max(maxY, item.y + item.height)
    }
  }
  const shift = LANE_PAD - minY
  for (const [id, p] of positions) positions.set(id, { x: p.x, y: p.y + shift })
  for (const c of clusters) c.y += shift
  const height = maxY - minY + LANE_PAD * 2
  for (const lane of lanes) lane.height = height

  const width = lanes.length ? lanes[lanes.length - 1].x + lanes[lanes.length - 1].width : 0
  return { positions, lanes, clusters, width, height }
}
