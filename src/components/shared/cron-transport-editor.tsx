import { useState } from "react"
import type { ConcurrencyPolicy, CronTransportConfig, MisfirePolicy } from "@/api/types"
import { CONCURRENCY_POLICIES, MISFIRE_POLICIES, lintCronExpression } from "@/lib/cron"
import { ConfigSection, NumberField, SelectField, TextField } from "@/components/shared/config-field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Callout } from "@/components/ui/callout"

/**
 * Structured editor for a cron channel's `transport_config` (Orion 1.6).
 *
 * The schedule is ordinary definition content — versioned with the channel,
 * covered by its content hash — so this edits the same object the JSON escape
 * hatch does. Unknown keys are refused server-side, which is why every field
 * here is spelled exactly as `channel/cron.rs` reads it.
 */
export function CronTransportEditor({
  value,
  onChange,
}: {
  value: CronTransportConfig
  onChange: (next: CronTransportConfig) => void
}) {
  const [payloadText, setPayloadText] = useState(() =>
    value.payload && Object.keys(value.payload).length > 0
      ? JSON.stringify(value.payload, null, 2)
      : ""
  )
  const [payloadError, setPayloadError] = useState<string | null>(null)

  const set = <K extends keyof CronTransportConfig>(key: K, v: CronTransportConfig[K] | undefined) => {
    const next = { ...value }
    if (v === undefined || v === "") delete next[key]
    else next[key] = v
    onChange(next)
  }

  const setConcurrency = (field: "policy" | "key", v: string | undefined) => {
    const sub: Record<string, unknown> = { ...(value.concurrency ?? {}) }
    if (v === undefined || v === "") delete sub[field]
    else sub[field] = v
    set("concurrency", Object.keys(sub).length ? (sub as CronTransportConfig["concurrency"]) : undefined)
  }

  const onPayloadChange = (text: string) => {
    setPayloadText(text)
    if (!text.trim()) {
      setPayloadError(null)
      set("payload", undefined)
      return
    }
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setPayloadError("The payload must be a JSON object")
        return
      }
      setPayloadError(null)
      set("payload", parsed as Record<string, unknown>)
    } catch {
      setPayloadError("Invalid JSON")
    }
  }

  const scheduleIssue = lintCronExpression(value.schedule ?? "")
  const misfire = value.misfire_policy ?? "latest"
  const misfireHint = MISFIRE_POLICIES.find((p) => p.value === misfire)?.hint
  const concurrency = value.concurrency?.policy ?? "allow"
  const concurrencyHint = CONCURRENCY_POLICIES.find((p) => p.value === concurrency)?.hint

  return (
    <ConfigSection
      title="Schedule"
      description="Started by a clock, not a caller. Calendar times are read in the zone below and stored as UTC instants."
    >
      <div>
        <Label required hint="second · minute · hour · day-of-month · month · day-of-week">
          Cron expression
        </Label>
        <Input
          value={value.schedule ?? ""}
          onChange={(e) => set("schedule", e.target.value)}
          placeholder="0 15 2 * * *"
          className="font-mono"
          aria-label="Cron expression"
        />
        {value.schedule && scheduleIssue ? (
          <p className="mt-1 text-xs text-destructive">{scheduleIssue}</p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Always six fields: <code className="font-mono">0 15 2 * * *</code> is 02:15 every day.
            The same text read as five fields would mean every minute of 02:00–02:59 on the 15th,
            which is why five- and seven-field forms are refused rather than guessed at.
          </p>
        )}
      </div>

      <TextField
        label="Time zone"
        value={value.timezone}
        onChange={(v) => set("timezone", v)}
        placeholder="UTC"
      />
      <p className="-mt-2 text-xs text-muted-foreground">
        An IANA name such as <code className="font-mono">Europe/London</code>; abbreviations are
        ambiguous and refused. A local time that does not exist on a spring-forward day does not
        fire; one that happens twice on a fall-back day fires twice.
      </p>

      <div>
        <Label hint="Delivered where a request body would be — read it with parse_json from `payload`.">
          Payload
        </Label>
        <Textarea
          value={payloadText}
          onChange={(e) => onPayloadChange(e.target.value)}
          rows={5}
          className="font-mono text-xs"
          placeholder='{ "window": "previous_day" }'
          aria-label="Cron payload"
        />
        {payloadError && <p className="mt-1 text-xs text-destructive">{payloadError}</p>}
        <p className="mt-1 text-xs text-muted-foreground">
          Definition content, recorded verbatim as every occurrence's trace input — so secrets and{" "}
          <code className="font-mono">env://</code>-style references are refused here. Read secrets
          inside the workflow instead.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label="Misfire policy"
          value={value.misfire_policy}
          onChange={(v) => set("misfire_policy", v as MisfirePolicy | undefined)}
          options={MISFIRE_POLICIES.map(({ value, label }) => ({ value, label }))}
          includeEmpty="Latest (default)"
        />
        {misfire === "catch_up" && (
          <NumberField
            label="Max catch-up"
            value={value.max_catch_up}
            onChange={(v) => set("max_catch_up", v)}
            min={1}
            max={1000}
            placeholder="required, 1–1000"
          />
        )}
      </div>
      {misfireHint && (
        <p className="-mt-2 text-xs text-muted-foreground">
          {misfireHint} A misfire is an occurrence whose time passed while no healthy scheduler
          could start it; ordinary polling delay is merely late and still runs.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label="Concurrency"
          value={value.concurrency?.policy}
          onChange={(v) => setConcurrency("policy", v as ConcurrencyPolicy | undefined)}
          options={CONCURRENCY_POLICIES.map(({ value, label }) => ({ value, label }))}
          includeEmpty="Allow (default)"
        />
        {concurrency === "forbid" && (
          <TextField
            label="Singleton key"
            value={value.concurrency?.key}
            onChange={(v) => setConcurrency("key", v)}
            placeholder="defaults to the channel id"
          />
        )}
      </div>
      {concurrencyHint && <p className="-mt-2 text-xs text-muted-foreground">{concurrencyHint}</p>}

      {concurrency === "forbid" && (
        <Callout variant="muted" className="text-xs">
          Non-overlap is not exactly-once: a worker that loses its lease cancels, but cannot prove a
          connector call it already made did not land. Work that must not be applied twice needs an
          idempotent destination — <code className="font-mono">metadata.trigger.scheduled_for</code>{" "}
          is the key two attempts at one occurrence agree on.
        </Callout>
      )}
    </ConfigSection>
  )
}
