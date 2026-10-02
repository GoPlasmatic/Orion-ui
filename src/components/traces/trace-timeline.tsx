import { useMemo, useState, type CSSProperties, type ReactNode } from "react"
import { X } from "lucide-react"
import type { TaskCost } from "@/hooks/use-ops-metrics"
import type { Timeline, TimelineGroup, TimelineStep } from "@/lib/trace-timeline"
import { formatMicros } from "@/lib/trace-timeline"
import { cn } from "@/lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { buildAxis, spanPct, splitAdvice, type AxisMode, type TimeAxis } from "./timeline-axis"
import { vsP95, type StepUses } from "./step-uses"

/**
 * Where a run's time went: the headline numbers, the whole run at true scale,
 * and one row per step on a shared lane — grouped the way the workflow is
 * (`loop.setup`, each iteration), each bar ticked at its task's p95.
 */

export interface TraceTimelineProps {
  timeline: Timeline
  /** One per step, by `TimelineStep.index`. */
  uses: StepUses[]
  /** Per-task baselines by task id; null while metrics are unavailable. */
  costs: Map<string, TaskCost> | null
  selected: number | null
  onSelect: (index: number) => void
  /** Names the settle stretch: a cron run also settles its occurrence. */
  mode?: string
  /** The loop's iteration binding, `it = temp_data.plan[k]`, when it is a plain `var`. */
  loopBinding?: { as: string; over: string } | null
}

const HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--border-strong) 0 2px, transparent 2px 6px)",
}

const GROUP_FILL: Record<TimelineGroup["kind"], string> = {
  setup: "bg-chart-1",
  iteration: "bg-chart-2",
  main: "bg-chart-1",
}

function stepFill(s: TimelineStep): string {
  if (s.outcome === "failed") return "bg-destructive"
  return s.phase === "body" ? "bg-chart-2" : "bg-chart-1"
}

function sharePct(part: number, total: number): string {
  if (total <= 0) return "—"
  const p = (part / total) * 100
  if (p > 0 && p < 1) return "<1%"
  return `${Math.round(p)}%`
}

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

function Tile({ label, value, detail, tone }: { label: string; value: string; detail?: ReactNode; tone?: "bad" }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5 rounded-lg border bg-card px-3 py-2.5">
      <dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={cn("font-display text-xl font-semibold tabular-nums", tone === "bad" && "text-destructive")}>
        {value}
      </dd>
      {detail && <dd className="break-words font-mono text-xs text-muted-foreground">{detail}</dd>}
    </div>
  )
}

function Headline({ timeline, costs, mode }: Pick<TraceTimelineProps, "timeline" | "costs" | "mode">) {
  const d = timeline.dominant
  const timed = timeline.steps.filter((s) => s.durationUs != null)
  const others = timed.filter((s) => s !== d)
  const othersUs = others.reduce((a, s) => a + (s.durationUs ?? 0), 0)
  let baseline: string | undefined
  if (costs && others.length) {
    const judged = others.filter((s) => (costs.get(s.taskId)?.p95Ms ?? 0) > 0)
    const over = judged.filter((s) => s.durationUs! > costs.get(s.taskId)!.p95Ms! * 1000)
    if (judged.length) baseline = over.length === 0 ? "each inside its p95" : `${over.length} over its p95`
  }
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <Tile label="Total" value={formatMicros(timeline.totalUs)} detail={`${timed.length} steps ran`} />
      {d && d.durationUs != null && (
        <Tile
          label="In one step"
          value={sharePct(d.durationUs, timeline.totalUs)}
          detail={`${d.taskId} · ${formatMicros(d.durationUs)}`}
          tone={d.outcome === "failed" ? "bad" : undefined}
        />
      )}
      <Tile
        label={`Other ${others.length} step${others.length === 1 ? "" : "s"}`}
        value={formatMicros(othersUs)}
        detail={baseline}
      />
      <Tile
        label="Engine between steps"
        value={formatMicros(timeline.gapUs)}
        detail={`${timeline.gaps} hand-off${timeline.gaps === 1 ? "" : "s"}`}
      />
      <Tile
        label="Settle"
        value={formatMicros(timeline.settleUs)}
        detail={mode === "cron" ? "trace + occurrence write" : "trace write"}
      />
    </dl>
  )
}

// ---------------------------------------------------------------------------
// Overview strip — always linear
// ---------------------------------------------------------------------------

function Overview({ timeline, axis }: { timeline: Timeline; axis: TimeAxis }) {
  const total = Math.max(1, timeline.totalUs)
  const pieces: { from: number; to: number; fill: string; label: string }[] = []
  if (timeline.admissionUs > 0) pieces.push({ from: 0, to: timeline.admissionUs, fill: "bg-chart-5", label: "admission" })
  for (const g of timeline.groups) {
    if (g.startUs == null || g.endUs == null) continue
    pieces.push({ from: g.startUs, to: g.endUs, fill: GROUP_FILL[g.kind], label: g.label || "steps" })
  }
  const f = timeline.failed
  if (f && f.startUs != null && f.durationUs != null) {
    pieces.push({ from: f.startUs, to: f.startUs + f.durationUs, fill: "bg-destructive", label: "failing step" })
  }
  if (timeline.settleUs > 0) pieces.push({ from: timeline.engineEndUs, to: total, fill: "bg-border-strong", label: "settle" })

  const iterations = timeline.groups.filter((g) => g.kind === "iteration")
  const legend: { fill: string; label: string }[] = []
  if (timeline.admissionUs > 0) legend.push({ fill: "bg-chart-5", label: "admission" })
  if (timeline.groups.some((g) => g.kind === "setup")) legend.push({ fill: "bg-chart-1", label: "loop.setup" })
  if (iterations.length) legend.push({ fill: "bg-chart-2", label: iterations.length === 1 ? iterations[0].label : `${iterations.length} iterations` })
  if (timeline.groups.some((g) => g.kind === "main")) legend.push({ fill: "bg-chart-1", label: "steps" })
  if (f) legend.push({ fill: "bg-destructive", label: "failing step" })
  if (timeline.settleUs > 0) legend.push({ fill: "bg-border-strong", label: "settle" })

  const zoomed = axis.mode === "split" ? axis.segments.filter((s) => s.zoomed) : []
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
            style={{ left: `${(p.from / total) * 100}%`, width: `${Math.max(((p.to - p.from) / total) * 100, 0.3)}%` }}
            title={`${p.label} · ${formatMicros(p.to - p.from)}`}
          />
        ))}
        {zoomed.map((z, i) => (
          <span
            key={`z${i}`}
            className="absolute inset-y-0 rounded-sm border-[1.5px] border-foreground"
            style={{ left: `${(z.fromUs / total) * 100}%`, width: `${Math.max(((z.toUs - z.fromUs) / total) * 100, 1.2)}%` }}
            title={`${formatMicros(z.toUs - z.fromUs)} drawn across ${Math.round(z.endPct - z.startPct)}% of the lane below`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
        {legend.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5">
            <i className={cn("inline-block h-2.5 w-2.5 rounded-sm", l.fill)} aria-hidden />
            {l.label}
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
        <span
          key={`b${i}`}
          aria-hidden
          className="absolute -inset-y-1.5"
          style={{ ...HATCH, left: `${b.startPct}%`, width: `${b.endPct - b.startPct}%` }}
        />
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
  const n = g.steps.length
  const count = `${n} step${n === 1 ? "" : "s"}`
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
  uses,
  cost,
  axis,
  selected,
  onSelect,
}: {
  step: TimelineStep
  uses: StepUses | undefined
  cost: TaskCost | undefined
  axis: TimeAxis
  selected: boolean
  onSelect: () => void
}) {
  const failed = step.outcome === "failed"
  const skipped = step.outcome === "skipped"
  const vs = vsP95(step.durationUs, cost?.p95Ms)
  const authored = step.task?.name && step.task.name !== step.taskId ? step.task.name : null
  const tickUs = step.startUs != null && cost?.p95Ms != null ? step.startUs + cost.p95Ms * 1000 : null
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
      <TableCell className="truncate py-1.5 text-xs" title={uses?.label}>
        {uses && uses.op && uses.resource ? (
          <>
            <em className="not-italic text-muted-foreground">{uses.op}</em> {uses.resource}
          </>
        ) : (
          <span className="text-muted-foreground">{uses?.label ?? "—"}</span>
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
          {!skipped && tickUs != null && tickUs <= axis.totalUs && (
            <span
              className="absolute -inset-y-px w-0.5 rounded-sm bg-foreground opacity-55"
              style={{ left: `${axis.x(tickUs)}%` }}
              title={`p95 ${formatMicros(cost!.p95Ms! * 1000)}`}
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
  const item = (m: AxisMode, label: string, disabled = false) => (
    <button
      type="button"
      aria-pressed={mode === m}
      disabled={disabled}
      onClick={() => onChange(m)}
      className={cn(
        "rounded px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50",
        mode === m ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
      )}
      title={
        m === "split"
          ? disabled
            ? "No single step dominates this run"
            : "Spread the stretches around the longest step across most of the width"
          : "Every microsecond the same width"
      }
    >
      {label}
    </button>
  )
  return (
    <div role="group" aria-label="Time axis" className="inline-flex rounded-md border bg-muted p-0.5">
      {item("split", "Split axis", !splitAvailable)}
      {item("linear", "Linear")}
    </div>
  )
}

export function TraceTimeline({ timeline, uses, costs, selected, onSelect, mode, loopBinding }: TraceTimelineProps) {
  const advice = useMemo(() => splitAdvice(timeline), [timeline])
  const [axisMode, setAxisMode] = useState<AxisMode>(advice.preferred ? "split" : "linear")
  const axis = useMemo(() => buildAxis(timeline, advice.available ? axisMode : "linear"), [timeline, axisMode, advice.available])
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
        <AxisToggle mode={axis.mode} onChange={setAxisMode} splitAvailable={advice.available} />
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
                    <span
                      key={i}
                      aria-hidden
                      className="absolute inset-y-0"
                      style={{ ...HATCH, left: `${b.startPct}%`, width: `${b.endPct - b.startPct}%` }}
                    />
                  ))}
                  {axis.ticks.map((t, i) => (
                    <span
                      key={`${t.us}-${i}`}
                      className={cn(
                        "absolute top-0 whitespace-nowrap",
                        i === 0 ? "" : i === axis.ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
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
                caption={mode === "cron" ? "claim, lease" : "before the first step"}
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
                uses={uses}
                costs={costs}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
            {timeline.settleUs > 0 && (
              <SpanRow
                axis={axis}
                title="settle"
                caption={mode === "cron" ? "trace + occurrence write" : "trace write"}
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
  uses,
  costs,
  selected,
  onSelect,
}: {
  group: TimelineGroup
  header: boolean
  caption: string
  axis: TimeAxis
  uses: StepUses[]
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
          uses={uses[s.index]}
          cost={costs?.get(s.taskId)}
          axis={axis}
          selected={selected === s.index}
          onSelect={() => onSelect(s.index)}
        />
      ))}
    </>
  )
}
