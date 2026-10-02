import { useNavigate } from "react-router"
import { middleTruncate } from "@/lib/domains"
import { cn } from "@/lib/utils"
import type { EffectTone } from "@/lib/workflow-lens"

export interface MapCard {
  key: string
  title: string
  subtitle: string
  /** A third line — the centre card's measured figures. */
  detail?: string
  href?: string
  state?: "default" | "bad" | "muted"
}

export interface MapResource extends MapCard {
  /** `3 read · 1 write`, drawn on the edge. */
  opsLabel: string
  /** The loudest use — a write a retry repeats outranks a read. */
  tone: EffectTone
  /** How many steps use it — the edge's weight. */
  weight: number
}

const W = 760
const ROW = 52
const CARD_H = 42
const MID_H = 64
const LEFT = { x: 4, w: 184 }
const MID = { x: 266, w: 204 }
const RIGHT = { x: 566, w: 190 }
const MAX_LEFT = 4
const MAX_RIGHT = 8

// Edge colour is chart geometry: reads in the primary series, anything a
// retry would repeat in the warning ink, the rest in the neutral series.
const EDGE: Record<EffectTone, string> = {
  read: "stroke-chart-1",
  write: "stroke-warning",
  neutral: "stroke-chart-5",
  gate: "stroke-chart-5",
}

function overflow<T extends MapCard>(list: T[], max: number, noun: string, make: (card: MapCard) => T): T[] {
  if (list.length <= max) return list
  const more = list.length - (max - 1)
  return [...list.slice(0, max - 1), make({ key: "__more", title: `+${more} more ${noun}`, subtitle: "see the table below", state: "muted" })]
}

/**
 * The workflow page's dependency map (not the System Map's
 * `components/graph/dependency-map.tsx`): runs-on channels → this workflow → every resource its steps touch, one SVG
 * scaled to the container's width. Cards navigate; the edge to each resource
 * carries the op counts and is weighted by how many steps use it.
 */
export function WorkflowDependencyMap({
  channels,
  workflow,
  resources,
  label,
}: {
  channels: MapCard[]
  workflow: MapCard
  resources: MapResource[]
  label: string
}) {
  const navigate = useNavigate()
  const left = overflow(channels, MAX_LEFT, "channels", (c) => c)
  const right = overflow(resources, MAX_RIGHT, "resources", (c) => ({ ...c, opsLabel: "", tone: "neutral" as const, weight: 1 }))
  const rows = Math.max(left.length, right.length, 2)
  const H = rows * ROW + 8
  const top = (n: number) => (H - n * ROW) / 2 + (ROW - CARD_H) / 2
  const midY = (H - MID_H) / 2
  const leftTop = top(left.length)
  const rightTop = top(right.length)

  const card = (c: MapCard, x: number, y: number, w: number, h: number, primary = false) => {
    const go = c.href ? () => navigate(c.href!) : undefined
    return (
      <g
        key={c.key}
        role={go ? "link" : undefined}
        tabIndex={go ? 0 : undefined}
        aria-label={go ? `${c.title} — ${c.subtitle}` : undefined}
        onClick={go}
        onKeyDown={
          go
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  go()
                }
              }
            : undefined
        }
        className={cn(go && "cursor-pointer outline-none [&:focus-visible>rect]:stroke-ring [&:hover>rect]:stroke-border-strong")}
      >
        <title>{`${c.title}\n${c.subtitle}${c.detail ? `\n${c.detail}` : ""}`}</title>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={primary ? 10 : 8}
          strokeWidth={primary || c.state === "bad" ? 1.5 : 1}
          strokeDasharray={c.state === "muted" ? "4 3" : undefined}
          className={cn(
            primary ? "fill-muted stroke-primary" : "fill-card",
            !primary && (c.state === "bad" ? "stroke-destructive" : "stroke-border"),
          )}
        />
        <text x={x + 12} y={y + (primary ? 21 : 18)} fontSize={primary ? 12 : 11} className={cn("fill-foreground", primary ? "font-semibold" : "font-medium")}>
          {middleTruncate(c.title, primary ? 30 : 26)}
        </text>
        <text x={x + 12} y={y + (primary ? 38 : 33)} fontSize={10} className={c.state === "bad" ? "fill-destructive" : "fill-muted-foreground"}>
          {middleTruncate(c.subtitle, primary ? 34 : 32)}
        </text>
        {c.detail && (
          <text x={x + 12} y={y + 53} fontSize={10} className="fill-muted-foreground">
            {middleTruncate(c.detail, 34)}
          </text>
        )}
      </g>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card p-2.5">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full min-w-[620px]" role="group" aria-label={label}>
        <defs>
          <marker id="wl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L10 5 L0 10z" className="fill-border-strong" />
          </marker>
        </defs>

        {/* runs on → workflow */}
        {left.map((c, i) => {
          const y1 = leftTop + i * ROW + CARD_H / 2
          const x1 = LEFT.x + LEFT.w
          const y2 = midY + MID_H / 2
          const x2 = MID.x - 2
          return (
            <path
              key={`in-${c.key}`}
              d={`M${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray={c.state === "muted" ? "4 3" : undefined}
              markerEnd={c.state === "muted" ? undefined : "url(#wl-arrow)"}
              className="stroke-border-strong"
            />
          )
        })}
        {left.length > 0 && left[0].state !== "muted" && (
          <text x={LEFT.x + LEFT.w + 14} y={midY + MID_H / 2 - 8} fontSize={10} className="fill-muted-foreground">
            runs
          </text>
        )}

        {/* workflow → resources */}
        {right.map((r, i) => {
          if (r.key === "__more") return null
          const n = right.length
          const x1 = MID.x + MID.w
          const y1 = midY + 10 + ((i + 0.5) * (MID_H - 20)) / n
          const x2 = RIGHT.x
          const y2 = rightTop + i * ROW + CARD_H / 2
          return (
            <g key={`out-${r.key}`}>
              <path
                d={`M${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`}
                fill="none"
                strokeWidth={1.5 + Math.min(r.weight, 4) * 0.9}
                strokeDasharray={r.state === "muted" ? "5 4" : undefined}
                className={cn(r.state === "bad" ? "stroke-destructive" : EDGE[r.tone], "opacity-80")}
              />
              <text x={x2 - 8} y={y2 - 6} fontSize={10} textAnchor="end" className="fill-muted-foreground">
                {r.opsLabel}
              </text>
            </g>
          )
        })}

        {left.map((c, i) => card(c, LEFT.x, leftTop + i * ROW, LEFT.w, CARD_H))}
        {card(workflow, MID.x, midY, MID.w, MID_H, true)}
        {right.map((r, i) => card(r, RIGHT.x, rightTop + i * ROW, RIGHT.w, CARD_H))}
        {right.length === 0 && (
          <text x={RIGHT.x} y={H / 2 + 4} fontSize={11} className="fill-muted-foreground">
            Touches nothing outside the message
          </text>
        )}
      </svg>
    </div>
  )
}
