import { cn } from "@/lib/utils"
import { insightText, type Insight } from "@/lib/workflow-lens"

const TONE: Record<Insight["tone"], string> = {
  info: "border-primary",
  warn: "border-warning",
  bad: "border-destructive",
}

/** The two or three sentences under a lens, computed from its rows. */
export function LensInsights({ insights, label }: { insights: Insight[]; label: string }) {
  if (insights.length === 0) return null
  return (
    <div className="grid gap-2" aria-label={label} role="list">
      {insights.map((ins) => (
        <p
          key={insightText(ins)}
          role="listitem"
          className={cn("max-w-[90ch] border-l-2 pl-3 text-sm leading-relaxed", TONE[ins.tone])}
        >
          {ins.segs.map((s, i) =>
            typeof s === "string" ? (
              <span key={i}>{s}</span>
            ) : "code" in s ? (
              <code key={i} className="rounded bg-muted px-1 font-mono text-[0.85em]">
                {s.code}
              </code>
            ) : (
              <strong key={i} className="font-semibold">
                {s.b}
              </strong>
            ),
          )}
        </p>
      ))}
    </div>
  )
}
