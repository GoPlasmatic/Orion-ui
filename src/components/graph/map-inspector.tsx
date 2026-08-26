import { Link } from "react-router"
import {
  ArrowRight,
  ArrowUpRight,
  GitBranch,
  Plug,
  Radio,
  ScrollText,
  Waypoints,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Callout } from "@/components/ui/callout"
import { StatusBadge } from "@/components/shared/status-badge"
import { cn } from "@/lib/utils"
import type { ConnectorUse, SystemGraph, SystemNode } from "@/lib/system-graph"
import type { ChannelTraffic } from "@/hooks/use-metrics"
import {
  compactNumber,
  formatMs,
  formatPct,
  healthDot,
  healthText,
  healthOf,
  segmentColor,
  type EffectiveLoad,
} from "@/lib/traffic-encoding"

function Stat({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("font-mono text-sm tabular-nums", className)}>{value}</p>
    </div>
  )
}

function ChannelLink({
  name,
  graph,
  onSelect,
}: {
  name: string
  graph: SystemGraph
  onSelect: (node: SystemNode) => void
}) {
  const node = graph.byId.get(name)
  if (!node) return <span className="text-xs text-muted-foreground">{name}</span>
  return (
    <button
      type="button"
      onClick={() => onSelect(node)}
      className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <span className="truncate">{name}</span>
      {node.unresolved && (
        <Badge variant="outline" className="ml-auto shrink-0 text-[9px]">
          missing
        </Badge>
      )}
    </button>
  )
}

export function MapInspector({
  node,
  traffic,
  load,
  graph,
  connectorsByName,
  spanLabel,
  onSelect,
  onClose,
}: {
  node: SystemNode
  traffic: ChannelTraffic | undefined
  load: EffectiveLoad | undefined
  graph: SystemGraph
  connectorsByName: Map<string, ConnectorUse>
  spanLabel: string
  onSelect: (node: SystemNode) => void
  onClose: () => void
}) {
  const level = healthOf(traffic)
  const windowed = traffic?.windowed ?? 0
  const derived = !!load && !load.metered && load.effective != null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="truncate font-display text-sm font-semibold">{node.name}</p>
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {node.methods.join(" ") || node.channelType} {node.route ?? ""}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close inspector"
          className="-mr-1 shrink-0 text-muted-foreground"
        >
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        {node.unresolved ? (
          <Callout variant="warning">
            A <code className="font-mono">channel_call</code> names this channel, but no channel
            with that name is registered. The call will fail at runtime.
          </Callout>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={node.status} />
            <Badge variant="outline" className="text-[10px]">
              {node.channelType} · {node.protocol}
            </Badge>
            {node.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* ---- live traffic ---- */}
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Traffic
            </p>
            <span className="text-[10px] text-muted-foreground">{spanLabel}</span>
          </div>

          {windowed > 0 && traffic ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="rate" value={`${compactNumber(traffic.ratePerMin)}/m`} />
                <Stat
                  label={level === "rejected" ? "rejected" : "errors"}
                  value={
                    level === "rejected"
                      ? formatPct(traffic.rejectedPct)
                      : formatPct(traffic.errorPct)
                  }
                  className={healthText[level]}
                />
                <Stat label="p95" value={formatMs(traffic.p95Ms)} />
              </div>

              <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
                {traffic.ok > 0 && (
                  <div className={segmentColor.ok} style={{ width: `${(traffic.ok / windowed) * 100}%` }} />
                )}
                {traffic.failed > 0 && (
                  <div
                    className={segmentColor.failed}
                    style={{ width: `${(traffic.failed / windowed) * 100}%` }}
                  />
                )}
                {traffic.rejected > 0 && (
                  <div
                    className={segmentColor.rejected}
                    style={{ width: `${(traffic.rejected / windowed) * 100}%` }}
                  />
                )}
                {traffic.duplicate > 0 && (
                  <div
                    className={segmentColor.duplicate}
                    style={{ width: `${(traffic.duplicate / windowed) * 100}%` }}
                  />
                )}
              </div>

              <div className="mt-2 space-y-0.5 text-[11px]">
                {(
                  [
                    ["ok", traffic.ok, segmentColor.ok],
                    ["failed", traffic.failed, segmentColor.failed],
                    [traffic.dominantIssue ?? "rejected", traffic.rejected, segmentColor.rejected],
                    ["duplicate", traffic.duplicate, segmentColor.duplicate],
                  ] as const
                )
                  .filter(([, value]) => value > 0)
                  .map(([label, value, color]) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <span className={cn("h-1.5 w-1.5 rounded-full", color)} />
                      <span className="text-muted-foreground">{label}</span>
                      <span className="ml-auto font-mono tabular-nums">{value}</span>
                    </div>
                  ))}
              </div>

              <p className="mt-2 text-[10px] text-muted-foreground">
                {traffic.total.toLocaleString()} total since the server started · p95 is cumulative
              </p>
            </>
          ) : derived ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-lg tabular-nums text-primary">
                  ≤{compactNumber(load?.effective)}
                </span>
                <span className="text-xs text-muted-foreground">requests / min, inferred</span>
              </div>
              <Callout variant="info" className="mt-2 py-2 text-[11px]">
                Nothing reaches this channel from outside, so the exporter carries no series for
                it — <code className="font-mono">orion_messages_total</code> counts ingress, and a{" "}
                <code className="font-mono">channel_call</code> is dispatched inside the engine.
                The figure above is the combined rate of the {node.callers.length} channel
                {node.callers.length === 1 ? "" : "s"} that call it, so it is an upper bound: one
                call per run makes it exact, a conditional branch makes it high.
              </Callout>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={cn("h-2 w-2 rounded-full", healthDot.idle)} />
              {node.callers.length > 0
                ? "No calls reached this channel in the window"
                : "No requests in this window"}
            </div>
          )}
        </div>

        <Separator />

        {/* ---- what it runs ---- */}
        {node.workflowId && (
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Runs
            </p>
            <Link
              to={`/workflows/${node.workflowId}`}
              className="flex items-start gap-2 rounded-md border p-2 transition-colors hover:bg-accent"
            >
              <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{node.workflowName ?? node.workflowId}</p>
                <p className="text-[10px] text-muted-foreground">
                  {node.steps} step{node.steps === 1 ? "" : "s"}
                  {node.groups > 0 && ` · ${node.groups} group${node.groups === 1 ? "" : "s"}`}
                  {node.workflowShared && " · shared"}
                </p>
              </div>
              <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            </Link>
          </div>
        )}

        {/* ---- blast radius ---- */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Waypoints className="h-3 w-3" />
              Called by {node.callers.length}
            </p>
            {node.callers.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">Entry point</p>
            ) : (
              <div className="-mx-1 max-h-40 overflow-y-auto">
                {node.callers.map((name) => (
                  <ChannelLink key={name} name={name} graph={graph} onSelect={onSelect} />
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <ArrowRight className="h-3 w-3" />
              Calls {node.callees.length}
            </p>
            {node.callees.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">None</p>
            ) : (
              <div className="-mx-1 max-h-40 overflow-y-auto">
                {node.callees.map((name) => (
                  <ChannelLink key={name} name={name} graph={graph} onSelect={onSelect} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ---- connectors ---- */}
        {node.connectors.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Plug className="h-3 w-3" />
              Connectors
            </p>
            <div className="flex flex-wrap gap-1.5">
              {node.connectors.map((name) => {
                const use = connectorsByName.get(name)
                return use?.known ? (
                  <Link key={name} to={`/connectors/${use.refId}`}>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] transition-colors hover:bg-accent",
                        !use.enabled && "opacity-60",
                      )}
                    >
                      {name}
                      {!use.enabled && " · off"}
                    </Badge>
                  </Link>
                ) : (
                  <Badge key={name} variant="outline" className="border-dashed text-[10px]">
                    {name} · unknown
                  </Badge>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {!node.unresolved && (
        <div className="grid grid-cols-2 gap-2 border-t p-3">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/channels/${node.channelId}`}>
              Channel <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/traces?channel=${encodeURIComponent(node.name)}`}>
              <ScrollText className="h-3.5 w-3.5" /> Traces
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
}

export function InspectorPlaceholder({ activeCount }: { activeCount: number }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <Waypoints className="h-6 w-6 text-muted-foreground/50" />
      <p className="text-sm font-medium">Select a channel</p>
      <p className="text-xs text-muted-foreground">
        Click any node to see its live traffic, what calls it, and what it depends on. Everything
        outside its blast radius dims.
      </p>
      {activeCount > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {activeCount} channel{activeCount === 1 ? "" : "s"} carrying traffic right now
        </p>
      )}
    </div>
  )
}
