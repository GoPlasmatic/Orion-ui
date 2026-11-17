import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import type { ConnectionProbe } from "@/api/types"

const EFFECT_TEXT: Record<string, string> = {
  not_started: "nothing was sent to the backend",
  completed: "the check reached the backend and finished",
  unknown: "whether the check reached the backend is unknown",
}

/** A probe as a list cell: healthy with its latency, the failure's class, or nothing yet. */
export function ProbeBadge({ probe }: { probe: ConnectionProbe | null | undefined }) {
  if (!probe) return <span className="text-xs text-muted-foreground">—</span>
  return probe.healthy ? (
    <Badge variant="outline" className="border-success/40 text-success" title={probe.details.probe}>
      healthy · {probe.latency_ms} ms
    </Badge>
  ) : (
    <Badge variant="outline" className="border-destructive/40 text-destructive" title={probe.details.error ?? undefined}>
      {probe.details.error_class ?? "unhealthy"}
    </Badge>
  )
}

/**
 * One probe in full: the check the driver ran, how long it took, and — when
 * it failed — the class, the reason (never a resolved secret) and how far the
 * check got. A failed probe is a finding, not an error: the request worked.
 */
export function ProbeResult({ probe }: { probe: ConnectionProbe }) {
  const d = probe.details
  return (
    <Callout variant={probe.healthy ? "success" : "destructive"}>
      <p className="font-medium">
        r{probe.revision} {probe.healthy ? "is healthy" : "is not healthy"} from this node · {probe.latency_ms} ms
      </p>
      <p className="mt-1 text-xs">
        Check: <span className="font-mono">{d.probe}</span> · driver <span className="font-mono">{probe.driver_id}</span>
      </p>
      {!probe.healthy && (
        <p className="mt-1 text-xs">
          {d.error_class && <span className="font-mono">{d.error_class}</span>}
          {d.error_class && d.error ? " — " : ""}
          {d.error}
        </p>
      )}
      {d.effect_status && (
        <p className="mt-1 text-xs opacity-80">{EFFECT_TEXT[d.effect_status] ?? d.effect_status}.</p>
      )}
    </Callout>
  )
}
