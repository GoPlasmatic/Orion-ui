import { Badge } from "@/components/ui/badge"
import type { RetrySafety } from "@/api/types"

const LABEL: Record<string, string> = {
  pure: "pure",
  read: "read",
  idempotent_write: "idempotent write",
  unsafe_write: "unsafe to retry",
  depends_on: "depends on input",
}

const HINT: Record<string, string> = {
  pure: "No effect outside the message — free to retry.",
  read: "Observes state without changing it; a retry costs a round trip and may see a newer value.",
  idempotent_write: "Writes, but a second run lands the same end state.",
  unsafe_write: "Writes, and a second run duplicates the effect — the second email, the second record.",
  depends_on: "The task decides.",
}

/**
 * What a second run of a function does (Orion 1.6). Orion retries tasks in
 * more places than an author necessarily has in mind — the trace DLQ replays
 * a failed async delivery, a Kafka redelivery re-runs everything after an
 * uncommitted offset, `http_call` retries its own transport failures — and
 * this is what says which of those are safe over a given function.
 */
export function RetrySafetyBadge({ value }: { value: RetrySafety | undefined }) {
  if (!value) return null
  const kind = value.kind
  const input = "input" in value ? value.input : undefined
  const label =
    kind === "depends_on" && input ? `depends on ${input}` : (LABEL[kind] ?? kind)
  const hint =
    kind === "depends_on"
      ? `Whether a retry is safe depends on the task's own \`${input ?? "input"}\` — an upsert repeats safely, an insert does not.`
      : (HINT[kind] ?? "")
  const variant =
    kind === "unsafe_write" ? "warning" : kind === "idempotent_write" ? "info" : "outline"
  return (
    <Badge
      variant={variant}
      className={kind === "depends_on" ? "font-sans text-xs" : "text-xs"}
      title={`Retry safety: ${hint}`}
    >
      {kind === "depends_on" ? (
        <>
          retry: depends on <code className="font-mono">{input}</code>
        </>
      ) : (
        `retry: ${label}`
      )}
    </Badge>
  )
}
