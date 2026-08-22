import { useTheme } from "@/lib/use-theme"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import {
  ConfigSection,
  NumberField,
  TextField,
  SelectField,
  ToggleField,
  StringListField,
  LogicField,
} from "@/components/shared/config-field"
import { Plus, Trash2 } from "lucide-react"
import type { ChannelAuthConfig, ChannelAuthMode, JwtKey } from "@/api/types"

const AUTH_MODES = [
  { value: "api_key", label: "API key" },
  { value: "hmac", label: "HMAC signature" },
  { value: "jwt", label: "JWT" },
]

/**
 * Most webhook providers are one preset. The explicit form is still available
 * underneath — a preset expands to these fields, and anything set explicitly
 * overrides its preset row.
 */
const HMAC_PRESETS = [
  { value: "zoom", label: "Zoom" },
  { value: "slack", label: "Slack" },
  { value: "stripe", label: "Stripe" },
  { value: "github", label: "GitHub" },
  { value: "shopify", label: "Shopify" },
  { value: "webex", label: "Webex" },
]

const HMAC_ALGORITHMS = [
  { value: "sha1", label: "SHA-1" },
  { value: "sha256", label: "SHA-256" },
  { value: "sha512", label: "SHA-512" },
]

const HMAC_ENCODINGS = [
  { value: "hex", label: "Hex" },
  { value: "base64", label: "Base64" },
  { value: "base64url", label: "Base64url" },
]

/** RFC 8725: `alg: none` and downgrades are unrepresentable — this is a closed set. */
const JWT_ALGORITHMS = [
  "HS256", "HS384", "HS512",
  "RS256", "RS384", "RS512",
  "PS256", "PS384", "PS512",
  "ES256", "ES384",
  "EdDSA",
]

/**
 * Channel authentication.
 *
 * Secrets (`keys`, `secret`/`secrets`, `jwt_keys[].key`) come back from the
 * server masked as `"******"`. Sending a mask back on update restores the
 * stored value, so this editor passes them through untouched — never blanking
 * or "cleaning" them on load, which would clobber the stored credential.
 */
export function ChannelAuthEditor({
  value,
  onChange,
}: {
  value: ChannelAuthConfig | undefined
  onChange: (next: ChannelAuthConfig | undefined) => void
}) {
  const { resolvedTheme } = useTheme()
  const auth = value ?? {}

  const set = (field: keyof ChannelAuthConfig, val: unknown) => {
    const next = { ...auth } as Record<string, unknown>
    if (val === undefined || val === "") delete next[field]
    else next[field] = val
    onChange(next as ChannelAuthConfig)
  }

  if (!value) {
    return (
      <ConfigSection
        title="Authentication"
        description="Without an auth block this channel is reachable by anyone who can reach the port. Kafka and channel_call are exempt by design."
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange({ mode: "api_key" })}
        >
          <Plus className="h-3.5 w-3.5" /> Add authentication
        </Button>
      </ConfigSection>
    )
  }

  return (
    <ConfigSection
      title="Authentication"
      description="Covers POST data/{channel} and /async identically — appending /async is not a bypass."
    >
      <SelectField
        label="Mode"
        value={auth.mode}
        onChange={(v) => {
          // Switching mode discards the previous mode's fields: they are not
          // interchangeable, and a stale field from another mode is refused at
          // create time rather than ignored.
          onChange({ mode: (v as ChannelAuthMode) ?? "api_key" })
        }}
        options={AUTH_MODES}
      />

      {auth.mode === "api_key" && (
        <>
          <StringListField
            label="Accepted keys"
            value={auth.keys}
            onChange={(v) => set("keys", v)}
            placeholder="env://ORDERS_API_KEY, env://ORDERS_API_KEY_PREVIOUS"
          />
          <p className="text-xs text-muted-foreground">
            Any match authorizes, so listing several enables rotation without a window of refusals.
            Each entry is a literal or an <code className="font-mono">env://VAR</code> reference.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <TextField
              label="Header"
              value={auth.header}
              onChange={(v) => set("header", v)}
              placeholder="Authorization"
            />
            <TextField
              label="Scheme prefix"
              value={auth.scheme}
              onChange={(v) => set("scheme", v)}
              placeholder="Bearer "
            />
          </div>
        </>
      )}

      {auth.mode === "hmac" && <HmacFields auth={auth} set={set} />}

      {auth.mode === "jwt" && (
        <JwtFields auth={auth} set={set} onChange={onChange} theme={resolvedTheme} />
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => onChange(undefined)}
      >
        <Trash2 className="h-3.5 w-3.5" /> Remove authentication
      </Button>
    </ConfigSection>
  )
}

type SetField = (field: keyof ChannelAuthConfig, val: unknown) => void

function HmacFields({ auth, set }: { auth: ChannelAuthConfig; set: SetField }) {
  const usingPreset = !!auth.preset

  return (
    <>
      <SelectField
        label="Provider preset"
        value={auth.preset}
        onChange={(v) => set("preset", v)}
        options={HMAC_PRESETS}
        includeEmpty="Custom (configure below)"
      />

      <TextField
        label="Secret"
        value={auth.secret}
        onChange={(v) => set("secret", v)}
        placeholder="env://STRIPE_WEBHOOK_SECRET"
      />
      <StringListField
        label="Additional secrets"
        value={auth.secrets}
        onChange={(v) => set("secrets", v)}
        placeholder="env://PARTNER_SECRET_PREVIOUS"
      />
      <p className="text-xs text-muted-foreground">
        Every secret is tried in constant time — that is what makes rotation zero-downtime.
      </p>

      {usingPreset ? (
        <p className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
          The preset supplies the signing template, header, algorithm, encoding and replay window.
          Clear it to configure them by hand.
        </p>
      ) : (
        <>
          <TextField
            label="Signing template"
            value={auth.message}
            onChange={(v) => set("message", v)}
            placeholder="v1:{header:x-request-timestamp}:{body}"
          />
          <p className="text-xs text-muted-foreground">
            Literals plus <code className="font-mono">{"{body}"}</code> (required),{" "}
            <code className="font-mono">{"{header:<name>}"}</code>, and{" "}
            <code className="font-mono">{"{header:<name>:<key>}"}</code> for packed{" "}
            <code className="font-mono">k=v</code> headers. Defaults to the raw body.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <TextField
              label="Signature header"
              value={auth.header}
              onChange={(v) => set("header", v)}
              placeholder="X-Signature"
            />
            <SelectField
              label="Algorithm"
              value={auth.algorithm}
              onChange={(v) => set("algorithm", v)}
              options={HMAC_ALGORITHMS}
              includeEmpty="SHA-256 (default)"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <TextField
              label="Signature prefix"
              value={auth.signature_prefix}
              onChange={(v) => set("signature_prefix", v)}
              placeholder="sha256="
            />
            <TextField
              label="Packed signature key"
              value={auth.signature_key}
              onChange={(v) => set("signature_key", v)}
              placeholder="v1"
            />
          </div>
          {auth.signature_prefix && auth.signature_key && (
            <Callout variant="destructive" icon={false} className="px-3 py-2 text-xs">
              Signature prefix and packed signature key are mutually exclusive — set one.
            </Callout>
          )}

          <SelectField
            label="Signature encoding"
            value={auth.encoding}
            onChange={(v) => set("encoding", v)}
            options={HMAC_ENCODINGS}
            includeEmpty="Auto-detect (hex, then base64)"
          />

          <div className="grid grid-cols-2 gap-4">
            <TextField
              label="Timestamp location"
              value={auth.timestamp}
              onChange={(v) => set("timestamp", v)}
              placeholder="x-request-timestamp"
            />
            <NumberField
              label="Replay window"
              unit="secs"
              value={auth.tolerance_secs}
              onChange={(v) => set("tolerance_secs", v)}
            />
          </div>
          {(auth.timestamp === undefined) !== (auth.tolerance_secs === undefined) && (
            <Callout variant="destructive" icon={false} className="px-3 py-2 text-xs">
              Timestamp location and replay window are a pair — either alone is refused at create
              time.
            </Callout>
          )}
        </>
      )}
    </>
  )
}

function JwtFields({
  auth,
  set,
  onChange,
  theme,
}: {
  auth: ChannelAuthConfig
  set: SetField
  onChange: (next: ChannelAuthConfig) => void
  theme: "light" | "dark"
}) {
  const keys = auth.jwt_keys ?? []
  const setKeys = (next: JwtKey[]) => onChange({ ...auth, jwt_keys: next.length ? next : undefined })

  const noVerifier = keys.length === 0 && !auth.jwks_url
  const noAlgorithms = !auth.algorithms || auth.algorithms.length === 0

  return (
    <>
      <div className="space-y-1">
        <StringListField
          label="Algorithm allowlist"
          value={auth.algorithms}
          onChange={(v) => set("algorithms", v)}
          placeholder={JWT_ALGORITHMS.slice(0, 3).join(", ")}
        />
        <p className="text-xs text-muted-foreground">
          Required and non-empty. Checked before anything else about a token, which is what makes{" "}
          <code className="font-mono">alg: none</code> and downgrade attacks unrepresentable. One
          of: {JWT_ALGORITHMS.join(", ")}.
        </p>
        {noAlgorithms && (
          <Callout variant="destructive" icon={false} className="px-3 py-2 text-xs">
            At least one algorithm is required.
          </Callout>
        )}
      </div>

      <TextField
        label="JWKS URL"
        value={auth.jwks_url}
        onChange={(v) => set("jwks_url", v)}
        placeholder="https://issuer.example.com/.well-known/jwks.json"
      />

      <div className="space-y-2">
        <p className="text-sm font-medium">Static keys</p>
        {keys.map((k, i) => (
          <div key={i} className="space-y-2 rounded-md border p-3">
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Algorithm"
                value={k.algorithm}
                onChange={(v) =>
                  setKeys(keys.map((x, j) => (j === i ? { ...x, algorithm: v ?? "" } : x)))
                }
                placeholder="HS512"
              />
              <TextField
                label="Key ID (kid)"
                value={k.kid}
                onChange={(v) => setKeys(keys.map((x, j) => (j === i ? { ...x, kid: v } : x)))}
              />
            </div>
            <TextField
              label="Key"
              value={k.key}
              onChange={(v) => setKeys(keys.map((x, j) => (j === i ? { ...x, key: v ?? "" } : x)))}
              placeholder="env://JWT_ACCESS_SECRET"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setKeys(keys.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove key
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setKeys([...keys, { algorithm: "HS256", key: "" }])}
        >
          <Plus className="h-3.5 w-3.5" /> Add static key
        </Button>
        {noVerifier && (
          <Callout variant="destructive" icon={false} className="px-3 py-2 text-xs">
            Provide at least one static key or a JWKS URL.
          </Callout>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <TextField
          label="Issuer (iss)"
          value={typeof auth.issuer === "string" ? auth.issuer : auth.issuer?.join(", ")}
          onChange={(v) => set("issuer", v)}
        />
        <TextField
          label="Audience (aud)"
          value={typeof auth.audience === "string" ? auth.audience : auth.audience?.join(", ")}
          onChange={(v) => set("audience", v)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <NumberField
          label="Clock skew allowance"
          unit="secs"
          min={0}
          max={300}
          value={auth.leeway_secs}
          onChange={(v) => set("leeway_secs", v)}
        />
        <NumberField
          label="Max token size"
          unit="bytes"
          value={auth.max_token_bytes}
          onChange={(v) => set("max_token_bytes", v)}
        />
      </div>

      <ToggleField
        label="Require expiry"
        description="RFC 8725: tokens must carry exp. Opting out should be deliberate."
        checked={auth.require_exp ?? true}
        onCheckedChange={(c) => set("require_exp", c)}
      />
      <ToggleField
        label="Token required"
        description="Off admits token-less requests with no metadata.auth key. A present-but-invalid token is still rejected."
        checked={auth.required ?? true}
        onCheckedChange={(c) => set("required", c)}
      />

      <StringListField
        label="Claims to metadata"
        value={auth.claims_to_metadata}
        onChange={(v) => set("claims_to_metadata", v)}
        placeholder="sub, roles, tenant_id"
      />
      <p className="text-xs text-muted-foreground">
        Which verified claims reach <code className="font-mono">metadata.auth.claims</code>, where
        validation logic and every task can read them. Empty passes all claims.
      </p>

      <div>
        <p className="mb-1 text-sm font-medium">Authorization logic</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Evaluated over <code className="font-mono">{'{"claims": …}'}</code> after verification. A
          falsy result is a <strong>403</strong>; an evaluation error fails closed.
        </p>
        <LogicField
          logic={auth.authorization_logic}
          onChange={(v) => set("authorization_logic", v)}
          addLabel="Add authorization logic"
          starter={{ in: ["admin", { var: "claims.roles" }] }}
          theme={theme}
        />
      </div>
    </>
  )
}
