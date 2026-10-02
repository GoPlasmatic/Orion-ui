import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { EffectTone } from "@/lib/workflow-lens"

// Reads are informational, a write a retry may repeat is a warning, the rest
// neutral. Semantic tokens: the chip carries a label.
const TONE_CLASS: Record<EffectTone, string> = {
  read: "border-info/30 bg-info/10 text-info",
  write: "border-warning/40 bg-warning/10 text-warning",
  neutral: "border-border-strong bg-muted text-foreground",
  gate: "border-transparent bg-muted text-muted-foreground",
}

/** One step's use of a resource in the dependency matrix — `read`, `write`, `incr`, … — or a filter's `halts the run`. */
export function OpChip({ tone, children, title }: { tone: EffectTone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium leading-none",
        TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
  )
}
