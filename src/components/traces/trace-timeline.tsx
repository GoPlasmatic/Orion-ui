import { useMemo, useState } from "react"
import { X } from "lucide-react"
import type { TaskCost } from "@/hooks/use-ops-metrics"
import type { StepEffect } from "@/lib/function-effects"
import type { Timeline, TimelineGroup, TimelineStep } from "@/lib/trace-timeline"
import { formatMicros } from "@/lib/trace-timeline"
import { buildAxis, spanPct, splitAdvice, type AxisMode, type TimeAxis } from "@/lib/trace-axis"
import { effectLabel, overP95, resourceLabel, vsP95 } from "@/lib/trace-step-uses"
import { formatPct } from "@/lib/traffic-encoding"
import { cn, plural } from "@/lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { KpiCard } from "@/components/shared/kpi-card"

/**
 * Where a run's time went: the headline numbers, the whole run at true scale,
 * and one row per step on a shared lane — grouped the way the workflow is
 * (`loop.setup`, each iteration), each bar ticked at its task's p95.
 */

export interface TraceTimelineProps {
  timeline: Timeline
  /** One per step, by `TimelineStep.index`; null where the authored task is unknown. */
  effects: (StepEffect | null)[]
  /** Per-task baselines by task id; null while metrics are unavailable. */
  costs: Map<string, TaskCost> | null
  selected: number | null
  onSelect: (index: number) => void
  /** Names the settle stretch: a cron run also settles its occurrence. */
  mode?: string
  /** The loop's iteration binding, `it = temp_data.plan[k]`, when it is a plain `var`. */
  loopBinding?: { as: string; over: string } | null
}

const settleCaption = (mode?: string) => (mode === "cron" ? "trace + occurrence write" : "trace write")
const admissionCaption = (mode?: string) => (mode === "cron" ? "claim, lease" : "before the first step")

const GROUP_FILL: Record<TimelineGroup["kind"], string> = {
  setup: "bg-chart-1",
  iteration: "bg-chart-2",
  main: "bg-chart-1",
}

function stepFill(s: TimelineStep): string {
  if (s.outcome === "failed") return "bg-destructive"
  return s.phase === "body" ? "bg-chart-2" : "bg-chart-1"
}

/** The hatched break where the split axis skips time. */
function Hatch({ startPct, endPct, className }: { startPct: number; endPct: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("absolute", className)}
      style={{
        backgroundImage: "repeating-linear-gradient(135deg, var(--border-strong) 0 2px, transparent 2px 6px)",
        left: `${startPct}%`,
        width: `${endPct - startPct}%`,
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

function Headline({ timeline, costs, mode }: Pick<TraceTimelineProps, "timeline" | "costs" | "mode">) {
  const d = timeline.dominant
  const timed = timeline.steps.filter((s) => s.durationUs != null)
  const others = timed.filter((s) => s !== d)
  const othersUs = others.reduce((a, s) => a + (s.durationUs ?? 0), 0)
  const p95 = costs ? overP95(others, (id) => costs.get(id)?.p95Ms) : null
  const baseline =
    p95 && p95.judged > 0 ? (p95.over === 0 ? "each inside its p95" : `${p95.over} over its p95`) : undefined
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <KpiCard title="Total" value={formatMicros(timeline.totalUs)} hint={`${plural(timed.length, "step")} ran`} />
      {d && d.durationUs != null && (
        <KpiCard
          title="In one step"
          value={formatPct((d.durationUs / Math.max(1, timeline.totalUs)) * 100)}
          hint={`${d.taskId} · ${formatMicros(d.durationUs)}`}
          valueClass={d.outcome === "failed" ? "text-destructive" : undefined}
        />
      )}
      <KpiCard title={`Other ${plural(others.length, "step")}`} value={formatMicros(othersUs)} hint={baseline} />
      <KpiCard
        title="Engine between steps"
        value={formatMicros(timeline.gapUs)}
        hint={plural(timeline.gaps, "hand-off")}
      />
      <KpiCard title="Settle" value={formatMicros(timeline.settleUs)} hint={settleCaption(mode)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview strip — always linear
// ---------------------------------------------------------------------------

interface Piece {
  from: number
  to: number
  fill: string
  /** The legend entry this piece belongs to. */
  legend: string
}

function overviewPieces(timeline: Timeline): Piece[] {
  const pieces: Piece[] = []
  if (timeline.admissionUs > 0) pieces.push({ from: 0, to: timeline.admissionUs, fill: "bg-chart-5", legend: "admission" })
  const iterations = timeline.groups.filter((g) => g.kind === "iteration").length
  for (const g of timeline.groups) {
    if (g.startUs == null || g.endUs == null) continue
    const legend =
      g.kind === "iteration" ? (iterations === 1 ? g.label : plural(iterations, "iteration")) : g.label || "steps"
    pieces.push({ from: g.startUs, to: g.endUs, fill: GROUP_FILL[g.kind], legend })
  }
  const f = timeline.failed
  if (f && f.startUs != null && f.durationUs != null) {
    pieces.push({ from: f.startUs, to: f.startUs + f.durationUs, fill: "bg-destructive", legend: "failing step" })
  }
  if (timeline.settleUs > 0) {
    pieces.push({ from: timeline.engineEndUs, to: timeline.totalUs, fill: "bg-border-strong", legend: "settle" })
  }
  return pieces
}

function Overview({ timeline, axis }: { timeline: Timeline; axis: TimeAxis }) {
  const total = Math.max(1, timeline.totalUs)
  const pieces = overviewPieces(timeline)
  const legend = [...new Map(pieces.map((p) => [p.legend, p.fill])).entries()]
  const zoomed = axis.mode === "split" ? axis.segments.filter((s) => s.zoomed) : []
  const pct = (us: number) => (us / total) * 100
  return (
    <div className="grid gap-1.5">
      <div
        className="relative h-[18px] overflow-hidden rounded bg-muted"
        role="img"
        aria-label={`Whole run at linear scale, ${formatMicros(timeline.totalUs)}`}
      >
        {pieces.map((p, i) => (
          <span
            key={i}
            className={cn("absolute inset-y-0", p.fill)}
            style={{ left: `${pct(p.from)}%`, width: `${Math.max(pct(p.to - p.from), 0.3)}%` }}
            title={`${p.legend} · ${formatMicros(p.to - p.from)}`}
          />
        ))}
        {zoomed.map((z, i) => (
          <span
            key={`z${i}`}
            className="absolute inset-y-0 rounded-sm border-[1.5px] border-foreground"
            style={{ left: `${pct(z.fromUs)}%`, width: `${Math.max(pct(z.toUs - z.fromUs), 1.2)}%` }}
            title={`${formatMicros(z.toUs - z.fromUs)} drawn across ${Math.round(z.endPct - z.startPct)}% of the lane below`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
        {legend.map(([label, fill]) => (
          <li key={label} className="flex items-center gap-1.5">
            <i className={cn("inline-block h-2.5 w-2.5 rounded-sm", fill)} aria-hidden />
            {label}
          </li>
        ))}
        {zoomed.length > 0 && (
          <li className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-sm border-[1.5px] border-foreground" aria-hidden />
            zoomed below
          </li>
        )}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lane pieces
// ---------------------------------------------------------------------------

function LaneBackdrop({ axis }: { axis: TimeAxis }) {
  return (
    <>
      {axis.grid.map((pct, i) => (
        <span key={`g${i}`} aria-hidden className="absolute -inset-y-1.5 w-px bg-border" style={{ left: `${pct}%` }} />
      ))}
      {axis.breaks.map((b, i) => (
        <Hatch key={`b${i}`} {...b} className="-inset-y-1.5" />
      ))}
    </>
  )
}

function Bar({ axis, from, to, fill, faint, title }: { axis: TimeAxis; from: number; to: number; fill: string; faint?: boolean; title?: string }) {
  const { left, width } = spanPct(axis, from, to)
  return (
    <span
      className={cn(
        "absolute inset-y-[3px] rounded-[3px] motion-safe:transition-[left,width] motion-safe:duration-200",
        fill,
        faint && "opacity-35",
      )}
      // A 9 µs step stays visible without being drawn as anything longer.
      style={{ left: `${left}%`, width: `${width}%`, minWidth: 2 }}
      title={title}
    />
  )
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

function groupCaption(g: TimelineGroup, binding: TraceTimelineProps["loopBinding"]): string {
  const count = plural(g.steps.length, "step")
  if (g.kind === "setup") return `${count}, once per run`
  if (g.kind === "iteration" && binding && g.iteration != null) {
    return `${binding.as} = ${binding.over}[${g.iteration}] · ${count}`
  }
  return count
}

function SpanRow({
  axis,
  title,
  caption,
  from,
  to,
  fill,
}: {
  axis: TimeAxis
  title: string
  caption: string
  from: number | null
  to: number | null
  fill: string
}) {
  return (
    <TableRow className="bg-muted/50 text-xs text-muted-foreground hover:bg-muted/50">
      <TableCell colSpan={2} className="truncate py-1.5">
        <span className="font-medium text-foreground">{title}</span>
        {caption && <span> · {caption}</span>}
      </TableCell>
      <TableCell className="py-1.5">
        <div className="relative h-4">
          <LaneBackdrop axis={axis} />
          {from != null && to != null && <Bar axis={axis} from={from} to={to} fill={fill} faint />}
        </div>
      </TableCell>
      <TableCell className="py-1.5 text-right font-mono tabular-nums">
        {from != null && to != null ? formatMicros(to - from) : ""}
      </TableCell>
      <TableCell className="py-1.5" />
    </TableRow>
  )
}

function StepRow({
  step,
  effect,
  cost,
  axis,
  selected,
  onSelect,
}: {
  step: TimelineStep
  effect: StepEffect | null
  cost: TaskCost | undefined
  axis: TimeAxis
  selected: boolean
  onSelect: () => void
}) {
  const failed = step.outcome === "failed"
  const skipped = step.outcome === "skipped"
  const vs = vsP95(step.durationUs, cost?.p95Ms)
  const authored = step.task?.name && step.task.name !== step.taskId ? step.task.name : null
  const p95Us = cost?.p95Ms != null ? cost.p95Ms * 1000 : null
  const tickUs = step.startUs != null && p95Us != null ? step.startUs + p95Us : null
  const label = effectLabel(effect)
  return (
    <TableRow
      onActivate={onSelect}
      aria-selected={selected}
      data-step={step.index}
      className={cn(
        "font-mono text-[12.5px]",
        skipped && "text-muted-foreground",
        selected && !failed && "bg-accent shadow-[inset_3px_0_0_var(--primary)] hover:bg-accent",
        selected && failed && "bg-destructive/10 shadow-[inset_3px_0_0_var(--destructive)] hover:bg-destructive/10",
      )}
    >
      <TableCell className="py-1.5">
        <div className="grid min-w-0">
          <span className={cn("flex items-center gap-1 truncate font-medium", failed && "text-destructive", skipped && "italic")}>
            {failed && (
              <>
                <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="sr-only">Failed: </span>
              </>
            )}
            <span className="truncate">{step.taskId}</span>
            {step.element != null && <span className="text-muted-foreground"> [{step.element}]</span>}
          </span>
          {authored && <small className="truncate font-sans text-[11px] text-muted-foreground">{authored}</small>}
        </div>
      </TableCell>
      <TableCell className="truncate py-1.5 text-xs" title={label}>
        {effect?.resource && !effect.gate ? (
          <>
            <em className="not-italic text-muted-foreground">{effect.op}</em> {resourceLabel(effect.resource)}
          </>
        ) : (
          <span className="text-muted-foreground">{label}</span>
        )}
      </TableCell>
      <TableCell className="py-1.5">
        <div className="relative h-4">
          <LaneBackdrop axis={axis} />
          {skipped ? (
            <span className="absolute inset-y-0 left-0 flex items-center rounded border border-dashed border-border-strong bg-card px-1.5 text-[11px] italic leading-none">
              skipped
            </span>
          ) : (
            step.startUs != null &&
            step.durationUs != null && (
              <Bar
                axis={axis}
                from={step.startUs}
                to={step.startUs + step.durationUs}
                fill={stepFill(step)}
                title={`+${formatMicros(step.startUs)} · ${formatMicros(step.durationUs)}`}
              />
            )
          )}
          {!skipped && tickUs != null && p95Us != null && tickUs <= axis.totalUs && (
            <span
              className="absolute -inset-y-px w-0.5 rounded-sm bg-foreground opacity-55"
              style={{ left: `${axis.x(tickUs)}%` }}
              title={`p95 ${formatMicros(p95Us)}`}
              aria-hidden
            />
          )}
        </div>
      </TableCell>
      <TableCell className="py-1.5 text-right tabular-nums">{skipped ? "skipped" : formatMicros(step.durationUs)}</TableCell>
      <TableCell className={cn("py-1.5 text-right tabular-nums", vs.severe ? "font-medium text-destructive" : "text-muted-foreground")}>
        {vs.text}
      </TableCell>
    </TableRow>
  )
}

function AxisToggle({ mode, onChange, splitAvailable }: { mode: AxisMode; onChange: (m: AxisMode) => void; splitAvailable: boolean }) {
  const item = (m: AxisMode, label: string, title: string, disabled = false) => (
    <button
      type="button"
      aria-pressed={mode === m}
      disabled={disabled}
      onClick={() => onChange(m)}
      className={cn(
        "rounded px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50",
        mode === m ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
      )}
      title={title}
    >
      {label}
    </button>
  )
  return (
    <div role="group" aria-label="Time axis" className="inline-flex rounded-md border bg-muted p-0.5">
      {item(
        "split",
        "Split axis",
        splitAvailable ? "Spread the stretches around the longest step across most of the width" : "No single step dominates this run",
        !splitAvailable,
      )}
      {item("linear", "Linear", "Every microsecond the same width")}
    </div>
  )
}

export function TraceTimeline({ timeline, effects, costs, selected, onSelect, mode, loopBinding }: TraceTimelineProps) {
  const advice = useMemo(() => splitAdvice(timeline), [timeline])
  // The person's choice wins; until they make one the axis follows the data,
  // so a re-polled run whose long step has just landed switches to split.
  const [override, setOverride] = useState<AxisMode | null>(null)
  const axisMode: AxisMode = !advice.available ? "linear" : (override ?? (advice.preferred ? "split" : "linear"))
  const axis = useMemo(() => buildAxis(timeline, axisMode), [timeline, axisMode])
  const showGroupHeaders = timeline.groups.some((g) => g.kind !== "main")

  return (
    <div className="grid gap-4">
      <Headline timeline={timeline} costs={costs} mode={mode} />
      <Overview timeline={timeline} axis={axis} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {axis.mode === "split"
            ? "Split axis: the stretches around the longest step are drawn wide; the hatched break skips most of it."
            : "Linear axis: every bar at true scale."}{" "}
          The tick on a bar is that task's p95.
        </p>
        <AxisToggle mode={axis.mode} onChange={setOverride} splitAvailable={advice.available} />
      </div>

      <div className="rounded-lg border bg-card">
        <Table className="min-w-[760px] table-fixed" aria-label="Step timeline">
          <colgroup>
            <col className="w-[13rem]" />
            <col className="w-[8rem]" />
            <col />
            <col className="w-[5rem]" />
            <col className="w-[5.5rem]" />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Step</TableHead>
              <TableHead>Uses</TableHead>
              <TableHead className="normal-case tracking-normal">
                <div className="relative h-4 font-mono text-[11px] font-normal" data-testid="time-axis">
                  {axis.breaks.map((b, i) => (
                    <Hatch key={i} {...b} className="inset-y-0" />
                  ))}
                  {axis.ticks.map((t, i) => (
                    <span
                      key={`${t.us}-${i}`}
                      className={cn(
                        "absolute top-0 whitespace-nowrap",
                        t.align === "start" ? "" : t.align === "end" ? "-translate-x-full" : "-translate-x-1/2",
                      )}
                      style={{ left: `${t.pct}%` }}
                    >
                      {t.label}
                    </span>
                  ))}
                </div>
              </TableHead>
              <TableHead className="text-right">Took</TableHead>
              <TableHead className="text-right">vs p95</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {timeline.admissionUs > 0 && (
              <SpanRow
                axis={axis}
                title="admission"
                caption={admissionCaption(mode)}
                from={0}
                to={timeline.admissionUs}
                fill="bg-chart-5"
              />
            )}
            {timeline.groups.map((g) => (
              <GroupRows
                key={g.key}
                group={g}
                header={showGroupHeaders}
                caption={groupCaption(g, loopBinding)}
                axis={axis}
                effects={effects}
                costs={costs}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
            {timeline.settleUs > 0 && (
              <SpanRow
                axis={axis}
                title="settle"
                caption={settleCaption(mode)}
                from={timeline.engineEndUs}
                to={timeline.totalUs}
                fill="bg-border-strong"
              />
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function GroupRows({
  group,
  header,
  caption,
  axis,
  effects,
  costs,
  selected,
  onSelect,
}: {
  group: TimelineGroup
  header: boolean
  caption: string
  axis: TimeAxis
  effects: (StepEffect | null)[]
  costs: Map<string, TaskCost> | null
  selected: number | null
  onSelect: (index: number) => void
}) {
  return (
    <>
      {header && (
        <SpanRow
          axis={axis}
          title={group.label || "steps"}
          caption={caption}
          from={group.startUs}
          to={group.endUs}
          fill={GROUP_FILL[group.kind]}
        />
      )}
      {group.steps.map((s) => (
        <StepRow
          key={s.index}
          step={s}
          effect={effects[s.index] ?? null}
          cost={costs?.get(s.taskId)}
          axis={axis}
          selected={selected === s.index}
          onSelect={() => onSelect(s.index)}
        />
      ))}
    </>
  )
}
