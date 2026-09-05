import { Handle, Position, type NodeProps } from "@xyflow/react"
import {
  AlertTriangle,
  CalendarClock,
  CornerDownRight,
  HelpCircle,
  Radio,
  ShieldAlert,
  Unplug,
  Waypoints,
  ZapOff,
} from "lucide-react"
import { cn, formatRelative } from "@/lib/utils"
import type { SystemNode } from "@/lib/system-graph"
import type { ChannelTraffic } from "@/hooks/use-metrics"
import { worstTone, type NodeFault } from "@/lib/faults"
import {
  compactNumber,
  formatMs,
  formatPct,
  healthDot,
  healthRing,
  healthText,
  segmentColor,
  type EffectiveLoad,
  type HealthLevel,
} from "@/lib/traffic-encoding"

/** Fan-in at which a channel stops being a callee and starts being a hub. */
export const HUB_THRESHOLD = 5

export const NODE_W = 260
export const NODE_H = 76
export const COMPACT_W = 204
export const COMPACT_H = 42

/**
 * What a node draws at the current zoom. The footprint never changes — the
 * layout is zoom-independent — only the content: below `LOD_ZOOM` the card is
 * a dot and a name big enough to read at overview scale.
 */
export type LevelOfDetail = "dot" | "full"

export interface TrafficNodeData extends Record<string, unknown> {
  node: SystemNode
  traffic?: ChannelTraffic
  level: HealthLevel
  /** What the colour means under the current metric ("failing", "100–500 ms", "draft"). */
  healthLabel?: string
  lod: LevelOfDetail
  /** A cron channel's next fire (an admin-plane instant), for the card's last line. */
  nextFire?: string | null
  /** Diameter in px for the traffic dot. */
  dot: number
  compact: boolean
  dimmed: boolean
  focused: boolean
  /** Measured-or-derived load; `metered: false` means the exporter cannot see it. */
  load?: EffectiveLoad
  /** Quarantine, failed connectors, open breakers — what its counters cannot show. */
  faults: NodeFault[]
}

const FAULT_ICON = { quarantined: ShieldAlert, connector: Unplug, breaker: ZapOff } as const

/** One glyph per fault, in the fault's own tone, with the reason on hover. */
function FaultGlyphs({ faults, size = "h-3 w-3" }: { faults: NodeFault[]; size?: string }) {
  if (faults.length === 0) return null
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {faults.map((fault, i) => {
        const Icon = FAULT_ICON[fault.kind]
        return (
          <Icon
            key={`${fault.kind}-${i}`}
            className={cn(size, fault.tone === "destructive" ? "text-destructive" : "text-warning")}
            aria-label={fault.detail}
          >
            <title>{fault.detail}</title>
          </Icon>
        )
      })}
    </span>
  )
}

/**
 * Proportional strip of what the channel actually answered inside the window.
 *
 * Divs rather than SVG: theme colours here are Tailwind tokens, and a `fill`
 * attribute does not read a CSS custom property the way a `background` does.
 */
function OutcomeBar({ traffic }: { traffic: ChannelTraffic }) {
  const total = traffic.windowed
  if (total <= 0) return null
  const seg = (value: number) => `${(value / total) * 100}%`
  return (
    <div className="mt-1 flex h-1 w-full overflow-hidden rounded-full bg-muted">
      {traffic.ok > 0 && <div className={segmentColor.ok} style={{ width: seg(traffic.ok) }} />}
      {traffic.failed > 0 && (
        <div className={segmentColor.failed} style={{ width: seg(traffic.failed) }} />
      )}
      {traffic.rejected > 0 && (
        <div className={segmentColor.rejected} style={{ width: seg(traffic.rejected) }} />
      )}
      {traffic.duplicate > 0 && (
        <div className={segmentColor.duplicate} style={{ width: seg(traffic.duplicate) }} />
      )}
    </div>
  )
}

function TrafficDot({
  size,
  level,
  hub,
  derived,
}: {
  size: number
  level: HealthLevel
  hub: boolean
  /** Load inferred from callers rather than measured — drawn hollow. */
  derived: boolean
}) {
  return (
    <span
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: Math.max(size + 12, 22), height: Math.max(size + 12, 22) }}
    >
      {/* Halo: only where there is live traffic, so an idle map stays quiet. */}
      {(level !== "idle" || derived) && (
        <span
          className={cn(
            "absolute rounded-full opacity-20",
            derived ? "bg-primary" : healthDot[level],
          )}
          style={{ width: size + 10, height: size + 10 }}
        />
      )}
      <span
        className={cn(
          "relative rounded-full ring-2",
          // Hollow ring, not a fill: this load was never measured, and a solid
          // dot would claim the same confidence as a metered one.
          derived
            ? "border-2 border-primary bg-transparent ring-primary/30"
            : cn(healthDot[level], healthRing[level]),
          hub && "ring-4",
        )}
        style={{ width: size, height: size }}
      />
    </span>
  )
}

export function TrafficNode({ data, selected }: NodeProps) {
  const { node, traffic, level, healthLabel, dot, compact, dimmed, focused, load, faults, lod, nextFire } =
    data as TrafficNodeData
  // The name, and what its colour says — a dot at overview zoom otherwise
  // encodes health by colour alone.
  const title = healthLabel ? `${node.name} · ${healthLabel}` : node.name
  const hub = node.callers.length >= HUB_THRESHOLD
  const faultTone = worstTone(faults ?? [])
  const faultBorder =
    faultTone === "destructive"
      ? "border-destructive/70"
      : faultTone === "warning"
        ? "border-warning/70"
        : null
  // Reached only by channel_call: no ingress series exists, so the load shown is
  // an upper bound inherited from whoever calls it.
  const derived = !!load && !load.metered && load.effective != null
  const isSelected = selected || focused

  const handles = (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/50"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/50"
      />
    </>
  )

  // Overview zoom: the same box, drawn as a dot and a name that survive the
  // scale. Names at this size are what let a person find a channel on a
  // sixty-node canvas without zooming in first.
  if (lod === "dot") {
    return (
      <div
        style={{ width: compact ? COMPACT_W : NODE_W, height: compact ? COMPACT_H : NODE_H }}
        data-lod="dot"
        title={title}
        className={cn(
          "flex items-center gap-3 rounded-xl border bg-card px-3 shadow-xs transition-opacity",
          compact && "border-border/70 bg-card/80",
          node.unresolved && "border-dashed",
          faultBorder,
          isSelected && "border-primary ring-2 ring-ring/60",
          dimmed && "opacity-30",
        )}
      >
        {handles}
        <span
          className={cn(
            "shrink-0 rounded-full",
            compact ? "h-4 w-4" : "h-9 w-9 ring-4",
            derived ? "border-4 border-primary bg-transparent ring-primary/30" : cn(healthDot[level], healthRing[level]),
            hub && !compact && "ring-8",
          )}
        />
        <p
          className={cn(
            "min-w-0 flex-1 truncate font-semibold leading-none",
            compact ? "text-xl text-foreground/80" : "text-[26px]",
          )}
        >
          {node.name}
        </p>
        <FaultGlyphs faults={faults ?? []} size={compact ? "h-4 w-4" : "h-6 w-6"} />
      </div>
    )
  }

  if (compact) {
    return (
      <div
        style={{ width: COMPACT_W, height: COMPACT_H }}
        title={title}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border/70 bg-card/80 px-2.5 shadow-xs transition-opacity",
          node.unresolved && "border-dashed",
          faultBorder,
          isSelected && "border-primary ring-2 ring-ring/60",
          dimmed && "opacity-30",
        )}
      >
        {handles}
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            derived ? "border-2 border-primary" : healthDot[level],
          )}
        />
        <p className="truncate text-xs font-medium text-foreground/80">{node.name}</p>
        <FaultGlyphs faults={faults ?? []} />
        {node.unresolved && <HelpCircle className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />}
      </div>
    )
  }

  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      title={title}
      className={cn(
        "flex items-center gap-1.5 rounded-xl border bg-card px-2 py-1.5 shadow-xs transition-opacity",
        node.unresolved && "border-dashed",
        faultBorder,
        isSelected && "border-primary shadow-md ring-2 ring-ring/60",
        dimmed && "opacity-30",
      )}
    >
      {handles}
      <TrafficDot size={dot} level={level} hub={hub} derived={derived} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight">
            {node.name}
          </p>
          <FaultGlyphs faults={faults ?? []} size="h-3.5 w-3.5" />
          {traffic?.ratePerMin != null && traffic.ratePerMin > 0 ? (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {compactNumber(traffic.ratePerMin)}/m
            </span>
          ) : derived ? (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-primary">
              ≤{compactNumber(load?.effective)}/m
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1 overflow-hidden text-[10px] leading-tight text-muted-foreground">
          {node.unresolved ? (
            <span className="italic">named by a call, not in the registry</span>
          ) : (
            <>
              {hub && (
                <span className="flex shrink-0 items-center gap-0.5 font-medium text-foreground/70">
                  <Waypoints className="h-2.5 w-2.5" />
                  {node.callers.length}
                </span>
              )}
              {node.schedule && <CalendarClock className="h-2.5 w-2.5 shrink-0" />}
              <span className="truncate">
                {node.workflowName ?? node.route ?? node.schedule ?? "—"}
              </span>
            </>
          )}
        </div>

        {traffic && traffic.windowed > 0 ? (
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] tabular-nums">
            <span className={healthText[level]}>
              {level === "notice"
                ? `${formatPct(traffic.rejectedPct)} rej`
                : `${formatPct(traffic.errorPct)} err`}
            </span>
            <span className="text-muted-foreground">{formatMs(traffic.p95Ms)}</span>
            {level === "critical" && (
              <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-destructive" />
            )}
          </div>
        ) : (
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
            {derived ? (
              <>
                <CornerDownRight className="h-2.5 w-2.5 shrink-0 text-primary" />
                <span className="truncate">{node.steps} steps · via calls, unmetered</span>
              </>
            ) : (
              <>
                <Radio className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">
                  {node.steps} steps ·{" "}
                  {node.schedule
                    ? nextFire
                      ? `next fire ${formatRelative(nextFire) ?? "pending"}`
                      : "scheduled"
                    : node.callers.length > 0
                      ? "no calls yet"
                      : "idle"}
                </span>
              </>
            )}
          </div>
        )}

        {traffic && <OutcomeBar traffic={traffic} />}
      </div>
    </div>
  )
}
