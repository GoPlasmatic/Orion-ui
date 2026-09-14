import type { ReactNode } from "react"
import { BUILTIN_KEY_HEADERS } from "@/api/types"
import type {
  ChannelConfig,
  ChannelProtocol,
  JsonLogicValue,
  RateLimitConfig,
} from "@/api/types"
import { useTheme } from "@/lib/use-theme"
import { CRON_REFUSED_CONFIG_KEYS } from "@/lib/cron"
import { ConfigEditorShell } from "@/components/shared/config-editor-shell"
import { Button } from "@/components/ui/button"
import { ChannelAuthEditor } from "@/components/shared/channel-auth-editor"
import { OAuth2LoginEditor } from "@/components/shared/oauth2-login-editor"
import { Callout } from "@/components/ui/callout"
import {
  ConfigSection,
  ConnectorField,
  NumberField,
  TextField,
  SelectField,
  ToggleField,
  StringListField,
  LogicField,
} from "@/components/shared/config-field"

interface ChannelConfigEditorProps {
  value: ChannelConfig
  onChange: (next: ChannelConfig) => void
  /**
   * The channel's protocol decides which guards exist. A `cron` channel has no
   * caller, so everything caller-shaped is refused at authoring time rather
   * than stored and ignored — those sections are hidden rather than offered.
   */
  protocol?: ChannelProtocol
}

const TRACING_MODES = [
  { value: "sync", label: "Sync" },
  { value: "async", label: "Async" },
  { value: "batch", label: "Batch" },
  { value: "off", label: "Off" },
]

const BODY_MODES = [
  { value: "auto", label: "Auto — detect the Orion envelope" },
  { value: "payload", label: "Payload — take the parsed body verbatim" },
]

const RESPONSE_MODES = [
  { value: "envelope", label: "Envelope — fixed {id, status, data, errors}" },
  { value: "shaped", label: "Shaped — workflow controls status, headers, body" },
]

const BACKEND_FAILURE_MODES = [
  { value: "allow", label: "Allow (fail open)" },
  { value: "deny", label: "Deny (503)" },
]

/**
 * Collect `headers.<name>` paths a JSONLogic expression reads that are neither
 * built in nor declared in `key_headers`. Matched case-insensitively, the way
 * the server matches them.
 */
function findUndeclaredKeyHeaders(
  logic: JsonLogicValue | undefined,
  declared: string[] | undefined
): string[] {
  if (logic === undefined || logic === null) return []
  const allowed = new Set<string>([
    ...BUILTIN_KEY_HEADERS,
    ...(declared ?? []).map((h) => h.toLowerCase()),
  ])
  const found = new Set<string>()

  const walk = (node: JsonLogicValue) => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node === null || typeof node !== "object") return
    for (const [op, arg] of Object.entries(node)) {
      if (op === "var") {
        // `var` takes a path string, or [path, default].
        const path = typeof arg === "string" ? arg : Array.isArray(arg) ? arg[0] : undefined
        if (typeof path === "string" && path.toLowerCase().startsWith("headers.")) {
          const name = path.slice("headers.".length).toLowerCase()
          if (name && !allowed.has(name)) found.add(name)
        }
      }
      walk(arg as JsonLogicValue)
    }
  }

  walk(logic)
  return [...found]
}

/**
 * Structured editor for the well-known ChannelConfig shape, with an "Advanced
 * (JSON)" escape hatch. The ChannelConfig object held by the parent form is the
 * single source of truth; the JSON view edits the same object and syncs back on
 * every valid parse. Empty sub-objects are pruned so unset config keys stay unset.
 */
/**
 * A key expression reading a header the key context does not carry. Since 1.1
 * that is refused with a 429 on every request rather than silently collapsing
 * every caller into one bucket — the same rule for both limiters, so one
 * sentence for both.
 */
function UndeclaredHeaders({ headers }: { headers: string[] }) {
  if (headers.length === 0) return null
  return (
    <Callout variant="destructive" icon={false} className="px-3 py-2 text-xs">
      Key logic reads {headers.map((h) => `"${h}"`).join(", ")}, which is not in the key context.
      Every request will be refused with 429 until the header is added to Key headers.
    </Callout>
  )
}

/**
 * The controls a `RateLimitConfig` takes. Both limiters are the same block —
 * `rate_limit` keyed on the address before authentication, and
 * `principal_rate_limit` keyed on the verified claims after it — so they are
 * one component, and anything the server adds to the shape is wired once.
 *
 * The key-logic caption differs substantively between the two (what the
 * context holds, whether a key is required), so it arrives as `children`
 * rather than being flattened into a prop string.
 */
function RateLimitFields({
  configKey,
  limit,
  starter,
  theme,
  setSub,
  alwaysShowHeaders,
  children,
}: {
  configKey: "rate_limit" | "principal_rate_limit"
  limit: RateLimitConfig
  starter: JsonLogicValue
  theme: "light" | "dark"
  setSub: (key: "rate_limit" | "principal_rate_limit", field: string, val: unknown) => void
  /** The principal limiter requires a key, so its headers list is always offered. */
  alwaysShowHeaders?: boolean
  children: ReactNode
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <NumberField
          label="Requests / second"
          unit="req/s"
          value={limit.requests_per_second}
          onChange={(v) => setSub(configKey, "requests_per_second", v)}
        />
        <NumberField
          label="Burst"
          value={limit.burst}
          onChange={(v) => setSub(configKey, "burst", v)}
        />
      </div>
      <SelectField
        label="On backend error"
        value={limit.on_backend_error}
        onChange={(v) => setSub(configKey, "on_backend_error", v)}
        options={BACKEND_FAILURE_MODES}
        includeEmpty="Allow (default)"
      />
      <div>
        {children}
        <LogicField
          logic={limit.key_logic}
          onChange={(v) => setSub(configKey, "key_logic", v)}
          addLabel="Add key logic"
          starter={starter}
          theme={theme}
        />
      </div>
      {(alwaysShowHeaders || limit.key_logic !== undefined) && (
        <StringListField
          label="Key headers"
          value={limit.key_headers}
          onChange={(v) => setSub(configKey, "key_headers", v)}
          placeholder="device-id, x-partner-id"
        />
      )}
    </>
  )
}

export function ChannelConfigEditor({ value, onChange, protocol }: ChannelConfigEditorProps) {
  const { resolvedTheme } = useTheme()
  const isCron = protocol === "cron"
  // Keys the server refuses on a cron channel but that are still set — a
  // protocol switch on a draft, or a JSON paste. Named so the author can act
  // before the 400 does.
  const cronLeftovers = isCron
    ? CRON_REFUSED_CONFIG_KEYS.filter((key) => value[key] !== undefined)
    : []

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
  const principalLimit = value.principal_rate_limit
  const backpressure = value.backpressure ?? {}
  const request = value.request ?? {}
  const response = value.response ?? {}
  const cache = value.cache ?? {}
  const dedup = value.deduplication ?? {}
  const tracing = value.tracing ?? {}

  // A key_logic that reads an undeclared header resolves to null, and since 1.1
  // that is refused with 429 on every request rather than silently collapsing
  // every caller into one bucket. Catch the typo here rather than in production.
  const undeclaredKeyHeaders = findUndeclaredKeyHeaders(
    rateLimit.key_logic,
    rateLimit.key_headers
  )
  // The principal limiter's context is the address limiter's plus `auth`, so a
  // header it reads has to be declared the same way.
  const undeclaredPrincipalHeaders = findUndeclaredKeyHeaders(
    principalLimit?.key_logic,
    principalLimit?.key_headers
  )
  // Both are refused at create, not at run time, so saying so here saves a
  // round trip — and the second one is the subtler mistake: a quota keyed on
  // nothing would be a per-address limit wearing a per-user label.
  const principalNeedsJwt = !!principalLimit && value.auth?.mode !== "jwt"
  const principalNeedsKeyLogic = !!principalLimit && principalLimit.key_logic == null

  if (isCron) {
    return (
      <ConfigEditorShell value={value} onChange={onChange} label="Configuration">
        <div className="space-y-4">
          <Callout variant="muted" className="text-xs">
            A cron channel is started by a clock, so the caller-shaped guards — authentication,
            origins, rate limiting, deduplication, caching, request and response shaping, OAuth2
            sign-in — are refused at save rather than stored and ignored. Timeout, backpressure,
            validation logic and tracing still apply.
          </Callout>
          {cronLeftovers.length > 0 && (
            <Callout variant="destructive" icon={false} className="px-3 py-2 text-xs">
              Still set and refused on a cron channel:{" "}
              {cronLeftovers.map((k) => (
                <code key={k} className="mr-1 font-mono">{k}</code>
              ))}
              — remove them in Advanced (JSON), or they will be dropped on Save.
            </Callout>
          )}

          <ConfigSection title="Timeout" description="Bounds one occurrence's run; a scheduled job may need far more than a request would.">
            <NumberField
              label="Run timeout"
              unit="ms"
              value={value.timeout_ms}
              onChange={(v) => setTop("timeout_ms", v)}
              placeholder="1800000"
            />
          </ConfigSection>

          <ConfigSection
            title="Backpressure"
            description="Bound concurrent occurrences on this node; excess waits in the ledger."
          >
            <NumberField
              label="Max concurrent per node"
              value={backpressure.max_concurrent_per_node}
              onChange={(v) => setSub("backpressure", "max_concurrent_per_node", v)}
            />
          </ConfigSection>

          <ConfigSection title="Tracing" description="Per-channel trace capture; a scheduled run follows the /async contract.">
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
              description="Only persist traces for failed runs."
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
            description="JSONLogic over {data, metadata} evaluated before the run; a falsy result fails the occurrence."
          >
            <LogicField
              logic={value.validation_logic}
              onChange={(v) => setTop("validation_logic", v)}
              addLabel="Add validation logic"
              starter={{ "!!": [{ var: "data" }] }}
              theme={resolvedTheme}
            />
          </ConfigSection>
        </div>
      </ConfigEditorShell>
    )
  }

  return (
    <ConfigEditorShell value={value} onChange={onChange} label="Configuration">
      <div className="space-y-4">
        <ChannelAuthEditor value={value.auth} onChange={(v) => setTop("auth", v)} />

        <OAuth2LoginEditor value={value.oauth2_login} onChange={(v) => setTop("oauth2_login", v)} />
        {value.oauth2_login && protocol && protocol !== "rest" && (
          <Callout variant="destructive" icon={false} className="px-3 py-2 text-xs">
            OAuth2 sign-in needs a REST channel with a route pattern: both legs are routes, and a
            channel reachable only by name has nowhere for the provider to send the browser back to.
          </Callout>
        )}
        {value.oauth2_login && value.cache && (
          <Callout variant="destructive" icon={false} className="px-3 py-2 text-xs">
            <code className="font-mono">cache</code> alongside OAuth2 sign-in is refused: a cached
            authorize 302 would replay one browser's state cookie to the next visitor.
          </Callout>
        )}

        <ConfigSection title="Rate limiting" description="Throttle inbound requests.">
            <RateLimitFields
              configKey="rate_limit"
              limit={rateLimit}
              starter={{ var: "client_ip" }}
              theme={resolvedTheme}
              setSub={setSub}
            >
              <p className="mb-1 text-sm font-medium">Key logic</p>
              <p className="mb-2 text-xs text-muted-foreground">
                JSONLogic over {"{client_ip, channel, headers}"} that derives the rate-limit
                bucket key — e.g. per API key or per tenant. Unset limits per caller identity.
              </p>
            </RateLimitFields>
            <UndeclaredHeaders headers={undeclaredKeyHeaders} />
          </ConfigSection>

          <ConfigSection
            title="Per-principal quota"
            description="A second limit, applied after authentication and keyed on the verified caller."
          >
            <Callout variant="muted" icon={false} className="px-3 py-2 text-xs">
              Rate limiting above runs <em>before</em> authentication — so it can only key on the
              address or a caller-supplied header, which bounds an honest client rather than
              metering a user. This block runs straight after authentication, on the verified
              claims. Both apply and keep separate buckets; the address limit stays the cheap
              outer guard. HTTP sync and async only — Kafka, channel calls and cron carry no
              credential to key on.
            </Callout>

            {!principalLimit ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setTop("principal_rate_limit", { key_logic: { var: "auth.sub" } })
                }
              >
                Add a per-principal quota
              </Button>
            ) : (
              <>
                <RateLimitFields
                  configKey="principal_rate_limit"
                  limit={principalLimit}
                  starter={{ var: "auth.sub" }}
                  theme={resolvedTheme}
                  setSub={setSub}
                  alwaysShowHeaders
                >
                  <p className="mb-1 text-sm font-medium">
                    Key logic <span className="text-destructive">*</span>
                  </p>
                  <p className="mb-2 text-xs text-muted-foreground">
                    JSONLogic over {"{client_ip, channel, headers, auth}"}, where{" "}
                    <code className="font-mono">auth</code> is the verified claims —{" "}
                    <code className="font-mono">{'{"var": "auth.sub"}'}</code> meters a user,{" "}
                    <code className="font-mono">
                      {'{"cat": [{"var": "auth.tenant"}, "|", {"var": "auth.sub"}]}'}
                    </code>{" "}
                    a tenant and a user together. Required: there is no fallback for a principal.
                  </p>
                </RateLimitFields>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setTop("principal_rate_limit", undefined)}
                >
                  Remove the quota
                </Button>
              </>
            )}

            {principalNeedsKeyLogic && (
              <Callout variant="destructive" icon={false} className="px-3 py-2 text-xs">
                Key logic is required here. The address limiter falls back to the caller identity
                when none is given; a principal has no such fallback, and inventing one would
                silently turn a per-user quota into a per-address one — so the server refuses the
                config at save.
              </Callout>
            )}
            {principalNeedsJwt && (
              <Callout variant="destructive" icon={false} className="px-3 py-2 text-xs">
                A per-principal quota needs <code className="font-mono">auth.mode = "jwt"</code>
                {value.auth?.mode ? (
                  <>
                    {" "}
                    — this channel authenticates with{" "}
                    <code className="font-mono">{value.auth.mode}</code>
                  </>
                ) : (
                  " — this channel has no authentication"
                )}
                . It is the only mode that exposes claims, so the key could never be computed and
                every request would be refused; the server refuses the config instead.
              </Callout>
            )}
            <UndeclaredHeaders headers={undeclaredPrincipalHeaders} />
          </ConfigSection>

          <ConfigSection
            title="Backpressure"
            description="Bound concurrent work on this node; excess is shed with 503."
          >
            <NumberField
              label="Max concurrent per node"
              value={backpressure.max_concurrent_per_node}
              onChange={(v) => setSub("backpressure", "max_concurrent_per_node", v)}
            />
          </ConfigSection>

          <ConfigSection
            title="Request body"
            description="How the HTTP request body becomes data and metadata."
          >
            <SelectField
              label="Body mode"
              value={request.body_mode}
              onChange={(v) => setSub("request", "body_mode", v)}
              options={BODY_MODES}
              includeEmpty="Auto (default)"
            />
            <StringListField
              label="Cookies to metadata"
              value={request.cookies_to_metadata}
              onChange={(v) => setSub("request", "cookies_to_metadata", v)}
              placeholder="session_id, locale"
            />
            <p className="text-xs text-muted-foreground">
              Named request cookies copied to <code className="font-mono">metadata.cookies.*</code>.
              Absent exposes nothing.
            </p>
          </ConfigSection>

          <ConfigSection
            title="Response shaping"
            description="Envelope, or a workflow-controlled status, headers and body."
          >
            <SelectField
              label="Mode"
              value={response.mode}
              onChange={(v) => setSub("response", "mode", v)}
              options={RESPONSE_MODES}
              includeEmpty="Envelope (default)"
            />
            <StringListField
              label="Allowed response headers"
              value={response.allowed_headers}
              onChange={(v) => setSub("response", "allowed_headers", v)}
              placeholder="location, x-request-id"
            />
            <p className="text-xs text-muted-foreground">
              <strong>Replaces</strong> the default allowlist rather than extending it, so a
              channel can narrow it as well as widen it. Case-insensitive.
            </p>
            <ToggleField
              label="Cookies"
              description="Let the workflow set cookies declaratively through data._orion.response.cookies — name, value, path, max_age, same_site, http_only, secure — validated rather than hand-assembled. A response that sets one is never cached."
              checked={response.cookies ?? false}
              onCheckedChange={(c) => setSub("response", "cookies", c || undefined)}
            />
          </ConfigSection>

          <ConfigSection title="Timeout">
            <NumberField
              label="Request timeout"
              unit="ms"
              value={value.timeout_ms}
              onChange={(v) => setTop("timeout_ms", v)}
            />
          </ConfigSection>

          <ConfigSection
            title="Origins"
            description="Server-side Origin header check. Allowed methods and headers are server-level CORS config, not per-channel."
          >
            <StringListField
              label="Origin allow list"
              value={value.origin_allow_list}
              onChange={(v) => setTop("origin_allow_list", v)}
              placeholder="https://app.example.com, *"
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
              <ConnectorField
                label="Connector"
                value={cache.connector}
                onChange={(v) => setSub("cache", "connector", v)}
                types={["cache"]}
                includeEmpty="Choose a cache connector"
              />
            </div>
            <StringListField
              label="Cache key fields"
              value={cache.cache_key_fields}
              onChange={(v) => setSub("cache", "cache_key_fields", v)}
              placeholder="user_id, amount"
            />
            <div>
              <p className="mb-1 text-sm font-medium">Key logic</p>
              <p className="mb-2 text-xs text-muted-foreground">
                The general form of the key fields: JSONLogic over {"{data, metadata}"} that
                replaces the payload-derived half of the key, so a key can depend on a header or
                the authenticated subject. Takes precedence over the fields above; one that does
                not compile quarantines the channel rather than falling back to the payload hash.
              </p>
              <LogicField
                logic={cache.key_logic}
                onChange={(v) => setSub("cache", "key_logic", v)}
                addLabel="Add key logic"
                starter={{ cat: [{ var: "metadata.auth.subject" }, "|", { var: "data.id" }] }}
                theme={resolvedTheme}
              />
            </div>
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
            <ConnectorField
              label="Connector"
              value={dedup.connector}
              onChange={(v) => setSub("deduplication", "connector", v)}
              types={["cache"]}
              includeEmpty="Choose a cache connector"
            />
            <SelectField
              label="On backend error"
              value={dedup.on_backend_error}
              onChange={(v) => setSub("deduplication", "on_backend_error", v)}
              options={BACKEND_FAILURE_MODES}
              includeEmpty="Allow (default)"
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
            description="JSONLogic over {data, metadata} evaluated at the channel boundary; a falsy result rejects the request with 400."
          >
            <LogicField
              logic={value.validation_logic}
              onChange={(v) => setTop("validation_logic", v)}
              addLabel="Add validation logic"
              starter={{ "!!": [{ var: "data" }] }}
              theme={resolvedTheme}
            />
          </ConfigSection>
      </div>
    </ConfigEditorShell>
  )
}
