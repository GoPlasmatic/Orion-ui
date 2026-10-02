import { Handle, Position, type NodeProps } from "@xyflow/react"
import { BrainCircuit, ChevronsDownUp, ChevronsUpDown, Pin, Plug, Puzzle, Unplug } from "lucide-react"
import { cn } from "@/lib/utils"
import { middleTruncate } from "@/lib/domains"
import { DOMAIN_HEADER, type DomainGroup, type DomainLoad, type Hub } from "@/lib/dependency-graph"
import type { NodeFault } from "@/lib/faults"
import { worstTone } from "@/lib/faults"
import type { ConnectorTraffic } from "@/hooks/use-ops-metrics"
import { ChangePin, FaultGlyphs } from "@/components/graph/traffic-node"
import {
  compactNumber,
  formatMs,
  formatPct,
  healthDot,
  healthRing,
  healthText,
  type HealthLevel,
} from "@/lib/traffic-encoding"

/** Footprints, fixed so the layout is zoom-independent. */
export const DOMAIN_W = 268
export const DOMAIN_H = 80
export const DEP_CHANNEL_W = 224
export const DEP_CHANNEL_H = 44
export const HUB_W = 256
export const HUB_H = 80

const handleClass = "!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/50"

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

export interface DomainNodeData extends Record<string, unknown> {
  domain: DomainGroup
  /** Domain label: the name, or "admin" for `soma-admin-*`. */
  title: string
  expanded: boolean
  width: number
  height: number
  load: DomainLoad
  /** Worst member level under the colour metric. */
  level: HealthLevel
  faulted: number
  changed: number
  /** With a hub selected: how many members depend on it. Null otherwise. */
  dependOn: number | null
  dimmed: boolean
  onToggle: (domainId: string) => void
}

function domainFigures(load: DomainLoad): string {
  if (load.windowed === 0) return "idle in the window"
  const parts = [`${compactNumber(load.rate)}/m`, `${formatPct(load.errorPct)} err`]
  if (load.worstP95Ms != null) parts.push(`p95 ≤ ${formatMs(load.worstP95Ms)}`)
  return parts.join(" · ")
}

/**
 * A domain: collapsed, one summary box the size of a node — count, combined
 * rate and error share, the slowest member's p95, worst-member colour; open, a
 * frame around its channels. Either way the whole caption is a button, so the
 * keyboard can fold and open it.
 */
export function DomainNode({ data }: NodeProps) {
  const { domain, title, expanded, width, height, load, level, faulted, changed, dependOn, dimmed, onToggle } =
    data as DomainNodeData
  const n = domain.members.length
  const caption = `${title} · ${n} channel${n === 1 ? "" : "s"}`
  if (!expanded) {
    return (
      <div style={{ width, height }} className={cn("relative transition-opacity", dimmed && "opacity-30")}>
        <Handle type="source" position={Position.Right} className={handleClass} />
        <button
          type="button"
          onClick={() => onToggle(domain.id)}
          className="nodrag flex h-full w-full cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 text-left shadow-xs hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          title={`${caption} · ${domainFigures(load)} · click to open`}
          aria-expanded={false}
          aria-label={`${caption}, collapsed`}
        >
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
            <span className={cn("absolute inset-0 rounded-full opacity-20", healthDot[level])} />
            <span className={cn("h-6 w-6 rounded-full ring-2", healthDot[level], healthRing[level])} />
            <span className="absolute -right-1.5 -top-1 rounded-full bg-muted px-1 font-mono text-[10px] tabular-nums text-foreground">
              {n}
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-display text-sm font-semibold leading-tight">{title}</span>
              {changed > 0 && (
                <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-info" title={`${changed} changed in the last day`}>
                  <Pin className="h-3 w-3" aria-hidden />
                  {changed}
                </span>
              )}
            </span>
            <span className="block truncate font-mono text-[10px] tabular-nums text-muted-foreground">
              {domainFigures(load)}
            </span>
            <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{n} channels</span>
              {dependOn != null && (
                <span className="font-medium text-foreground">
                  {dependOn} of {n} depend
                </span>
              )}
              {faulted > 0 && <span className="text-destructive">{faulted} faulted</span>}
            </span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </div>
    )
  }
  return (
    <div
      style={{ width, height }}
      className={cn(
        "rounded-xl border border-border/80 bg-card/60 shadow-xs transition-opacity",
        dimmed && "opacity-30",
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(domain.id)}
        style={{ height: DOMAIN_HEADER }}
        className="nodrag flex w-full cursor-pointer items-center gap-2 rounded-t-xl px-3 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        title={`${caption} · click to fold`}
        aria-expanded
        aria-label={`${caption}, open`}
      >
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", healthDot[level])} />
        <span className="shrink-0 font-display text-sm font-semibold">{title}</span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{n}</span>
        <span className="min-w-0 truncate font-mono text-[10px] tabular-nums text-muted-foreground">
          {domainFigures(load)}
          {dependOn != null && ` · ${dependOn} depend`}
        </span>
        <ChevronsDownUp className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Channel inside an open domain
// ---------------------------------------------------------------------------

export interface DepChannelNodeData extends Record<string, unknown> {
  id: string
  /** shortName, middle-truncated to the card. */
  label: string
  title: string
  level: HealthLevel
  /** Dot diameter in px. */
  dot: number
  ratePerMin: number | null
  faults: NodeFault[]
  pin: string | null
  dimmed: boolean
  focused: boolean
  /** Overview zoom: a bigger name and nothing else. */
  lod: "dot" | "full"
}

export function DepChannelNode({ data, selected }: NodeProps) {
  const { label, title, level, dot, ratePerMin, faults, pin, dimmed, focused, lod } = data as DepChannelNodeData
  const tone = worstTone(faults)
  return (
    <div
      style={{ width: DEP_CHANNEL_W, height: DEP_CHANNEL_H }}
      title={title}
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-card px-2.5 shadow-xs transition-opacity",
        tone === "destructive" && "border-destructive/70",
        tone === "warning" && "border-warning/70",
        (selected || focused) && "border-primary ring-2 ring-ring/60",
        dimmed && "opacity-25",
      )}
    >
      <Handle type="source" position={Position.Right} className={handleClass} />
      <span className="flex w-5 shrink-0 items-center justify-center">
        <span
          className={cn("rounded-full", healthDot[level])}
          style={{ width: lod === "dot" ? 18 : dot, height: lod === "dot" ? 18 : dot }}
        />
      </span>
      <p
        className={cn(
          "min-w-0 flex-1 overflow-hidden whitespace-nowrap font-medium leading-none",
          lod === "dot" ? "text-lg" : "text-xs",
        )}
      >
        {label}
      </p>
      <ChangePin title={pin} className={lod === "dot" ? "h-4 w-4" : "h-3 w-3"} />
      <FaultGlyphs faults={faults} size={lod === "dot" ? "h-4 w-4" : "h-3 w-3"} />
      {lod === "full" && ratePerMin != null && ratePerMin > 0 && (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {compactNumber(ratePerMin)}/m
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------

export interface HubNodeData extends Record<string, unknown> {
  hub: Hub
  traffic?: ConnectorTraffic
  level: HealthLevel
  failedToLoad: string | null
  /** The traffic line is windowed (`live`) or cumulative (`warming`). */
  windowed: boolean
  dimmed: boolean
  focused: boolean
}

const HUB_ICON = { connector: Plug, plugin: Puzzle, model: BrainCircuit } as const

function hubLine(hub: Hub, traffic: ConnectorTraffic | undefined, windowed: boolean): string {
  if (hub.kind !== "connector") return "referenced · not metered per channel"
  if (!traffic) return hub.dependants.length === 0 ? "no calls" : "no calls measured"
  const calls = traffic.windowed ?? traffic.total
  if (calls === 0) return "no calls in the window"
  const rate = windowed && traffic.ratePerMin != null ? `${compactNumber(traffic.ratePerMin)}/m` : `${compactNumber(calls)} total`
  return `${rate} · ${formatPct(traffic.errorPct)} err · p95 ${formatMs(traffic.p95Ms)}`
}

/**
 * A shared dependency: a connector, a plugin or a model, with its type, how
 * many channels in view lean on it and — for a connector — its own live
 * figures. Selecting one lights its blast radius.
 */
export function HubNode({ data, selected }: NodeProps) {
  const { hub, traffic, level, failedToLoad, windowed, dimmed, focused } = data as HubNodeData
  const Icon = failedToLoad ? Unplug : HUB_ICON[hub.kind]
  const n = hub.dependants.length
  const state = !hub.known ? "not registered" : !hub.enabled ? "off" : null
  return (
    <div
      style={{ width: HUB_W, height: HUB_H }}
      title={`${hub.name} · ${hub.type ?? hub.kind}${state ? ` · ${state}` : ""}${failedToLoad ? ` · failed to load: ${failedToLoad}` : ""}`}
      className={cn(
        "flex items-center gap-2.5 rounded-xl border-2 bg-card px-3 shadow-xs transition-opacity",
        !hub.known && "border-dashed",
        failedToLoad ? "border-destructive/70" : "border-border",
        (selected || focused) && "border-primary shadow-md ring-2 ring-ring/60",
        !hub.enabled && hub.known && "opacity-70",
        dimmed && "opacity-25",
      )}
    >
      <Handle type="target" position={Position.Left} className={handleClass} />
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className={cn("h-5 w-5", failedToLoad ? "text-destructive" : healthText[level])} aria-hidden />
        <span
          className={cn("absolute -right-1 -top-1 h-3 w-3 rounded-full ring-2 ring-card", healthDot[level])}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="overflow-hidden whitespace-nowrap text-[13px] font-semibold leading-tight">
          {middleTruncate(hub.name, 22)}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground/80">{hub.type ?? "unknown"}</span>
          {" · "}
          {n === 0 ? "unused" : `${n} dependant${n === 1 ? "" : "s"}`}
          {state && <span className="text-warning"> · {state}</span>}
        </p>
        <p className={cn("truncate font-mono text-[10px] tabular-nums", healthText[level])}>
          {hubLine(hub, traffic, windowed)}
        </p>
      </div>
    </div>
  )
}
