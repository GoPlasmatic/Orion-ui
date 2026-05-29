import { useMemo } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
  type Node,
  type Edge,
} from "@xyflow/react"
import { layoutTopology } from "@/lib/topology-layout"
import type { TopoModel, TopoNode } from "@/lib/topology"
import { ChannelNode, WorkflowNode, ConnectorNode, type FlowNodeData } from "@/components/graph/nodes"

const nodeTypes = {
  channel: ChannelNode,
  workflow: WorkflowNode,
  connector: ConnectorNode,
}

export function TopologyGraph({
  model,
  height = 400,
  fill = false,
  interactive = true,
  onNodeClick,
}: {
  model: TopoModel
  height?: number
  fill?: boolean
  interactive?: boolean
  onNodeClick?: (node: TopoNode) => void
}) {
  const { nodes, edges } = useMemo(() => {
    const laid = layoutTopology(model)
    const flowNodes: Node<FlowNodeData>[] = laid.nodes.map((n) => ({
      id: n.id,
      type: n.kind,
      position: { x: n.x, y: n.y },
      data: { topo: n },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }))
    const flowEdges: Edge[] = model.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.kind,
      animated: e.kind === "calls",
      labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 },
      labelBgStyle: { fill: "var(--background)" },
      style: { stroke: "var(--border)" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--border)" },
    }))
    return { nodes: flowNodes, edges: flowEdges }
  }, [model])

  return (
    <div style={fill ? { height: "100%", width: "100%" } : { height, width: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        nodesDraggable={interactive}
        elementsSelectable={interactive}
        zoomOnScroll={interactive}
        panOnDrag={interactive}
        zoomOnDoubleClick={interactive}
        onNodeClick={(_, node) => onNodeClick?.((node.data as FlowNodeData).topo)}
      >
        <Background gap={20} size={1} color="var(--border)" />
        {interactive && <Controls showInteractive={false} />}
      </ReactFlow>
    </div>
  )
}
