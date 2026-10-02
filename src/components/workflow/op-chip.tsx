import { cn } from "@/lib/utils"
import type { StepOp } from "@/lib/workflow-lens"

// Reads are informational, anything a retry would repeat is a warning, calls
// and the rest are neutral. Semantic tokens: the chip carries a label.
const OP_CLASS: Record<StepOp | "gate", string> = {
  read: "border-info/30 bg-info/10 text-info",
  infer: "border-info/30 bg-info/10 text-info",
  write: "border-warning/40 bg-warning/10 text-warning",
  incr: "border-warning/40 bg-warning/10 text-warning",
  publish: "border-warning/40 bg-warning/10 text-warning",
  send: "border-warning/40 bg-warning/10 text-warning",
  call: "border-border-strong bg-muted text-foreground",
  presign: "border-border-strong bg-muted text-foreground",
  gate: "border-transparent bg-muted text-muted-foreground",
}

/** One op in the dependency matrix: `read`, `write`, `call`, … or a filter's `halts the run`. */
export function OpChip({ op, children, title }: { op: StepOp | "gate"; children?: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium leading-none",
        OP_CLASS[op],
      )}
    >
      {children ?? op}
    </span>
  )
}
