import { Check, CircleStop, Layers, OctagonX, X } from "lucide-react"
import type { WorkflowLoop } from "@/api/types"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { OpChip } from "@/components/workflow/op-chip"
import { formatMicros } from "@/lib/trace-timeline"
import { cn } from "@/lib/utils"
import {
  formatMs,
  formatPct,
  resourceKey,
  sectionLabel,
  type CostView,
  type LensRow,
  type LensSection,
  type LensTaskRow,
  type ResourceColumn,
  type RunCell,
} from "@/lib/workflow-lens"

type TableLens = "deps" | "cost" | "run"

interface LensTableProps {
  lens: TableLens
  sections: LensSection[]
  loop: WorkflowLoop | undefined
  /** Dependencies: one column per resource. */
  columns?: ResourceColumn[]
  /** Cost: the measured view; null hides the figures (metrics off, no runs). */
  cost?: CostView | null
  /** Last run: the trace laid over the rows. */
  overlay?: ReadonlyMap<string, RunCell> | null
  caption: string
}

const HEAD = "whitespace-nowrap"
const NUM = "text-right font-mono text-xs tabular-nums"

/**
 * The step rows every non-Structure lens shares: the workflow's steps in run
 * order, grouped into `loop.setup` and the loop body, task groups nested.
 * Each lens adds its own columns to the same rows.
 */
export function LensTable({ lens, sections, loop, columns = [], cost, overlay, caption }: LensTableProps) {
  const extra = lens === "deps" ? columns.length + 1 : lens === "cost" ? 4 : 3
  const span = 2 + extra

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table className="min-w-[680px]" aria-label={caption}>
        <TableHeader>
          <TableRow>
            <TableHead className={HEAD}>Step</TableHead>
            <TableHead className={HEAD}>Function</TableHead>
            {lens === "deps" &&
              columns.map((c) => (
                <TableHead key={c.key} className={cn(HEAD, "font-mono text-xs")} title={`${c.ref.kind} ${c.ref.name}`}>
                  {c.ref.dynamic ? `${c.ref.kind} (computed)` : c.ref.name}
                </TableHead>
              ))}
            {lens === "deps" && <TableHead className={HEAD}>Writes</TableHead>}
            {lens === "cost" && (
              <>
                <TableHead className={cn(HEAD, "min-w-40")}>Share of a run</TableHead>
                <TableHead className={cn(HEAD, "text-right")}>mean</TableHead>
                <TableHead className={cn(HEAD, "text-right")}>p95</TableHead>
                <TableHead className={cn(HEAD, "text-right")}>runs</TableHead>
              </>
            )}
            {lens === "run" && (
              <>
                <TableHead className={HEAD}>This run</TableHead>
                <TableHead className={cn(HEAD, "text-right")}>took</TableHead>
                <TableHead className={HEAD}>Wrote</TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sections.map((section) => (
            <SectionRows
              key={section.phase}
              section={section}
              loop={loop}
              span={span}
              lens={lens}
              columns={columns}
              cost={cost}
              overlay={overlay}
            />
          ))}
          {lens === "cost" && cost && cost.overheadMs != null && (
            <TableRow>
              <TableCell>
                <span className="font-mono text-xs font-medium">engine overhead</span>
                <span className="block text-xs text-muted-foreground">conditions, loop bookkeeping, audit</span>
              </TableCell>
              <TableCell />
              <TableCell>
                <ShareBar pct={cost.overheadPct} tone="overhead" />
              </TableCell>
              <TableCell className={NUM}>{formatMs(cost.overheadMs)}</TableCell>
              <TableCell />
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function SectionRows({
  section,
  loop,
  span,
  lens,
  columns,
  cost,
  overlay,
}: {
  section: LensSection
  loop: WorkflowLoop | undefined
  span: number
  lens: TableLens
  columns: ResourceColumn[]
  cost?: CostView | null
  overlay?: ReadonlyMap<string, RunCell> | null
}) {
  const label = sectionLabel(section.phase, loop)
  let counts = ""
  if (lens === "cost" && cost && cost.runs > 0) {
    if (section.phase === "body" && cost.iterations != null) {
      counts = ` · ${cost.iterations.toLocaleString("en")} iterations (${(cost.iterations / cost.runs).toFixed(2)} per run)`
    } else if (section.phase !== "main") {
      counts = ` · ${cost.runs.toLocaleString("en")} runs since boot`
    }
  }
  return (
    <>
      {label.title && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={span} className="bg-muted/50 py-1.5 font-mono text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{label.title}</span> · {label.detail}
            {counts}
          </TableCell>
        </TableRow>
      )}
      {section.rows.map((row) =>
        row.kind === "group" ? (
          <GroupRow key={`g:${row.id}`} row={row} span={span} />
        ) : (
          <TaskRow key={row.id} row={row} lens={lens} columns={columns} cost={cost} overlay={overlay} />
        ),
      )}
    </>
  )
}

const indent = (depth: number) => ({ paddingLeft: `${12 + depth * 18}px` })

function GroupRow({ row, span }: { row: Extract<LensRow, { kind: "group" }>; span: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={span} style={indent(row.depth)} className="py-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Layers className="h-3.5 w-3.5" aria-hidden />
          <span className="font-mono font-medium text-foreground">{row.id}</span>
          {row.name && <span>{row.name}</span>}
          <span>· group{row.conditional ? ", gated by one condition" : ""}</span>
          {row.terminal && <Marker kind="terminal" />}
        </span>
      </TableCell>
    </TableRow>
  )
}

function Marker({ kind }: { kind: "terminal" | "halt" | "if" }) {
  if (kind === "terminal")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Ends the workflow once it has run">
        <CircleStop className="h-3 w-3" aria-hidden /> terminal
      </span>
    )
  if (kind === "halt")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Ends the workflow when it fails (halt_on: failure)">
        <OctagonX className="h-3 w-3" aria-hidden /> halt on failure
      </span>
    )
  return (
    <span className="rounded border px-1 font-mono text-[10px] text-muted-foreground" title="Runs only when its condition holds">
      if
    </span>
  )
}

function TaskRow({
  row,
  lens,
  columns,
  cost,
  overlay,
}: {
  row: LensTaskRow
  lens: TableLens
  columns: ResourceColumn[]
  cost?: CostView | null
  overlay?: ReadonlyMap<string, RunCell> | null
}) {
  const cell = cost?.cells.get(row.id)
  const run = overlay?.get(row.id)
  const dominant = lens === "cost" && cost?.dominant === row.id
  const failed = lens === "run" && run?.status === "failed"
  return (
    <TableRow
      className={cn(dominant && "bg-warning/5", failed && "bg-destructive/5")}
      data-dominant={dominant || undefined}
    >
      <TableCell style={indent(row.depth)} className="max-w-72">
        <span className="font-mono text-xs font-medium">
          {failed && <X className="mr-1 inline h-3 w-3 text-destructive" aria-hidden />}
          {row.id}
        </span>
        {row.name && <span className="block truncate text-xs text-muted-foreground" title={row.name}>{row.name}</span>}
      </TableCell>
      <TableCell>
        <span className="flex flex-wrap items-center gap-1.5">
          {row.gate ? (
            <OpChip op="gate" title="A filter: when its condition does not hold, the run stops here">
              filter · halts the run
            </OpChip>
          ) : (
            <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{row.fn}</span>
          )}
          {row.conditional && <Marker kind="if" />}
          {row.terminal && <Marker kind="terminal" />}
          {row.haltOnFailure && <Marker kind="halt" />}
        </span>
      </TableCell>

      {lens === "deps" && (
        <>
          {columns.map((c) => (
            <TableCell key={c.key}>
              {row.resource && resourceKey(row.resource) === c.key ? <OpChip op={row.op ?? "call"} /> : null}
            </TableCell>
          ))}
          <TableCell className="font-mono text-xs text-muted-foreground">{row.writes.join(", ") || "—"}</TableCell>
        </>
      )}

      {lens === "cost" && (
        <>
          <TableCell>{cell?.sharePct != null ? <ShareBar pct={cell.sharePct} tone={dominant ? "hot" : "normal"} /> : <Dash />}</TableCell>
          <TableCell className={NUM}>{cell?.meanMs != null ? formatMs(cell.meanMs) : <Dash />}</TableCell>
          <TableCell className={NUM}>{cell?.p95Ms != null ? formatMs(cell.p95Ms) : <Dash />}</TableCell>
          <TableCell className={NUM}>{cell && cell.runs > 0 ? cell.runs.toLocaleString("en") : <Dash />}</TableCell>
        </>
      )}

      {lens === "run" && (
        <>
          <TableCell>{run ? <RunStatusLabel status={run.status} /> : <Dash />}</TableCell>
          <TableCell className={NUM}>
            {run?.durationUs != null ? formatMicros(run.durationUs) : <Dash />}
            {run && run.executions > 1 && <span className="text-muted-foreground"> · {run.executions}×</span>}
          </TableCell>
          <TableCell className="font-mono text-xs text-muted-foreground">{run?.changes.join(", ") || "—"}</TableCell>
        </>
      )}
    </TableRow>
  )
}

const Dash = () => <span className="text-muted-foreground">—</span>

function RunStatusLabel({ status }: { status: RunCell["status"] }) {
  switch (status) {
    case "ok":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-xs font-medium text-success">
          <Check className="h-3.5 w-3.5" aria-hidden /> ran
        </span>
      )
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-xs font-medium text-destructive">
          <X className="h-3.5 w-3.5" aria-hidden /> failed
        </span>
      )
    case "skipped":
      return <span className="font-mono text-xs text-muted-foreground" title="Its condition did not hold">skipped</span>
    default:
      return <span className="font-mono text-xs italic text-muted-foreground">not reached</span>
  }
}

function ShareBar({ pct, tone }: { pct: number | null; tone: "normal" | "hot" | "overhead" }) {
  const width = Math.min(100, Math.max(pct ?? 0, 0.5))
  return (
    <div className="grid grid-cols-[minmax(80px,1fr)_3.25rem] items-center gap-2">
      <div className="relative h-2.5 overflow-hidden rounded-sm bg-muted" aria-hidden>
        <i
          className={cn(
            "absolute inset-y-0 left-0 rounded-sm",
            tone === "hot" ? "bg-chart-3" : tone === "overhead" ? "bg-chart-5" : "bg-chart-1",
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="text-right font-mono text-xs tabular-nums">{formatPct(pct)}</span>
    </div>
  )
}
