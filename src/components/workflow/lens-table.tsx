import type { ReactNode } from "react"
import { Check, CircleStop, Layers, OctagonX, X } from "lucide-react"
import type { Workflow } from "@/api/types"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { OpChip } from "@/components/workflow/op-chip"
import type { StepPhase } from "@/lib/trace-timeline"
import { formatPct } from "@/lib/traffic-encoding"
import { cn } from "@/lib/utils"
import { sectionLabel, type LensRow, type LensSection, type LensTaskRow, type RunCell } from "@/lib/workflow-lens"

/** One lens column: its header and what it shows for a step. */
export interface LensColumn {
  key: string
  head: ReactNode
  /** Right-aligned, monospaced figures. */
  numeric?: boolean
  headClassName?: string
  cell: (row: LensTaskRow) => ReactNode
}

/** A row below the steps that is not a step — the engine's own overhead. */
export interface LensFooterRow {
  key: string
  label: string
  detail?: string
  cells: Partial<Record<string, ReactNode>>
}

interface LensTableProps {
  workflow: Pick<Workflow, "loop">
  sections: LensSection[]
  /** The lens's own columns, after Step and Function. */
  columns: LensColumn[]
  caption: string
  /** Extra words on a section heading — run and iteration counts. */
  sectionNote?: (phase: StepPhase) => string
  /** Emphasis for a row: the dominant step, the failed one. */
  rowTone?: (row: LensTaskRow) => "hot" | "bad" | undefined
  footer?: LensFooterRow[]
}

const NUM = "text-right font-mono text-xs tabular-nums"

/**
 * The step rows every non-Structure lens shares: the workflow's steps in run
 * order, grouped into `loop.setup` and the loop body, task groups nested. A
 * lens adds its columns as a spec, so the header, the cells and the spans
 * cannot drift apart.
 */
export function LensTable({ workflow, sections, columns, caption, sectionNote, rowTone, footer = [] }: LensTableProps) {
  const span = 2 + columns.length
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table className="min-w-[680px]" aria-label={caption}>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">Step</TableHead>
            <TableHead className="whitespace-nowrap">Function</TableHead>
            {columns.map((c) => (
              <TableHead key={c.key} className={cn("whitespace-nowrap", c.numeric && "text-right", c.headClassName)}>
                {c.head}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sections.map((section) => {
            const label = sectionLabel(section.phase, workflow)
            return [
              label.title ? (
                <TableRow key={`s:${section.phase}`} className="hover:bg-transparent">
                  <TableCell colSpan={span} className="bg-muted/50 py-1.5 font-mono text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{label.title}</span> · {label.detail}
                    {sectionNote?.(section.phase)}
                  </TableCell>
                </TableRow>
              ) : null,
              ...section.rows.map((row) =>
                row.kind === "group" ? (
                  <GroupRow key={`g:${row.id}`} row={row} span={span} />
                ) : (
                  <TaskRow key={row.id} row={row} columns={columns} tone={rowTone?.(row)} />
                ),
              ),
            ]
          })}
          {footer.map((f) => (
            <TableRow key={f.key}>
              <TableCell>
                <span className="font-mono text-xs font-medium">{f.label}</span>
                {f.detail && <span className="block text-xs text-muted-foreground">{f.detail}</span>}
              </TableCell>
              <TableCell />
              {columns.map((c) => (
                <TableCell key={c.key} className={cn(c.numeric && NUM)}>
                  {f.cells[c.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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

function TaskRow({ row, columns, tone }: { row: LensTaskRow; columns: LensColumn[]; tone?: "hot" | "bad" }) {
  return (
    <TableRow className={cn(tone === "hot" && "bg-warning/5", tone === "bad" && "bg-destructive/5")} data-tone={tone}>
      <TableCell style={indent(row.depth)} className="max-w-72">
        <span className="font-mono text-xs font-medium">
          {tone === "bad" && <X className="mr-1 inline h-3 w-3 text-destructive" aria-hidden />}
          {row.id}
        </span>
        {row.name && (
          <span className="block truncate text-xs text-muted-foreground" title={row.name}>
            {row.name}
          </span>
        )}
      </TableCell>
      <TableCell>
        <span className="flex flex-wrap items-center gap-1.5">
          {row.effect.gate ? (
            <OpChip tone="gate" title="A filter: when its condition does not hold, the run stops here">
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
      {columns.map((c) => (
        <TableCell key={c.key} className={cn(c.numeric && NUM)}>
          {c.cell(row)}
        </TableCell>
      ))}
    </TableRow>
  )
}

export function Dash() {
  return <span className="text-muted-foreground">—</span>
}

export function RunStatusLabel({ status }: { status: RunCell["status"] }) {
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
      return (
        <span className="font-mono text-xs text-muted-foreground" title="Its condition did not hold">
          skipped
        </span>
      )
    default:
      return <span className="font-mono text-xs italic text-muted-foreground">not reached</span>
  }
}

export function ShareBar({ pct, tone }: { pct: number | null; tone: "normal" | "hot" | "overhead" }) {
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
