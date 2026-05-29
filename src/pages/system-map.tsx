import { useMemo } from "react"
import { Link, useSearchParams } from "react-router"
import { useChannels } from "@/hooks/use-channels"
import { useWorkflows } from "@/hooks/use-workflows"
import { useConnectors } from "@/hooks/use-connectors"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { TopologyGraph } from "@/components/graph/topology-graph"
import { buildIndex, buildChannelTopology, type TopoNode } from "@/lib/topology"
import { entityStatusClass } from "@/lib/status"
import { ArrowRight, X } from "lucide-react"

const detailPath = (node: TopoNode) =>
  node.kind === "channel"
    ? `/channels/${node.refId}`
    : node.kind === "workflow"
      ? `/workflows/${node.refId}`
      : `/connectors/${node.refId}`

export function SystemMapPage() {
  const [params, setParams] = useSearchParams()
  const { data: channels, isLoading: chLoading } = useChannels({ limit: 1000 })
  const { data: workflows } = useWorkflows({ limit: 1000 })
  const { data: connectors } = useConnectors({ limit: 1000 })

  const channelList = useMemo(() => channels?.data ?? [], [channels?.data])
  const selected = params.get("channel") ?? channelList[0]?.channel_id ?? ""

  const idx = useMemo(
    () => buildIndex(channelList, workflows?.data ?? [], connectors?.data ?? []),
    [channelList, workflows?.data, connectors?.data],
  )
  const model = useMemo(
    () => (selected ? buildChannelTopology(selected, idx) : { nodes: [], edges: [] }),
    [selected, idx],
  )

  const selectedNodeId = params.get("node")
  const selectedNode = model.nodes.find((n) => n.id === selectedNodeId) ?? null

  const setSelected = (channelId: string) => {
    const next = new URLSearchParams(params)
    next.set("channel", channelId)
    next.delete("node")
    setParams(next, { replace: true })
  }
  const setNode = (node: TopoNode) => {
    const next = new URLSearchParams(params)
    next.set("node", node.id)
    setParams(next, { replace: true })
  }
  const clearNode = () => {
    const next = new URLSearchParams(params)
    next.delete("node")
    setParams(next, { replace: true })
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="System Map"
        description="Trace one channel through the workflow it runs, the channels it calls, and the connectors it uses"
      >
        <Select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-56">
          {channelList.map((c) => (
            <option key={c.channel_id} value={c.channel_id}>
              {c.name}
            </option>
          ))}
        </Select>
      </PageHeader>

      {chLoading ? (
        <Skeleton className="min-h-0 flex-1" />
      ) : channelList.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No channels to map. Create a channel to see its topology.
          </CardContent>
        </Card>
      ) : (
        <Card className="relative min-h-0 flex-1 overflow-hidden p-0">
          <TopologyGraph model={model} fill onNodeClick={setNode} />

          {selectedNode && (
            <div className="absolute right-3 top-3 z-10 w-64 rounded-md border bg-card/95 p-3 shadow-lg backdrop-blur">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Badge variant="outline" className="text-[10px] uppercase">{selectedNode.kind}</Badge>
                  <p className="mt-1 truncate text-sm font-semibold">{selectedNode.label}</p>
                </div>
                <button onClick={clearNode} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {selectedNode.status && (
                  <Badge variant="outline" className={entityStatusClass[selectedNode.status]}>
                    {selectedNode.status}
                  </Badge>
                )}
                {selectedNode.kind === "connector" && (
                  <Badge variant="outline">{selectedNode.enabled ? "enabled" : "disabled"}</Badge>
                )}
              </div>
              {selectedNode.unresolved ? (
                <p className="mt-2 text-xs text-muted-foreground">Referenced by name but not found in the registry.</p>
              ) : (
                <Button variant="outline" size="sm" className="mt-3 w-full" asChild>
                  <Link to={detailPath(selectedNode)}>
                    Open {selectedNode.kind} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
