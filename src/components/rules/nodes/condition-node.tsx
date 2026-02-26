import { Handle, Position } from "@xyflow/react"
import type { NodeProps } from "@xyflow/react"
import type { ConditionNodeData } from "@/lib/workflow-layout"
import { ShieldCheck } from "lucide-react"

export function ConditionNode({ data }: NodeProps) {
  const d = data as ConditionNodeData
  return (
    <div className="w-[280px] rounded-lg border-2 border-indigo-200 bg-indigo-50 p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-indigo-600" />
        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
          Entry Condition
        </span>
      </div>
      <p className="mt-1 text-sm font-medium text-indigo-900">{d.conditionSummary}</p>
      <Handle type="source" position={Position.Bottom} className="!bg-indigo-400" />
    </div>
  )
}
