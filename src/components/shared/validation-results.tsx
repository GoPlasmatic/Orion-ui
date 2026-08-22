import type { ValidationResponse } from "@/api/types"
import { Callout } from "@/components/ui/callout"

/**
 * Renders the `/validate` envelope: `{valid, errors[], warnings[]}`.
 *
 * The same shape comes back from `PATCH .../status?dry_run=true`, where gates
 * that a real transition would fail as a 4xx are reported as `errors` entries
 * in a 200 — so one pass collects every finding instead of stopping at the
 * first. Warnings never block: an `env://` reference unset on the validating
 * host is a warning so CI can check a bundle without holding production
 * secrets.
 */
export function ValidationResults({
  result,
  validLabel = "Valid.",
}: {
  result: ValidationResponse
  validLabel?: string
}) {
  if (result.valid && result.warnings.length === 0) {
    return (
      <Callout variant="success">{validLabel}</Callout>
    )
  }
  return (
    <div className="space-y-2">
      {result.errors.map((e, i) => (
        <Callout key={`e-${i}`} variant="destructive" icon={false} className="px-3.5 py-2">
          <span className="font-mono text-xs">{e.field}</span> — {e.message}
        </Callout>
      ))}
      {result.warnings.map((w, i) => (
        <Callout key={`w-${i}`} variant="warning" icon={false} className="px-3.5 py-2">
          <span className="font-mono text-xs">{w.field}</span> — {w.message}
        </Callout>
      ))}
    </div>
  )
}
