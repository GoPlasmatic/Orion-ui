import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Radio, GitBranch, Plug } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TopoNode } from "@/lib/topology"

export interface FlowNodeData extends Record<string, unknown> {
  topo: TopoNode
}

function accentDot(topo: TopoNode): string {
  if (topo.unresolved) return "bg-muted-foreground/40"
  if (topo.kind === "connector") return topo.enabled ? "bg-chart-2" : "bg-muted-foreground/40"
  switch (topo.status) {
    case "active":
      return "bg-chart-2"
    case "draft":
      return "bg-chart-1"
    default:
      return "bg-muted-foreground/40"
  }
}

// Soft neural-style glow keyed to the node's health, reinforcing the
// "nervous system" brand metaphor for the topology canvas.
function glow(topo: TopoNode): string {
  if (topo.unresolved) return ""
  if (topo.kind === "connector")
    return topo.enabled ? "shadow-[0_0_18px_-6px_rgba(76,189,151,0.7)]" : ""
  switch (topo.status) {
    case "active":
      return "shadow-[0_0_18px_-6px_rgba(76,189,151,0.7)]"
    case "draft":
      return "shadow-[0_0_18px_-6px_rgba(17,159,205,0.7)]"
    default:
      return ""
  }
}

const ICON = { channel: Radio, workflow: GitBranch, connector: Plug }

function BaseNode({ topo }: { topo: TopoNode }) {
  const Icon = ICON[topo.kind]
  return (
    <div
      className={cn(
        "flex min-w-[150px] items-center gap-2 rounded-md border bg-card px-3 py-2 transition-shadow",
        glow(topo),
        topo.unresolved && "border-dashed text-muted-foreground",
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/50" />
      <span className={cn("h-2 w-2 shrink-0 rounded-full", accentDot(topo))} />
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{topo.label}</p>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {topo.kind}
          {topo.unresolved && " · missing"}
        </p>
      </div>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/50" />
    </div>
  )
}

export function ChannelNode({ data }: NodeProps) {
  return <BaseNode topo={(data as FlowNodeData).topo} />
}
export function WorkflowNode({ data }: NodeProps) {
  return <BaseNode topo={(data as FlowNodeData).topo} />
}
export function ConnectorNode({ data }: NodeProps) {
  return <BaseNode topo={(data as FlowNodeData).topo} />
}
