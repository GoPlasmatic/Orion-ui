import { useMemo } from "react"
import { diffLines, stableJson, type DiffLine } from "@/lib/line-diff"
import { cn } from "@/lib/utils"

/** A coloured line diff, as `diffLines` produced it. */
export function JsonDiffLines({ lines, className }: { lines: DiffLine[]; className?: string }) {
  return (
    <pre className={cn("max-h-[40rem] overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed", className)}>
      {lines.map((d, i) => (
        <div
          key={i}
          className={cn(
            "px-1",
            d.type === "add" && "bg-success/10 text-success",
            d.type === "del" && "bg-destructive/10 text-destructive",
          )}
        >
          <span className="mr-2 inline-block w-3 select-none text-muted-foreground">
            {d.type === "add" ? "+" : d.type === "del" ? "-" : " "}
          </span>
          {d.text}
        </div>
      ))}
    </pre>
  )
}

/** Two JSON values, diffed line by line with keys in a stable order. */
export function JsonDiff({ before, after, className }: { before: unknown; after: unknown; className?: string }) {
  const lines = useMemo(() => diffLines(stableJson(before), stableJson(after)), [before, after])
  const changed = lines.filter((l) => l.type !== "same").length
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {changed === 0 ? "No differences" : `${changed} changed line${changed === 1 ? "" : "s"}`}
      </p>
      <JsonDiffLines lines={lines} className={className} />
    </div>
  )
}
