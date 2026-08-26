import type { ELK, ElkNode } from "elkjs/lib/elk-api"

/**
 * Layout for the System Map canvas.
 *
 * Two layouts, on purpose:
 *
 * - Channels that call or are called by another go through ELK's `layered`
 *   algorithm, left to right. Tier falls out of the call graph, so entry
 *   channels line up on the left and hubs sit downstream of everything that
 *   reaches them — which is the shape the map exists to show.
 * - Channels with no calls in either direction are packed into a grid instead.
 *   Handing them to a layered algorithm puts every one of them in the first
 *   layer, producing a single column dozens of rows tall whose height carries no
 *   meaning at all. A channel with no edges has no topology to draw; a tidy grid
 *   says that, and a 40-row column says something false.
 *
 * ELK is loaded on first use with a dynamic import so it stays out of the
 * initial bundle — the map is one route, and ~500KB of layout engine should not
 * be on the critical path of every other page.
 */

let elkPromise: Promise<ELK> | null = null

async function getElk(): Promise<ELK> {
  if (!elkPromise) {
    elkPromise = import("elkjs/lib/elk.bundled.js").then((mod) => new mod.default())
  }
  return elkPromise
}

export interface LayoutInput {
  id: string
  width: number
  height: number
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

export interface LayoutResult {
  positions: Map<string, Placement>
  /** Y coordinate where the packed grid of isolated channels begins. */
  detachedBandY: number | null
  detachedCount: number
  width: number
  height: number
}

const GRID_GAP_X = 16
const GRID_GAP_Y = 14
/** Gap between the call graph and the band of detached channels below it. */
const BAND_GAP = 96

const LAYERED_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  // Brandes-Köpf keeps long call chains straight rather than stair-stepping
  // them, which matters when one hub is fed by two dozen callers.
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  // Respect the order nodes are handed over (alphabetical), so the same graph
  // lays out the same way on every render instead of shuffling under the user.
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.spacing.nodeNode": "20",
  "elk.layered.spacing.nodeNodeBetweenLayers": "120",
  "elk.spacing.edgeNode": "24",
  "elk.spacing.edgeEdge": "12",
  "elk.separateConnectedComponents": "true",
  "elk.spacing.componentComponent": "48",
  "elk.padding": "[top=24,left=24,bottom=24,right=24]",
}

/**
 * Pack detached channels into a grid as wide as the call graph, so the two
 * halves of the canvas read as one composition rather than a graph with a tail.
 */
function packGrid(
  nodes: LayoutInput[],
  targetWidth: number,
  originY: number,
): { positions: Map<string, Placement>; width: number; height: number } {
  const positions = new Map<string, Placement>()
  if (nodes.length === 0) return { positions, width: 0, height: 0 }

  const cellW = Math.max(...nodes.map((n) => n.width))
  const cellH = Math.max(...nodes.map((n) => n.height))
  const perRow = Math.max(1, Math.floor((targetWidth + GRID_GAP_X) / (cellW + GRID_GAP_X)))

  nodes.forEach((node, i) => {
    const row = Math.floor(i / perRow)
    const col = i % perRow
    positions.set(node.id, {
      x: col * (cellW + GRID_GAP_X),
      y: originY + row * (cellH + GRID_GAP_Y),
    })
  })

  const rows = Math.ceil(nodes.length / perRow)
  return {
    positions,
    width: Math.min(nodes.length, perRow) * (cellW + GRID_GAP_X) - GRID_GAP_X,
    height: rows * (cellH + GRID_GAP_Y) - GRID_GAP_Y,
  }
}

export async function layoutSystemGraph(
  nodes: LayoutInput[],
  edges: LayoutEdge[],
): Promise<LayoutResult> {
  const connected = new Set<string>()
  for (const e of edges) {
    connected.add(e.source)
    connected.add(e.target)
  }

  const linked = nodes.filter((n) => connected.has(n.id))
  const detached = nodes.filter((n) => !connected.has(n.id))

  const positions = new Map<string, Placement>()
  let graphWidth = 0
  let graphHeight = 0

  if (linked.length > 0) {
    const elk = await getElk()
    // Typed as ElkNode rather than inferred: elk.layout() derives its result
    // type from the argument, so an object literal makes the root's computed
    // width/height invisible to the compiler.
    const request: ElkNode = {
      id: "root",
      layoutOptions: LAYERED_OPTIONS,
      children: linked.map((n) => ({ id: n.id, width: n.width, height: n.height })),
      // ELK rejects an edge naming a node it was not given.
      edges: edges
        .filter((e) => connected.has(e.source) && connected.has(e.target))
        .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    }
    const laid = await elk.layout(request)

    for (const child of laid.children ?? []) {
      positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 })
    }
    graphWidth = laid.width ?? 0
    graphHeight = laid.height ?? 0
  }

  let detachedBandY: number | null = null
  if (detached.length > 0) {
    detachedBandY = linked.length > 0 ? graphHeight + BAND_GAP : 0
    const grid = packGrid(detached, Math.max(graphWidth, 900), detachedBandY)
    for (const [id, pos] of grid.positions) positions.set(id, pos)
    graphWidth = Math.max(graphWidth, grid.width)
    graphHeight = detachedBandY + grid.height
  }

  return {
    positions,
    detachedBandY,
    detachedCount: detached.length,
    width: graphWidth,
    height: graphHeight,
  }
}
