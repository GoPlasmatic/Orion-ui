import { useRef, useState } from "react"
import type { ConnectorType } from "@/api/types"
import { ConfigEditorShell } from "@/components/shared/config-editor-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { KeyRound, Plus, Trash2 } from "lucide-react"

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

  const entries = Object.entries(value)

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
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Field name</label>
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
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Type</label>
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
      />
    )
  } else if (typeof value === "string") {
    control = (
      <Input
        type={isSecretKey(name) ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
