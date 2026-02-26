import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { Rule } from "@/api/types"
import { ruleToFlowElements } from "@/lib/workflow-layout"
import { TaskNode } from "./nodes/task-node"
import { ConditionNode } from "./nodes/condition-node"
import { useMemo } from "react"

const nodeTypes = {
  taskNode: TaskNode,
  conditionNode: ConditionNode,
}

export function RuleWorkflow({ rule }: { rule: Rule }) {
  const { nodes, edges } = useMemo(() => ruleToFlowElements(rule), [rule])

  return (
    <div className="h-[500px] w-full rounded-lg border bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap zoomable pannable />
      </ReactFlow>
    </div>
  )
}
