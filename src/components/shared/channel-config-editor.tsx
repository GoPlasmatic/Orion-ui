import { DataLogicEditor } from "@goplasmatic/datalogic-ui"
import type { ChannelConfig } from "@/api/types"
import { useTheme } from "@/lib/use-theme"
import { ConfigEditorShell } from "@/components/shared/config-editor-shell"
import {
  ConfigSection,
  NumberField,
  TextField,
  SelectField,
  ToggleField,
  StringListField,
} from "@/components/shared/config-field"

interface ChannelConfigEditorProps {
  value: ChannelConfig
  onChange: (next: ChannelConfig) => void
}

const TRACING_MODES = [
  { value: "sync", label: "Sync" },
  { value: "async", label: "Async" },
  { value: "batch", label: "Batch" },
  { value: "off", label: "Off" },
]

/**
 * Structured editor for the well-known ChannelConfig shape, with an "Advanced
 * (JSON)" escape hatch. The ChannelConfig object held by the parent form is the
 * single source of truth; the JSON view edits the same object and syncs back on
 * every valid parse. Empty sub-objects are pruned so unset config keys stay unset.
 */
export function ChannelConfigEditor({ value, onChange }: ChannelConfigEditorProps) {
  const { resolvedTheme } = useTheme()

  const setTop = <K extends keyof ChannelConfig>(key: K, val: ChannelConfig[K] | undefined) => {
    const next = { ...value }
    if (val === undefined) delete next[key]
    else next[key] = val
    onChange(next)
  }

  const setSub = <K extends keyof ChannelConfig>(key: K, field: string, val: unknown) => {
    const current = (value[key] ?? {}) as Record<string, unknown>
    const sub: Record<string, unknown> = { ...current }
    if (val === undefined) delete sub[field]
    else sub[field] = val
    const next = { ...value }
    if (Object.keys(sub).length === 0) delete next[key]
    else next[key] = sub as ChannelConfig[K]
    onChange(next)
  }

  const rateLimit = value.rate_limit ?? {}
  const backpressure = value.backpressure ?? {}
  const cors = value.cors ?? {}
  const cache = value.cache ?? {}
  const dedup = value.deduplication ?? {}
  const tracing = value.tracing ?? {}

  return (
    <ConfigEditorShell value={value} onChange={onChange} label="Configuration">
      <div className="space-y-4">
        <ConfigSection title="Rate limiting" description="Throttle inbound requests.">
            <div className="grid grid-cols-2 gap-4">
              <NumberField
                label="Requests / second"
                unit="req/s"
                value={rateLimit.requests_per_second}
                onChange={(v) => setSub("rate_limit", "requests_per_second", v)}
              />
              <NumberField
                label="Burst"
                value={rateLimit.burst}
                onChange={(v) => setSub("rate_limit", "burst", v)}
              />
            </div>
          </ConfigSection>

          <ConfigSection title="Backpressure" description="Bound in-flight and queued work.">
            <div className="grid grid-cols-2 gap-4">
              <NumberField
                label="Max concurrent"
                value={backpressure.max_concurrent}
                onChange={(v) => setSub("backpressure", "max_concurrent", v)}
              />
              <NumberField
                label="Queue depth"
                value={backpressure.queue_depth}
                onChange={(v) => setSub("backpressure", "queue_depth", v)}
              />
            </div>
          </ConfigSection>

          <ConfigSection title="Timeout">
            <NumberField
              label="Request timeout"
              unit="ms"
              value={value.timeout_ms}
              onChange={(v) => setTop("timeout_ms", v)}
            />
          </ConfigSection>

          <ConfigSection title="CORS">
            <StringListField
              label="Allowed origins"
              value={cors.allowed_origins}
              onChange={(v) => setSub("cors", "allowed_origins", v)}
              placeholder="https://app.example.com, *"
            />
            <StringListField
              label="Allowed methods"
              value={cors.allowed_methods}
              onChange={(v) => setSub("cors", "allowed_methods", v)}
              placeholder="GET, POST"
            />
            <StringListField
              label="Allowed headers"
              value={cors.allowed_headers}
              onChange={(v) => setSub("cors", "allowed_headers", v)}
              placeholder="Content-Type, Authorization"
            />
          </ConfigSection>

          <ConfigSection title="Cache" description="Cache responses through a connector.">
            <ToggleField
              label="Enabled"
              checked={cache.enabled ?? false}
              onCheckedChange={(c) => setSub("cache", "enabled", c || undefined)}
            />
            <div className="grid grid-cols-2 gap-4">
              <NumberField
                label="TTL"
                unit="secs"
                value={cache.ttl_secs}
                onChange={(v) => setSub("cache", "ttl_secs", v)}
              />
              <TextField
                label="Connector"
                value={cache.connector}
                onChange={(v) => setSub("cache", "connector", v)}
                placeholder="idempotency-cache"
              />
            </div>
            <StringListField
              label="Cache key fields"
              value={cache.cache_key_fields}
              onChange={(v) => setSub("cache", "cache_key_fields", v)}
              placeholder="user_id, amount"
            />
          </ConfigSection>

          <ConfigSection title="Deduplication">
            <div className="grid grid-cols-2 gap-4">
              <TextField
                label="Header"
                value={dedup.header}
                onChange={(v) => setSub("deduplication", "header", v)}
                placeholder="Idempotency-Key"
              />
              <NumberField
                label="Window"
                unit="secs"
                value={dedup.window_secs}
                onChange={(v) => setSub("deduplication", "window_secs", v)}
              />
            </div>
            <TextField
              label="Connector"
              value={dedup.connector}
              onChange={(v) => setSub("deduplication", "connector", v)}
              placeholder="idempotency-cache"
            />
          </ConfigSection>

          <ConfigSection title="Tracing" description="Per-channel trace capture.">
            <SelectField
              label="Mode"
              value={tracing.mode}
              onChange={(v) => setSub("tracing", "mode", v)}
              options={TRACING_MODES}
              includeEmpty="Default"
            />
            <NumberField
              label="Sample rate"
              value={tracing.sample_rate}
              onChange={(v) => setSub("tracing", "sample_rate", v)}
              placeholder="0.0 – 1.0"
              min={0}
              max={1}
              step={0.05}
            />
            <ToggleField
              label="Errors only"
              description="Only persist traces for failed requests."
              checked={tracing.errors_only ?? false}
              onCheckedChange={(c) => setSub("tracing", "errors_only", c || undefined)}
            />
            <ToggleField
              label="Task details"
              description="Capture the per-task execution trace."
              checked={tracing.task_details ?? false}
              onCheckedChange={(c) => setSub("tracing", "task_details", c || undefined)}
            />
          </ConfigSection>

          <ConfigSection
            title="Validation logic"
            description="Read-only view of the channel's JSONLogic validation rule. Edit via the Advanced (JSON) tab."
          >
            {value.validation_logic !== undefined && value.validation_logic !== null ? (
              <div className="h-64 overflow-hidden rounded-md border">
                <DataLogicEditor
                  value={value.validation_logic}
                  editable={false}
                  theme={resolvedTheme}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No validation logic configured.</p>
            )}
          </ConfigSection>
      </div>
    </ConfigEditorShell>
  )
}
