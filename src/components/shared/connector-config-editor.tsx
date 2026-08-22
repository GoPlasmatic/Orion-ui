import { useRef, useState } from "react"
import { CONNECTOR_GATES } from "@/api/types"
import type { BooleanGate, ConnectorType, OperationGates } from "@/api/types"
import { ConfigEditorShell } from "@/components/shared/config-editor-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react"

type ConfigObject = Record<string, unknown>

interface ConnectorConfigEditorProps {
  connectorType: ConnectorType
  value: ConfigObject
  /** Server-masked values are passed through unchanged unless the user replaces them. */
  onChange: (next: ConfigObject) => void
}

// Keys whose values are treated as secrets in the UI (password input + secret affordance).
const SECRET_KEY_RE = /(pass|secret|token|key|credential)/i

/** A server-masked secret looks like "***", "********", "[MASKED]", "<redacted>", etc. */
function isMaskedSecret(v: unknown): v is string {
  if (typeof v !== "string") return false
  const t = v.trim()
  return /^\*{3,}$/.test(t) || /masked|redacted/i.test(t)
}

const isSecretKey = (key: string) => SECRET_KEY_RE.test(key)

/**
 * Per-operation gates, rendered as dedicated toggles instead of the generic
 * nested-JSON control. Which gates apply depends on the connector type
 * (CONNECTOR_GATES); `http` gates by method allow-list rather than by boolean,
 * so it carries none of these.
 */
const GATE_LABELS: Record<BooleanGate, { label: string; hint: string }> = {
  read: { label: "Read", hint: "data_query / db_read / mongo_read / mongo_aggregate, cache_read" },
  insert: { label: "Insert", hint: "data_write insert, mongo_write insert_one / insert_many" },
  update: { label: "Update", hint: "data_write update, mongo_write update_* / replace_one" },
  delete: { label: "Delete", hint: "data_write delete, mongo_write delete_*" },
  upsert: { label: "Upsert", hint: "data_write upsert, and update/replace with upsert: true" },
  raw_write: { label: "Raw write", hint: "db_write — raw SQL cannot be classified per operation" },
  write: { label: "Write", hint: "cache_write, plus channel stores backed by this connector" },
  publish: { label: "Publish", hint: "publish_kafka" },
  presign_get: { label: "Presign GET", hint: "storage_presign for reads" },
  presign_put: { label: "Presign PUT", hint: "storage_presign for writes — off makes it read-only" },
  head: { label: "Head", hint: "storage_head" },
}

/**
 * Structured editor for a connector's config. The shape varies per connector type
 * (http/db/kafka/cache/storage), so rather than hard-code field names that could
 * drift from the backend, this renders the actual config keys with type-appropriate
 * controls and an "Advanced (JSON)" escape hatch.
 *
 * Masked secrets returned by the server are shown in a "leave unchanged" state: the
 * original masked value is preserved in the payload (the server keeps the stored
 * secret) unless the operator explicitly chooses to replace it — so a save can never
 * accidentally clobber a stored secret.
 */
export function ConnectorConfigEditor({ value, onChange, connectorType }: ConnectorConfigEditorProps) {
  const [newKey, setNewKey] = useState("")
  const [newType, setNewType] = useState<"string" | "number" | "boolean">("string")

  const setKey = (key: string, val: unknown) => onChange({ ...value, [key]: val })
  const removeKey = (key: string) => {
    const next = { ...value }
    delete next[key]
    onChange(next)
  }

  const addField = () => {
    const key = newKey.trim()
    if (!key || key in value) return
    const initial = newType === "string" ? "" : newType === "number" ? 0 : false
    setKey(key, initial)
    setNewKey("")
  }

  const gateKeys = CONNECTOR_GATES[connectorType] ?? []
  const gated = gateKeys.length > 0
  // `operations` gets dedicated toggles on gated types; keep it out of the
  // generic rows. Same for the db-only aggregate write-stage opt-in, which is
  // the one default-DENY flag and needs to read as an opt-in, not a toggle.
  const showAggregateWriteStages = connectorType === "db"
  const entries = Object.entries(value).filter(
    ([k]) =>
      !(gated && k === "operations") &&
      !(showAggregateWriteStages && k === "aggregate_write_stages")
  )

  return (
    <ConfigEditorShell
      value={value}
      onChange={onChange}
      label={
        <>
          Configuration <span className="text-xs text-muted-foreground">({connectorType})</span>
        </>
      }
    >
      <div className="space-y-3">
          {gated && (
            <OperationGatesEditor
              gateKeys={gateKeys}
              gates={(value.operations ?? {}) as OperationGates}
              onChange={(next) => setKey("operations", next)}
            />
          )}

          {showAggregateWriteStages && (
            <AggregateWriteStagesField
              enabled={value.aggregate_write_stages === true}
              onChange={(next) =>
                next === undefined
                  ? removeKey("aggregate_write_stages")
                  : setKey("aggregate_write_stages", next)
              }
            />
          )}

          {entries.length === 0 && (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No fields yet. Add the connector's settings below, or paste them via Advanced (JSON).
            </p>
          )}

          {entries.map(([key, val]) => (
            <ConfigRow
              key={key}
              name={key}
              value={val}
              onChange={(v) => setKey(key, v)}
              onRemove={() => removeKey(key)}
            />
          ))}

          <div className="flex items-end gap-2 rounded-md border border-dashed p-3">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">Field name</Label>
              <Input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="host"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addField()
                  }
                }}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={newType} onChange={(e) => setNewType(e.target.value as typeof newType)}>
                <option value="string">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Toggle</option>
              </Select>
            </div>
            <Button type="button" variant="outline" onClick={addField} disabled={!newKey.trim()}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
      </div>
    </ConfigEditorShell>
  )
}

/** A single config field row; control type is inferred from the value (and key name for secrets). */
function ConfigRow({
  name,
  value,
  onChange,
  onRemove,
}: {
  name: string
  value: unknown
  onChange: (value: unknown) => void
  onRemove: () => void
}) {
  const label = (
    <div className="flex items-center gap-1.5">
      <span className="text-sm font-medium">{name}</span>
      {(isSecretKey(name) || isMaskedSecret(value)) && (
        <KeyRound className="h-3 w-3 text-muted-foreground" />
      )}
    </div>
  )

  let control: React.ReactNode
  if (isMaskedSecret(value)) {
    control = <SecretField masked={value} onReplace={onChange} />
  } else if (typeof value === "boolean") {
    control = <Switch checked={value} onCheckedChange={onChange} aria-label={name} />
  } else if (typeof value === "number") {
    control = (
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        aria-label={name}
      />
    )
  } else if (typeof value === "string") {
    control = (
      <Input
        type={isSecretKey(name) ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={name}
      />
    )
  } else {
    // Objects / arrays: edit as a compact JSON block.
    control = <NestedJsonField value={value} onChange={onChange} />
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        {label}
        {control}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}

/** Masked secret with an explicit replace flow; preserves the stored secret by default. */
function SecretField({ masked, onReplace }: { masked: string; onReplace: (value: unknown) => void }) {
  const original = useRef(masked)
  const [replacing, setReplacing] = useState(false)

  if (!replacing) {
    return (
      <div className="flex items-center gap-2">
        <Input value={"•".repeat(8)} disabled className="font-mono" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setReplacing(true)
            onReplace("")
          }}
        >
          Replace
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Input
        type="password"
        autoFocus
        placeholder="Enter new secret"
        onChange={(e) => onReplace(e.target.value)}
      />
      <button
        type="button"
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        onClick={() => {
          setReplacing(false)
          onReplace(original.current)
        }}
      >
        Keep existing secret (leave unchanged)
      </button>
    </div>
  )
}

/**
 * MongoDB `$out` / `$merge` in a `mongo_aggregate` pipeline. This is the one
 * deliberate default-DENY flag in the connector config — every other gate
 * defaults to allowed — so it reads as an opt-in rather than as a toggle that
 * happens to start off. Stages are re-validated after `{"var"}` folding, so
 * message data cannot smuggle one in.
 */
function AggregateWriteStagesField({
  enabled,
  onChange,
}: {
  enabled: boolean
  onChange: (next: boolean | undefined) => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-dashed px-3 py-2.5">
      <span className="space-y-0.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
          Allow aggregate write stages
        </span>
        <span className="block text-xs text-muted-foreground">
          Permits <code className="font-mono">$out</code> and{" "}
          <code className="font-mono">$merge</code> in mongo_aggregate pipelines. Denied by
          default — these stages write.
        </span>
      </span>
      {/* Written as an explicit true, cleared entirely when off, so the stored
          config never claims to grant something it does not. */}
      <Switch
        checked={enabled}
        onCheckedChange={(checked) => onChange(checked ? true : undefined)}
        aria-label="Allow aggregate write stages"
      />
    </label>
  )
}

/**
 * Unset gates default to allowed server-side; toggling one off writes an
 * explicit `false` into `config.operations` (e.g. delete: false makes the
 * connector delete-proof). Explicit booleans rather than key deletion, so the
 * stored config says what it means.
 */
function OperationGatesEditor({
  gateKeys,
  gates,
  onChange,
}: {
  gateKeys: BooleanGate[]
  gates: OperationGates
  onChange: (next: OperationGates) => void
}) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">Operation gates</span>
        <span className="text-xs text-muted-foreground">— all allowed unless switched off</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {gateKeys.map((key) => {
          const { label, hint } = GATE_LABELS[key]
          return (
          <label
            key={key}
            className="flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-2"
            title={hint}
          >
            <span className="text-sm">{label}</span>
            <Switch
              checked={gates[key] ?? true}
              onCheckedChange={(checked) => onChange({ ...gates, [key]: checked })}
              aria-label={`Allow ${label.toLowerCase()}`}
            />
          </label>
          )
        })}
      </div>
    </div>
  )
}

/** Edits an object/array value as JSON; only propagates on a valid parse. */
function NestedJsonField({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [err, setErr] = useState<string | null>(null)
  return (
    <div>
      <Textarea
        value={text}
        rows={4}
        className="font-mono text-xs"
        onChange={(e) => {
          setText(e.target.value)
          try {
            onChange(JSON.parse(e.target.value))
            setErr(null)
          } catch {
            setErr("Invalid JSON")
          }
        }}
      />
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  )
}
