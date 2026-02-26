import { Handle, Position } from "@xyflow/react"
import type { NodeProps } from "@xyflow/react"
import type { TaskNodeData } from "@/lib/workflow-layout"
import { getFunctionStyle } from "@/components/rules/node-styles"
import { cn } from "@/lib/utils"
import { ShieldCheck, Plug } from "lucide-react"

export function TaskNode({ data }: NodeProps) {
  const d = data as TaskNodeData
  const style = getFunctionStyle(d.functionName)

  return (
    <div className={cn("w-[280px] rounded-lg border-2 bg-white p-3 shadow-sm", style.bg)}>
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", style.color, style.bg)}>
              {style.label}
            </span>
          </div>
          <p className="mt-1 truncate text-sm font-medium text-gray-900">{d.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {d.connectorName && (
              <span className="flex items-center gap-1">
                <Plug className="h-3 w-3" />
                {d.connectorName}
              </span>
            )}
            {d.mappingCount !== undefined && (
              <span>{d.mappingCount} mappings</span>
            )}
          </div>
        </div>
        {d.hasCondition && (
          <div className="flex flex-col items-center" title={d.conditionSummary ?? "Conditional"}>
            <ShieldCheck className="h-4 w-4 text-amber-500" />
            <span className="mt-0.5 text-[9px] text-amber-600">Guard</span>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
    </div>
  )
}
