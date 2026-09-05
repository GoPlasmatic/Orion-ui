import { Link } from "react-router"
import { toast } from "sonner"
import {
  ArrowRight,
  ArrowUpRight,
  GitBranch,
  Link2,
  Pencil,
  Play,
  Plug,
  Radio,
  ScrollText,
  Send,
  ShieldAlert,
  Unplug,
  Waypoints,
  X,
  ZapOff,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Callout } from "@/components/ui/callout"
import { Sparkline } from "@/components/ui/sparkline"
import { StatusBadge } from "@/components/shared/status-badge"
import { useTraces } from "@/hooks/use-traces"
import { useTriggerChannel } from "@/hooks/use-channels"
import { cn, formatDate, formatRelative } from "@/lib/utils"
import type { ConnectorUse, SystemGraph, SystemNode } from "@/lib/system-graph"
import type { ChannelTraffic, TrafficSeries } from "@/hooks/use-metrics"
import type { MapFaults, NodeFault } from "@/lib/faults"
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

const FAULT_ICON = { quarantined: ShieldAlert, connector: Unplug, breaker: ZapOff } as const

export function MapInspector({
  node,
  traffic,
  series,
  load,
  graph,
  connectorsByName,
  faults,
  mapFaults,
  spanLabel,
  hops,
  onHopsChange,
  onSelect,
  onClose,
}: {
  node: SystemNode
  traffic: ChannelTraffic | undefined
  /** This channel's per-poll trend inside the window. */
  series: TrafficSeries
  load: EffectiveLoad | undefined
  graph: SystemGraph
  connectorsByName: Map<string, ConnectorUse>
  /** What is broken about this channel that its counters cannot show. */
  faults: NodeFault[]
  mapFaults: MapFaults
  spanLabel: string
  /** Blast-radius reach, in call hops; Infinity for everything reachable. */
  hops: number
  onHopsChange: (hops: number) => void
  onSelect: (node: SystemNode) => void
  onClose: () => void
}) {
  const level = healthOf(traffic)
  const windowed = traffic?.windowed ?? 0
  const derived = !!load && !load.metered && load.effective != null
  const trigger = useTriggerChannel()
  // The three most recent failures, so "what is wrong with it" is one click
  // from "it is red" rather than a filtered list away.
  const { data: failures } = useTraces(
    { channel: node.name, status: "failed", limit: 3, sort_by: "created_at", sort_order: "desc" },
    { enabled: !node.unresolved, refetchInterval: 15_000 },
  )
  const breakerHere = mapFaults.breakers.get(node.id) ?? []

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="truncate font-display text-sm font-semibold">{node.name}</p>
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {node.schedule
              ? `cron ${node.schedule}`
              : node.topic
                ? `kafka ${node.topic}`
                : `${node.methods.join(" ") || node.channelType} ${node.route ?? ""}`}
          </p>
        </div>
        <div className="-mr-1 flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              const url = `${window.location.origin}/system-map?select=${encodeURIComponent(node.id)}`
              navigator.clipboard
                .writeText(url)
                .then(() => toast.success("Link copied", { description: url }))
                .catch(() => toast.error("Could not copy the link"))
            }}
            aria-label="Copy a link to this channel on the map"
            title="Copy link to this view"
            className="text-muted-foreground"
          >
            <Link2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close inspector"
            className="text-muted-foreground"
          >
            <X />
          </Button>
        </div>
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

        {/* ---- faults: what the counters cannot show ---- */}
        {faults.map((fault, i) => {
          const Icon = FAULT_ICON[fault.kind]
          return (
            <Callout
              key={`${fault.kind}-${i}`}
              variant={fault.tone === "destructive" ? "destructive" : "warning"}
              icon={false}
              className="px-3 py-2 text-xs"
            >
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {fault.kind === "quarantined"
                      ? "Quarantined"
                      : fault.kind === "connector"
                        ? "Connector failed to load"
                        : "Circuit breaker"}
                  </p>
                  <p className="mt-0.5">{fault.detail}</p>
                  {fault.kind === "breaker" && breakerHere[0] && (
                    <Link
                      to={`/circuit-breakers?key=${encodeURIComponent(breakerHere[0].key)}`}
                      className="mt-1 inline-block underline underline-offset-2"
                    >
                      Reset from the breakers page
                    </Link>
                  )}
                </div>
              </div>
            </Callout>
          )
        })}

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
                  label={level === "notice" ? "rejected" : "errors"}
                  value={
                    level === "notice"
                      ? formatPct(traffic.rejectedPct)
                      : formatPct(traffic.errorPct)
                  }
                  className={healthText[level]}
                />
                <Stat label="p95" value={formatMs(traffic.p95Ms)} />
              </div>

              {series.rate.length >= 2 && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">rate</p>
                    <Sparkline values={series.rate} height={28} className="text-chart-1" />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">errors %</p>
                    <Sparkline values={series.errorPct} height={28} className="text-destructive" />
                  </div>
                </div>
              )}

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
                {traffic.total.toLocaleString()} total since the server started
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

        {/* ---- recent failures ---- */}
        {failures?.data && failures.data.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Recent failures
            </p>
            <div className="space-y-1">
              {failures.data.map((t) => (
                <Link
                  key={t.id}
                  to={`/traces/${t.id}`}
                  className="block rounded-md border border-destructive/30 px-2 py-1.5 text-xs transition-colors hover:bg-destructive/10"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-destructive" title={t.error_message ?? undefined}>
                      {t.error_message ?? "failed"}
                    </span>
                    <span className="shrink-0 text-muted-foreground" title={formatDate(t.created_at)}>
                      {formatRelative(t.created_at) ?? formatDate(t.created_at)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

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
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Blast radius
          </p>
          <div className="flex gap-0.5 rounded-md border p-0.5" role="group" aria-label="Blast radius">
            {([1, 2, Infinity] as const).map((h) => (
              <button
                key={String(h)}
                type="button"
                onClick={() => onHopsChange(h)}
                aria-pressed={hops === h}
                className={cn(
                  "rounded px-2 py-0.5 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  hops === h ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                title={h === Infinity ? "Everything reachable in either direction" : `${h} call hop${h === 1 ? "" : "s"}`}
              >
                {h === Infinity ? "all" : `${h} hop${h === 1 ? "" : "s"}`}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Waypoints className="h-3 w-3" />
              Called by {node.callers.length}
            </p>
            {node.callers.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">
                {node.schedule ? "Started by its schedule" : "Entry point"}
              </p>
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

        {/* ---- connectors, with their state ---- */}
        {node.connectors.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Plug className="h-3 w-3" />
              Connectors
            </p>
            <div className="flex flex-wrap gap-1.5">
              {node.connectors.map((name) => {
                const use = connectorsByName.get(name)
                const failed = mapFaults.failedConnectors.has(name)
                const breaker = breakerHere.find((b) => b.connector === name)
                const state = failed
                  ? " · failed to load"
                  : breaker
                    ? ` · breaker ${breaker.state}`
                    : use && !use.enabled
                      ? " · off"
                      : ""
                const tone = failed
                  ? "border-destructive/50 text-destructive"
                  : breaker
                    ? "border-warning/50 text-warning"
                    : use && !use.enabled
                      ? "opacity-60"
                      : ""
                return use?.known ? (
                  <Link key={name} to={`/connectors/${use.refId}`}>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] transition-colors hover:bg-accent", tone)}
                    >
                      {name}
                      {state}
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
        <div className="flex flex-wrap gap-2 border-t p-3">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/channels/${node.channelId}`}>
              Channel <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            {node.schedule ? (
              <Link to={`/schedules?channel_id=${encodeURIComponent(node.channelId)}`}>
                <ScrollText className="h-3.5 w-3.5" /> Occurrences
              </Link>
            ) : (
              <Link to={`/traces?channel=${encodeURIComponent(node.name)}`}>
                <ScrollText className="h-3.5 w-3.5" /> Traces
              </Link>
            )}
          </Button>
          {/* A schedule is not reachable by name, so the console refuses it;
              its manual run goes through the same claim path a tick does. */}
          {node.schedule ? (
            node.status === "active" && (
              <Button
                variant="outline"
                size="sm"
                disabled={trigger.isPending}
                onClick={() => trigger.mutate(node.channelId)}
                title="Run now, through the same claim and singleton path a scheduled occurrence takes"
              >
                <Play className="h-3.5 w-3.5" /> {trigger.isPending ? "Triggering…" : "Trigger now"}
              </Button>
            )
          ) : (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/console?channel=${encodeURIComponent(node.name)}`} title="Send a test request to this channel">
                <Send className="h-3.5 w-3.5" /> Test
              </Link>
            </Button>
          )}
          {node.status === "draft" && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/channels/${node.channelId}/edit`}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Link>
            </Button>
          )}
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
