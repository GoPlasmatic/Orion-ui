import type { TopoModel, TopoNode } from "@/lib/topology"

// Hand-rolled layered layout for a bounded, rooted, DAG-shaped graph. Columns by
// BFS depth, rows by index within the layer (vertically centered). No dependency.

const COL_GAP = 280
const ROW_GAP = 96

export interface PositionedNode extends TopoNode {
  x: number
  y: number
}

export function layoutTopology(model: TopoModel): { nodes: PositionedNode[]; height: number } {
  const layers = new Map<number, TopoNode[]>()
  for (const node of model.nodes) {
    const layer = layers.get(node.depth) ?? []
    layer.push(node)
    layers.set(node.depth, layer)
  }

  let maxRows = 0
  for (const nodes of layers.values()) {
    nodes.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind.localeCompare(b.kind)))
    maxRows = Math.max(maxRows, nodes.length)
  }

  const positioned: PositionedNode[] = []
  for (const [depth, nodes] of layers) {
    const offset = ((maxRows - nodes.length) * ROW_GAP) / 2
    nodes.forEach((node, i) => {
      positioned.push({ ...node, x: depth * COL_GAP, y: offset + i * ROW_GAP })
    })
  }

  return { nodes: positioned, height: Math.max(ROW_GAP, maxRows * ROW_GAP) }
}
