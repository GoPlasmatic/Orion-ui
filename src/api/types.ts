
export type SortOrder = "asc" | "desc"

export type JsonLogicValue =
  | string
  | number
  | boolean
  | null
  | JsonLogicValue[]
  | { [key: string]: JsonLogicValue }

export interface DataResponse<T> {
  data: T
}

/**
 * One page of a 2.0 list (`Page_*` in the spec): `{ data, limit, next_cursor?,
 * total? }`. Paging is **cursor-only** and newest first — `offset`, `sort_by`
 * and `sort_order` are gone. Pass `next_cursor` back as `?cursor=` for the
 * next page; absent means this was the last. `total` is served only with
 * `?include_total=true` (a count is a full scan), so an absent total is
 * "unknown", never zero.
 */
export interface Page<T> {
  data: T[]
  limit?: number | null
  next_cursor?: string | null
  total?: number | null
}

/** What a page request may send. */
export interface PageParams {
  limit?: number
  cursor?: string
  include_total?: boolean
}

/**
 * The connector failure behind a data-plane error (2.0): its normalised class
 * and the provider's own documented code. The provider's message is never
 * sent — it can name hosts and values.
 */
export interface ConnectorErrorDetail {
  /** `invalid_input` | `unauthorized` | `forbidden` | `not_found` | `conflict` | `rate_limited` | `unavailable` | `deadline` | `cancelled` | `provider_failure` | `contract_violation`, open for later classes. */
  class?: string
  /** The provider's own SHOUTY_CASE code (`MONGO_DUPLICATE_KEY`). */
  provider_code?: string
  /** Whether the provider says a retry can succeed. */
  retryable?: boolean
}

// Field-pathed entry on a validation failure, carried in the error envelope's
// `details`. Omitted by the server when empty.
export type ErrorFieldCode =
  | "REQUIRED"
  | "REQUIRED_FOR_PROTOCOL"
  | "INVALID"
  | "TYPE_MISMATCH"
  | "TOO_LONG"
  | "UNKNOWN_FIELD"
  | "DUPLICATE_FIELD"
  | "DUPLICATE_TASK_ID"
  | "UNKNOWN_FUNCTION"
  // 1.2.1: the document still carries a definition-set authoring convenience
  // (`$from`, `use`) that only `orion-server compile` resolves.
  | "UNCOMPILED_SOURCE"
  // 1.3: an `env://` / `vault://` reference in a field that does not resolve
  // one, so it would be sent on as literal text. Reported at create, update
  // and validate; a stored workflow carrying one keeps running.
  | "UNRESOLVED_SECRET_REF"
  | (string & {})

export interface ErrorFieldDetail {
  path: string
  code: ErrorFieldCode
  message: string
  expected?: unknown
  got?: unknown
}

// Channel types
export type ChannelType = "sync" | "async"
// `cron` (1.6) is the one protocol with no caller: the channel is started by a
// clock, registers no route and no topic, and is not reachable at
// `data/{name}` or by `channel_call`. A cron channel must be `async`.
// Open in 2.0: a channel driver an edition composes may serve its own protocol.
export type ChannelProtocol = "rest" | "http" | "kafka" | "cron" | (string & {})

export const CHANNEL_TYPES = ["sync", "async"] as const satisfies readonly ChannelType[]

// Trace storage mode (global default + per-channel override via config.tracing)
export type TraceStorageMode = "sync" | "async" | "batch" | "off"

// --- Cron transport (1.6) ----------------------------------------------------
// A `protocol: "cron"` channel declares its schedule in `transport_config`, so
// it is ordinary definition content: versioned with the channel, covered by its
// content hash, promoted inside a package. No new entity, no new top-level
// field. Unknown keys are refused like everywhere else in a channel.

// What happens to occurrences whose time passed while nothing was running.
// `skip` records the misses; `latest` (default) runs the newest one; `catch_up`
// replays them oldest-first, bounded by `max_catch_up`.
export type MisfirePolicy = "skip" | "latest" | "catch_up"
// `forbid` admits at most `slots` occurrences per key at a time; a contender is
// recorded `skipped_singleton` rather than dropped.
export type ConcurrencyPolicy = "allow" | "forbid"

/** The lowest and highest `concurrency.slots` the server accepts (1.9). */
export const CRON_SLOTS_MIN = 1
export const CRON_SLOTS_MAX = 64

export interface CronConcurrencyConfig {
  policy?: ConcurrencyPolicy
  // Literal lock name, `[A-Za-z0-9][A-Za-z0-9_.-]{0,127}`; defaults to the
  // channel's `channel_id`. Two channels naming one key share its slots.
  key?: string
  /**
   * How many occurrences of `key` may run at once (1.9), 1–64, default 1.
   * `forbid` only — sending it with `allow` is refused. A run takes the lowest
   * free slot and reads it as `metadata.trigger.singleton_slot`, so a workflow
   * can partition its queue by it instead of cloning a channel per lane.
   *
   * The scope is the database: on SQLite each node has its own slots; nodes
   * sharing PostgreSQL or MySQL share them. Lowering it affects new runs only.
   *
   * An older node refuses the unknown key and quarantines the channel, so
   * every node must be on 1.9 before a channel setting it is activated.
   */
  slots?: number
}

export interface CronTransportConfig {
  // Six fields: second, minute, hour, day-of-month, month, day-of-week. Five-
  // and seven-field forms are refused rather than guessed at, as is an
  // expression with no occurrence in the next five years.
  schedule: string
  // IANA zone the calendar times are read in (default `UTC`). Abbreviations
  // are ambiguous and refused. A local time that does not exist does not
  // fire; one that happens twice fires twice.
  timezone?: string
  // The run's input, delivered where a request body would be. Must be an
  // object, at most 1 MB serialized. Secrets and `env://`-style references are
  // refused: the payload is recorded verbatim as every occurrence's trace input.
  payload?: Record<string, unknown>
  misfire_policy?: MisfirePolicy
  // Required when `misfire_policy` is `catch_up`; 1–1000.
  max_catch_up?: number
  concurrency?: CronConcurrencyConfig
}

// Headers `rate_limit.key_logic` can always read. Any other header must be
// declared in `key_headers` or the key resolves to null and every request is
// refused 429 — silent before 1.1, refused since.
export const BUILTIN_KEY_HEADERS = [
  "authorization",
  "x-api-key",
  "x-forwarded-for",
  "x-real-ip",
  "user-agent",
  "content-type",
  "origin",
  "x-tenant-id",
] as const

// `allow` fails open when the shared cluster Redis cannot answer; `deny`
// refuses with 503.
export type GuardBackendFailure = "allow" | "deny"

export interface RateLimitConfig {
  // Refused at create/update when 0 — it used to be floored to 1, so "admit
  // nothing" quietly became one request per second.
  requests_per_second?: number
  burst?: number
  key_logic?: JsonLogicValue
  // Merged with BUILTIN_KEY_HEADERS rather than replacing them; matched
  // case-insensitively.
  key_headers?: string[]
  on_backend_error?: GuardBackendFailure
}

export interface BackpressureConfig {
  max_concurrent_per_node?: number
}

export type ChannelAuthMode = "api_key" | "hmac" | "jwt"
export type HmacAlgorithm = "sha1" | "sha256" | "sha512"
export type HmacEncoding = "hex" | "base64" | "base64url"
export type HmacPreset = "zoom" | "slack" | "stripe" | "github" | "shopify" | "webex"

export interface JwtKey {
  algorithm: string
  key: string
  kid?: string
  key_encoding?: string
}

// Where a JWT is read from. Query parameters are deliberately not offered.
export interface JwtSource {
  header?: string
  scheme?: string
  cookie?: string
}

/**
 * Channel authentication. Covers `POST data/{channel}` and `/async`
 * identically — appending `/async` is not a bypass. Kafka and `channel_call`
 * are exempt by design.
 *
 * Modelled flat rather than as a discriminated union so a form can edit the
 * object incrementally; `mode` selects which fields the server reads.
 *
 * `keys`, `secret`/`secrets` and `jwt_keys[].key` come back masked as
 * `"******"`. Sending a mask back on update restores the stored value, so a
 * form must round-trip masks untouched.
 */
export interface ChannelAuthConfig {
  mode?: ChannelAuthMode

  // api_key
  keys?: string[]
  scheme?: string

  // api_key + hmac
  header?: string

  // hmac
  preset?: HmacPreset
  secret?: string
  secrets?: string[]
  algorithm?: HmacAlgorithm
  // Signing-string template: literals plus {body} (required),
  // {header:<name>} and {header:<name>:<key>} for packed k=v headers.
  message?: string
  encoding?: HmacEncoding
  // Mutually exclusive with signature_key.
  signature_prefix?: string
  signature_key?: string
  // Paired with tolerance_secs — either alone is a create-time error.
  timestamp?: string
  tolerance_secs?: number

  // jwt
  jwt_keys?: JwtKey[]
  jwks_url?: string
  // Mandatory non-empty allowlist; checked before anything else about a token.
  algorithms?: string[]
  issuer?: string | string[]
  audience?: string | string[]
  leeway_secs?: number
  require_exp?: boolean
  required?: boolean
  source?: JwtSource
  max_token_bytes?: number
  claims_to_metadata?: string[]
  // Evaluated over {"claims": …} after verification; falsy -> 403.
  authorization_logic?: JsonLogicValue
}

// How the HTTP request body becomes `data` and `metadata`.
export interface ChannelRequestConfig {
  // `auto` detects the Orion envelope; `payload` takes the parsed body verbatim.
  body_mode?: "auto" | "payload"
  cookies_to_metadata?: string[]
}

// Replacement bytes for a guard rejection. The platform still decides the
// status; only the body changes. Placeholders are a closed set — an unknown
// one is refused at authoring time.
export interface ChannelErrorBody {
  body: string
  content_type?: string
}

export const ERROR_BODY_PLACEHOLDERS = [
  "status",
  "code",
  "message",
  "request_id",
  "channel",
  "timestamp",
] as const

export interface ChannelResponseConfig {
  mode?: "envelope" | "shaped"
  // Replaces the default allowlist, so a channel can narrow as well as widen.
  allowed_headers?: string[]
  // Whether the workflow may set cookies through the declarative
  // `data._orion.response.cookies` block (1.5). Its own switch rather than an
  // `allowed_headers` entry, because that list *replaces* the default one. A
  // response that sets a cookie is never stored in the response cache.
  cookies?: boolean
  // Keyed by HTTP status ("400"–"599") plus an optional "default".
  error_bodies?: Record<string, ChannelErrorBody>
}

export interface CacheConfig {
  enabled?: boolean
  ttl_secs?: number
  cache_key_fields?: string[]
  // The general form of `cache_key_fields` (1.5): JSONLogic over
  // `{data, metadata}` that *replaces* the payload-derived half of the key.
  // Takes precedence over `cache_key_fields`; one that does not compile
  // quarantines the channel rather than falling back to the payload hash.
  key_logic?: JsonLogicValue
  connector?: string
  // Invalidation namespaces (1.10), 1–8 entries of `a-z0-9_-.:` up to 64 chars.
  // Each has a version counter in the cache store; `cache_invalidate` or
  // `POST admin/cache/namespaces/{ns}/invalidate` bumps it and every entry
  // stored under an older version stops matching. One INCR, no scan.
  namespaces?: string[]
  // Coalesce concurrent misses for one key on this node (1.10): the first miss
  // runs the workflow, the rest wait (bounded by timeout_ms, capped at 5 s) for
  // its stored entry. Per node — replicas each run their own leader.
  coalesce_misses?: boolean
}

// `POST admin/cache/namespaces/{namespace}/invalidate` (1.10). `stores` is how
// many cache stores the bump reached — every connector a channel declaring the
// namespace uses, plus the in-memory store when one does.
export interface CacheInvalidatedResponse {
  namespace: string
  stores: number
}

export interface DeduplicationConfig {
  header?: string
  window_secs?: number
  connector?: string
  // `deny` refuses with 503, never 409 — the key is unverifiable, not a known
  // duplicate.
  on_backend_error?: GuardBackendFailure
}

export interface ChannelTracingConfig {
  mode?: TraceStorageMode
  sample_rate?: number
  errors_only?: boolean
  task_details?: boolean
}

// The state cookie an OAuth2 sign-in carries between its two legs.
export interface OAuth2StateCookieConfig {
  name?: string
  secure?: boolean
  // `strict` is refused: the callback is a top-level cross-site GET from the
  // provider, so a Strict cookie is withheld on exactly that request.
  same_site?: "lax" | "none" | (string & {})
  path?: string
  // Seconds, 1–86400 (default 600). Also the state token's expiry — the window
  // a user has to finish the consent screen, not a session.
  max_age?: number
}

export interface OAuth2ReturnToConfig {
  // Query parameter read on the authorize leg.
  param: string
  // Absolute URLs; a candidate must share origin and sit at or under the path.
  allow_list: string[]
}

export interface OAuth2IdTokenConfig {
  issuer: string | string[]
  jwks_url: string
  // Defaults to `[client_id]`.
  audience?: string | string[]
  // Default `["RS256"]`.
  algorithms?: string[]
  required?: boolean
  nonce?: boolean
}

/**
 * Inbound OAuth2 / OIDC sign-in (1.6). Makes the channel the relying party in a
 * browser authorization-code grant: Orion owns the 302, the state cookie, the
 * CSRF binding, the nonce, PKCE, the code exchange and `id_token`
 * verification; the workflow receives the grant at `metadata.oauth`.
 *
 * *Establishment*, not verification — which is why it is a config block rather
 * than a fourth `auth.mode`. The channel serves two routes: `route_pattern` is
 * the authorize leg, `callback_path` is where the provider sends the browser
 * back. Requires `protocol: "rest"` with a `route_pattern`, and is refused
 * alongside `cache` (a cached 302 would replay one browser's state cookie to
 * the next visitor).
 */
// Where the normalised identity stamped at `metadata.identity` (1.11) is read
// from: each names the claim or userinfo key. Defaults are the OIDC claim
// names (`sub`, `preferred_username`, `name`, `email`, `picture`); GitHub, for
// one, needs `subject: "id"`, `login: "login"`, `picture: "avatar_url"`.
export interface OAuth2IdentityMap {
  subject?: string
  login?: string
  name?: string
  email?: string
  picture?: string
}

// `oidc` verifies an `id_token`; `oauth2` does not. Absent derives it from
// whether `id_token` is configured (or `issuer` is set).
export type OAuth2ProviderKind = "oidc" | "oauth2"

// One identity provider (1.11). The flat form of `OAuth2LoginConfig` carries
// the same fields at the top level; `providers` keys several of these by slug.
// Shared settings (callback_path, state_secret, state_cookie, return_to, pkce,
// run_workflow_on_authorize, the redirect_uri template) stay on the block.
export interface OAuth2ProviderConfig {
  kind?: OAuth2ProviderKind | string
  // OIDC issuer: `authorize_url`, `token_url`, `userinfo_url` and the id_token
  // JWKS are discovered from `<issuer>/.well-known/openid-configuration` at
  // load. Explicit endpoints, if given, win.
  issuer?: string
  // `https` only. Required unless `issuer` discovers it.
  authorize_url?: string
  // `https` only; address-checked on every exchange unless the instance sets
  // `oauth2_login.allow_private_token_urls`. Required unless discovered.
  token_url?: string
  // Literal, or `var://name` for a per-environment value.
  client_id?: string
  // `env://NAME` or `vault://…`; a literal works but stores the secret in the
  // definition. Masked on read like the auth secrets.
  client_secret?: string
  // How credentials reach the token endpoint: `basic` (default) or `body`.
  client_auth?: "basic" | "body"
  // Per-provider override of the block's `redirect_uri` template.
  redirect_uri?: string
  scopes?: string[]
  extra_authorize_params?: Record<string, string>
  id_token?: OAuth2IdTokenConfig
  // For a provider whose identity is not in an id_token (GitHub's `/user`).
  userinfo_url?: string
  identity?: OAuth2IdentityMap
}

export interface OAuth2LoginConfig {
  // Single-provider (flat) form, 1.6. Mutually exclusive with `providers`.
  kind?: OAuth2ProviderKind | string
  issuer?: string
  // `https` only. Required in the flat form unless `issuer` discovers it.
  authorize_url?: string
  // `https` only; address-checked on every exchange unless the instance sets
  // `oauth2_login.allow_private_token_urls`.
  token_url?: string
  // Literal, or `var://name` for a per-environment value.
  client_id?: string
  // `env://NAME` or `vault://…`; a literal works but stores the secret in the
  // definition. Masked on read like the auth secrets.
  client_secret?: string
  // How credentials reach the token endpoint: `basic` (default) or `body`.
  client_auth?: "basic" | "body"
  userinfo_url?: string
  identity?: OAuth2IdentityMap
  // Several providers on one channel, keyed by slug (1.11). `route_pattern`
  // and `callback_path` must then each carry one `{provider}` segment, and
  // `redirect_uri` must contain `{provider}`.
  providers?: Record<string, OAuth2ProviderConfig>
  // Merge the deployment's `[oauth2_login.providers]` under `providers` (the
  // definition wins a slug clash). Implies the multi-provider route shape.
  providers_from_instance?: boolean
  // Sent on both legs — RFC 6749 §4.1.3 requires them to match.
  redirect_uri: string
  // Static second path on this channel; must differ from `route_pattern`.
  callback_path: string
  scopes?: string[]
  // Extra authorize-URL query parameters. Naming a reserved one (`client_id`,
  // `redirect_uri`, `response_type`, `scope`, `state`, `nonce`,
  // `code_challenge`, `code_challenge_method`) is a create-time 400.
  extra_authorize_params?: Record<string, string>
  // PKCE (RFC 7636), S256 only. Default true.
  pkce?: boolean
  // HS256 key for the state cookie: `env://NAME` or `vault://…`, at least 32
  // bytes, identical on every node.
  state_secret: string
  state_cookie?: OAuth2StateCookieConfig
  // Run the workflow on the authorize leg before the redirect is built.
  run_workflow_on_authorize?: boolean
  return_to?: OAuth2ReturnToConfig
  // OIDC `id_token` verification. Absent is plain OAuth2.
  id_token?: OAuth2IdTokenConfig
}

// Every key is optional; an empty `{}` is a channel with no guards of its own.
// Unknown keys are REFUSED since 1.0 (they used to be silently ignored), so a
// retired spelling is a 400 with an UNKNOWN_FIELD detail, not a no-op.
//
// A `cron` channel is refused everything caller-shaped at authoring time —
// `auth`, `origin_allow_list`, `rate_limit`, `deduplication`, `cache`,
// `request`, `response`, `oauth2_login` — rather than storing and ignoring it.
// What still applies there: `timeout_ms`, `validation_logic`, `backpressure`
// and `tracing`. See `CRON_REFUSED_CONFIG_KEYS` in `lib/cron.ts`.
export interface ChannelConfig {
  auth?: ChannelAuthConfig
  rate_limit?: RateLimitConfig
  /**
   * A second limit (1.7), applied **after** authentication and keyed on the
   * verified principal rather than the caller's address.
   *
   * `rate_limit` runs *before* `check_auth` — deliberately, so a refusal costs
   * the least work and credential-stuffing is metered like any other traffic —
   * so it cannot know who the caller is. The only identities available to it
   * are the address and a request header, and a header is caller-supplied: a
   * key derived from one bounds an honest client, which is a burst control and
   * not a quota. This block is the quota half; both apply and keep separate
   * buckets, and a refusal from either is a 429 counted under the channel's
   * name.
   *
   * Same fields as `rate_limit`, with two rules enforced at **create** rather
   * than at run time:
   * - `key_logic` is REQUIRED. The address limiter can fall back to the caller
   *   identity; a principal cannot, and inventing one would silently turn a
   *   per-user quota into a per-address one.
   * - `auth.mode` must be `jwt` — the one mode that exposes claims. On any
   *   other, the key could never be computed and every request would be
   *   refused, so the config is refused instead.
   *
   * Its `key_logic` context is the outer limiter's plus `auth`, the verified
   * claims: `{"var": "auth.sub"}` is the usual key. Runs on the ingresses that
   * authenticate — HTTP sync and async — never Kafka, `channel_call` or cron.
   */
  principal_rate_limit?: RateLimitConfig
  backpressure?: BackpressureConfig
  timeout_ms?: number
  origin_allow_list?: string[]
  request?: ChannelRequestConfig
  response?: ChannelResponseConfig
  validation_logic?: JsonLogicValue
  cache?: CacheConfig
  deduplication?: DeduplicationConfig
  tracing?: ChannelTracingConfig
  oauth2_login?: OAuth2LoginConfig
}

/**
 * What every deployed entity carries from its manifest member (2.0). A
 * definition has no identity of its own; the member names it.
 */
export interface DeployedEntity {
  /** The member's revision — the author's numbering (`orion-cli` reuses it while the definition is unchanged), not a deployment revision. */
  revision: number
  /** `sha256:…` of the stored definition: what it *is*. */
  digest: string
  member: ManifestMember
}

/**
 * A channel as the head deploys it: the member's identity and requirements
 * over its stored definition — built by `lib/deployed-registry.ts` exactly as
 * the server's `channel_row` builds the row it serves. `channel_id` is the
 * member's id (what traces carry as `channel_id`, the cron ledger filters on
 * and `trigger` takes); `name` is the definition's (what `channel_call`,
 * `/data/{name}` and `orion_messages_total{channel}` use).
 */
export interface Channel extends DeployedEntity {
  channel_id: string
  name: string
  description: string | null
  channel_type: ChannelType
  protocol: ChannelProtocol
  route_pattern: string | null
  methods: string[] | null
  transport_config: Record<string, unknown>
  /** The workflow its member requires; null for a channel that requires none. */
  workflow_id: string | null
  config: ChannelConfig
  priority: number
  tags: string[]
  /** A canary split (Standard+): disjoint bucket intervals over `[0, 100)`. Absent means one workflow revision serves everything. */
  rollouts?: RolloutInterval[]
}

// Workflow types
export interface TaskFunction {
  name: string
  input?: Record<string, unknown>
}

export interface Task {
  id: string
  name?: string
  description?: string
  condition?: JsonLogicValue
  function: TaskFunction
  // What a handler error or 5xx from this task does (dataflow-rs 4):
  // `"fail"` (the default) passes it to the workflow, `"halt"` ends the
  // workflow, `"continue"` records it and runs the next task.
  on_failure?: "fail" | "continue" | "halt"
  // End the workflow once this task has run. A statement about *position*,
  // not outcome: a false `condition` does not halt, but a task that failed
  // under `on_failure: "continue"` still does.
  terminal?: boolean
  // The outcome axis to `terminal`'s position axis: what a 4xx from this
  // task does, which is what a `validation` rule that did not pass records.
  // `"continue"` (the default) records it and runs the next task, `"halt"`
  // ends the workflow, the task keeping its own status on the audit trail
  // rather than the 299 a `filter` halt records.
  on_rejection?: "continue" | "halt"
  // Fan-out (dataflow-rs 3.14 / Orion 1.9.1): run this task's function once
  // per element of `over`, each call on its own copy of the message, folded
  // back in element order. Steps then carry `element_index`.
  for_each?: TaskForEach
}

/**
 * A contiguous run of tasks sharing one condition — the guard clause
 * (*if this, answer and stop*), new in Orion 1.2 / dataflow-rs 3.6.
 *
 * In a workflow's `tasks` array a group is an element carrying its own `tasks`
 * key; a plain task carries `function`. The condition is evaluated **once, on
 * entry** — a false result skips the whole span without evaluating the
 * members' own conditions. Groups nest up to 8 deep and their ids share the
 * task id namespace.
 */
export interface TaskGroup {
  id: string
  name?: string
  description?: string
  condition?: JsonLogicValue
  terminal?: boolean
  tasks: Step[]
}

export interface TaskForEach {
  over: JsonLogicValue
  as: string
  max_concurrency?: number
  collect?: string
  into?: string
}

/** One element of a workflow's `tasks` array: a task, or a group of them. */
export type Step = Task | TaskGroup

/**
 * A workflow as the head deploys it, at one revision. A workflow may be
 * deployed at several revisions at once — a channel's canary routes a share
 * of its buckets to each — so `lib/deployed-registry.ts` keeps every deployed
 * revision and names one per id as the primary.
 */
export interface Workflow extends DeployedEntity {
  workflow_id: string
  name: string
  description: string | null
  priority: number
  tags: string[]
  condition?: JsonLogicValue
  /** What a failing task does to the run (`continue` is 1.x's workflow-level `continue_on_error`). */
  on_failure?: "fail" | "continue" | (string & {})
  // Each element is a `Task` or a `TaskGroup` — use `flattenSteps` for the
  // leaf tasks the engine actually runs.
  tasks: Step[]
  // The engine-managed loop over `tasks` (dataflow-rs 3.14 / Orion 1.9.1),
  // absent for a workflow that runs its tasks once. Its `setup` steps run
  // first, once; `tasks` is then the body. `workflowSteps()` walks both.
  loop?: WorkflowLoop
}
/**
 * A workflow `loop` (dataflow-rs 3.14). `setup` runs once before the body and
 * holds steps exactly like `tasks` (groups included). `over` iterates a list —
 * each element bound at `as` — otherwise the body repeats while the workflow
 * condition holds, up to `max`. `counter` names where the iteration index is
 * written; `scratch` is per-iteration space cleared between passes. Unknown
 * keys are a 400 UNKNOWN_FIELD since 1.10, and `"loop": null` clears it.
 */
export interface WorkflowLoop {
  setup?: Step[]
  over?: JsonLogicValue
  as?: string
  counter?: string
  max?: number
  scratch?: string
  [key: string]: unknown
}

/**
 * `POST admin/definitions/test`: run a workflow definition once on the node's
 * engine — live functions, plugins and connectors — without deploying it.
 */
export interface TestDefinitionRequest {
  /** The workflow document, as `POST admin/definitions` would take it. */
  definition: Record<string, unknown>
  data: unknown
  metadata?: Record<string, unknown>
}

// dataflow-rs 3.0 per-task execution trace.
// `result` is lowercase on the wire ("executed" | "skipped" | "error"); each step
// carries a `message` snapshot of the message state after that task.
export type ExecutionStepResult = "executed" | "skipped" | "failed" | "error" | string

export interface ExecutionStepMessage {
  id?: string
  payload?: unknown
  context?: { data?: unknown; metadata?: unknown; [key: string]: unknown }
  [key: string]: unknown
}

// One write a task made to the message (`TraceOptions.changes`).
export interface ExecutionStepChange {
  path: string
  old_value?: unknown
  new_value?: unknown
  /** The key at `path` was removed rather than written (dataflow-rs 4). */
  removed?: boolean
  /** The write replaced the root at `path` instead of merging into it (dataflow-rs 4). */
  replaced?: boolean
  [key: string]: unknown
}

/**
 * One step of a dataflow-rs execution trace, as Orion 1.12 (dataflow-rs 3.15)
 * stores it under `tracing.task_details`.
 *
 * `result` is only `executed` or `skipped`: a task that ran and then errored
 * is still `executed`, and the error lives on the trace (`"Task <id> error:
 * …"`) and in the snapshot's `errors` — `lib/trace-timeline.ts` attributes it.
 * `started_at` (RFC 3339, nanoseconds, UTC with a `Z`) and `duration_us` are
 * set on executed steps only. `loop_counter` is the workflow `loop` iteration
 * a body step ran in; `element_index` the `for_each` element.
 */
export interface ExecutionStep {
  workflow_id?: string
  // Null for a workflow-level skip.
  task_id?: string | null
  result?: ExecutionStepResult
  /** The call's status; null for a skip (dataflow-rs 4). */
  status?: number | null
  /** The error records the step added (dataflow-rs 4). */
  errors?: unknown[]
  // Snapshot after the step. Absent for skips, and for steps recorded after
  // `max_snapshot_bytes` was exceeded (the trace is then `truncated`). On
  // Orion 2 the client replays it from the trace's `initial` and changes.
  message?: ExecutionStepMessage
  mapping_contexts?: unknown[]
  started_at?: string
  duration_us?: number
  // This task's own writes; `[]` wrote nothing, absent means not recorded.
  changes?: ExecutionStepChange[]
  loop_counter?: number
  element_index?: number
  /** @deprecated never sent by the server; read `duration_us`. */
  duration_ms?: number
  /** @deprecated never sent by the server. */
  task_name?: string
  /** @deprecated never sent by the server. */
  function?: string
  /** @deprecated never sent by the server. */
  error?: unknown
  /** @deprecated never sent by the server. */
  input?: unknown
  /** @deprecated never sent by the server. */
  output?: unknown
  [key: string]: unknown
}

export interface ExecutionTrace {
  steps: ExecutionStep[]
  /** The context the run started from (dataflow-rs 4). */
  initial?: Record<string, unknown>
  // Set when `max_snapshot_bytes` was exceeded: later steps keep their timings
  // but lose their `message` snapshot. Serialized only when true.
  truncated?: boolean
  [key: string]: unknown
}

/** `POST admin/definitions/test` (bare). The trace is kept on every outcome; `error` says why a run stopped short. */
export interface TestDefinitionResponse {
  matched: boolean
  trace: ExecutionTrace
  output: unknown
  errors: unknown[]
  error?: string | null
}

// Circuit breaker state is per-replica, never cluster-wide.
export interface CircuitBreakerStatus {
  enabled: boolean
  // Always "node".
  scope: string
  // Which node's map this is.
  instance_id: string
  // `channel:connector` -> "closed" | "open" | "half_open".
  breakers: Record<string, string>
}

// Engine types

/**
 * A channel a generation refused to serve — the shape `/health`'s
 * `channels.quarantined` and `/engine/status`'s `load_issues.channels` share,
 * because since 1.9 both are built by one collector on the server.
 */
export interface ChannelLoadIssue {
  // The channel's *name*, which is what the quarantine is keyed by.
  channel: string
  // The channel's id (1.9), so a quarantine can link straight to its page.
  // Empty from a server that predates the field.
  channel_id?: string
  // The workflow it is bound to, when it names one (1.9).
  workflow_id?: string | null
  reason: string
}

/**
 * An enabled connector the registry could not load. `stage` is
 * `env_substitution`, `json_parse`, `var_reference`, `secret_resolution`,
 * `deserialize` or `endpoint` (the last two added in 1.9, for a `var://`
 * reference that does not resolve and for a URL arriving by reference whose
 * scheme is neither `http` nor `https`).
 *
 * Note this is an *object*, not a bare name — every task using the connector
 * is failing, and the stage is what says why.
 */
export interface ConnectorLoadIssue {
  // The connector's name — what workflows reference it by.
  connector: string
  connector_id?: string
  stage: string
  reason: string
}

/**
 * What a runtime generation could not load, on the node that answered (1.9).
 *
 * The same four lists `/health` serves an admin caller, from one collector, so
 * the two surfaces cannot disagree. An *empty* `EngineLoadIssues` means
 * nothing is quarantined; the field being absent means the server predates it
 * and cannot say — which is why every reader must distinguish the two.
 */
export interface EngineLoadIssues {
  channels: ChannelLoadIssue[]
  plugins: PluginLoadIssue[]
  models: ModelLoadIssue[]
  connectors: ConnectorLoadIssue[]
}

/** Nothing quarantined. Absent issues are "unknown" and are not this. */
export function noLoadIssues(issues: EngineLoadIssues | null | undefined): boolean {
  if (!issues) return false
  return (
    (issues.channels?.length ?? 0) === 0 &&
    (issues.plugins?.length ?? 0) === 0 &&
    (issues.models?.length ?? 0) === 0 &&
    (issues.connectors?.length ?? 0) === 0
  )
}

/** Total quarantined entities across the four kinds. */
export function countLoadIssues(issues: EngineLoadIssues | null | undefined): number {
  if (!issues) return 0
  return (
    (issues.channels?.length ?? 0) +
    (issues.plugins?.length ?? 0) +
    (issues.models?.length ?? 0) +
    (issues.connectors?.length ?? 0)
  )
}

/**
 * What this node is configured to run (1.9) — the three runtimes that are off
 * by default and quarantine what needs them when they are. A cron channel on a
 * node with `cron.enabled = false` is not a broken channel; it is a schedule
 * that would never fire, which is why a plan can predict the quarantine from
 * this rather than discover it from a reload.
 */
export interface EngineCapabilities {
  cron: boolean
  plugins: boolean
  /** 1.x only: Orion 2.0 has no models runtime (ONNX models are `orion-ext`'s `com.orion.models` provider). */
  models?: boolean
}

export interface EngineStatus {
  workflows_count: number
  active_workflows: number
  channels: string[]
  uptime_seconds: number
  version: string
  // The generation this node serves (1.9); `0` from a server that predates it.
  generation?: number
  // Absent from a pre-1.9 server — "cannot tell you", not "nothing wrong".
  load_issues?: EngineLoadIssues | null
  capabilities?: EngineCapabilities | null
}

/** One plugin version this node loaded, from the admin-only `/health` detail. */
export interface PluginLoaded {
  plugin: string
  version: number
  digest: string
  functions: string[]
  compile_ms?: number | null
}

/**
 * Why a plugin version is not serving on this node. `stage` is `disabled`
 * (the sandbox is off here while an active row exists), `manifest`,
 * `signature`, `artifact`, `compile`, `link`, `size` or `self_test`. Every
 * workflow naming one of its functions is quarantined the same way a failed
 * connector load quarantines its users.
 */
export interface PluginLoadIssue {
  plugin: string
  version: number
  digest: string
  stage: string
  reason: string
}

/**
 * One loaded session a runtime holds on this node right now (1.8).
 *
 * A row is a *session*, not a model version. Since 1.8.1 the session cache is
 * keyed by digest, **binding**, runtime and device, because a load is a
 * function of the bytes, the manifest and the device: two manifests over one
 * artifact that declare their outputs in different orders are two plans over
 * one graph and get two sessions. Registering one artifact under several
 * manifests is expressly representable — one graph for two tenants with
 * different adapters, two result expressions compared over one file — so
 * `digest` alone does not identify a row.
 */
export interface ModelLoaded {
  // The identity a generation, a trace and a package all name the model by.
  // Not unique among these rows on its own — see `binding`.
  digest: string
  /**
   * A fingerprint of what the load actually read (1.8.1): the inputs' names,
   * dtypes and shapes and the output names, in manifest order. Everything else
   * stays out of it on purpose — the model's name and version, its adapters,
   * its result expression — so two manifests that bind the graph the same way
   * still share one resident session. Absent from a pre-1.8.1 node.
   */
  binding?: string
  runtime: string
  device: string
  resident_bytes: number
}

/** The key one resident session is identified by — see `ModelLoaded.binding`. */
export function loadedModelKey(m: ModelLoaded): string {
  return `${m.digest}|${m.binding ?? ""}|${m.runtime}|${m.device}`
}

/**
 * Why a model version is not serving on this node (1.8). `stage` is `disabled`
 * (the runtime is off here while an active row exists), `admission` (no node
 * ever recorded a passing verdict), `manifest`, `artifact` or `adapter`. Every
 * workflow naming the model by literal id is quarantined, exactly as one
 * naming an unavailable plugin function is.
 */
export interface ModelLoadIssue {
  model: string
  version: number
  digest: string
  stage: string
  reason: string
}

/**
 * One `[packages] apply` entry's progress at startup (1.9), from the
 * admin-only `/health` detail.
 *
 * `pending` (not reached), `applying` (being read, applied or verified),
 * `applied` (by this node, and serving), `already_applied` (this version was
 * already current — an earlier boot, or a peer), `superseded` (a later version
 * is current; what this one still holds is serving) or `failed` (refused or
 * not serving; the process exits). The first four all count as serving.
 */
export interface BootPackageStatus {
  // The `[packages] apply` entry — a path on the node, not a package name.
  file: string
  // From the artifact once read; empty before that.
  name: string
  version: string
  content_hash: string
  state: string
  error?: string | null
}

/** Whether a configured package counts as serving for readiness. */
export function bootPackageServing(state: string | null | undefined): boolean {
  return state === "applied" || state === "already_applied" || state === "superseded"
}

/** A supervised background task, from the admin-only `/health` detail (1.4). */
export interface BackgroundTaskReport {
  name: string
  // `running`, `restarting`, `stopped` — open on the wire.
  state: string
  // A running task with a non-zero restart count is the one worth alerting on.
  restarts: number
  // A required task that has stopped for good fails `/readyz`.
  required: boolean
}

// A component state. `ok` | `degraded` | `error`, plus `disabled` for a
// subsystem that is off by configuration — a state, not a fault.
export type ComponentState = "ok" | "degraded" | "error" | "disabled" | (string & {})

export interface HealthResponse {
  // "ok" | "degraded"
  status: string
  /**
   * Per-subsystem state, each `ok` | `degraded` | `error` | `disabled`.
   * Orion 2.0 serves `database`, `engine` (a constant "ok"), `connectors`,
   * `channels`, `background_tasks`, `engine_reload` (the last build of the
   * desired revision failed, so this node serves the previous one) and
   * `plugins` (`disabled` when the sandbox is off and nothing needs it), plus
   * `cron` on a node that schedules. 1.x's `kafka`, `cluster_redis`,
   * `config_propagation`, `models` and `packages` are gone: Kafka and the
   * cluster store are `orion-ext`'s and report on `/readyz`, and models and
   * package apply no longer exist in Community. The record stays open — an
   * edition may add a component.
   *
   * `degraded` on `engine_reload` and `cron` does not fail `/readyz`: the node
   * still serves every request correctly.
   */
  components: Record<string, ComponentState>
  /**
   * Connector health. `failed_to_load` names connectors the engine could not
   * bring up, so every task using one is failing right now. Each entry is a
   * `ConnectorLoadIssue` **object**, not a bare name — reading it as a string
   * renders `[object Object]` and matches no connector.
   *
   * The spec's `HealthStatus` schema declares only status/version/
   * uptime_seconds/components — the rest of this body is served but
   * undocumented, which is why these are optional and the index signature
   * stays. Verified against a live 1.2.0 server.
   */
  connectors: {
    circuit_breaker_scope?: string
    circuit_breakers?: Record<string, string>
    failed_to_load?: ConnectorLoadIssue[]
    [key: string]: unknown
  }
  /**
   * `quarantined` names channels the engine refused to serve — most often an
   * unresolved `env://` reference in the config. The route simply does not
   * exist, on a server that still reports healthy, which is exactly the
   * silent-success failure worth surfacing loudly.
   */
  channels?: {
    /**
     * `{ channel, reason }` per refused channel — not bare names. Since 1.3 a
     * workflow reading a secret where it would be recorded, or naming one the
     * instance does not declare, quarantines its channel with that reason.
     * Since 1.9 each entry also carries `channel_id` and `workflow_id`, and
     * the list is the same one `/engine/status` serves under
     * `load_issues.channels`.
     */
    quarantined?: ChannelLoadIssue[]
    [key: string]: unknown
  }
  /**
   * Plugin load state on this node (1.6), admin-only detail. `failed_to_load`
   * names active versions this node is not serving, each with the stage that
   * refused it — the same silent-success failure as a failed connector load.
   */
  plugins?: {
    loaded?: PluginLoaded[]
    failed_to_load?: PluginLoadIssue[]
    [key: string]: unknown
  }
  /**
   * Model residency on this node (1.8), admin-only detail. Absent entirely on
   * a node without the runtime that has nothing stored needing it; present
   * with `failed_to_load` alone on one holding an active row it cannot serve,
   * because the quarantine that follows is only explained here.
   *
   * Note the asymmetry with the admission verdict on the row itself: a verdict
   * is recorded once, by whichever node took the registration, and shared
   * cluster-wide — but every node's artifact cache is its own, so residency
   * here says nothing about any peer.
   */
  models?: {
    // This node's name, as `admission.node` would spell it.
    node?: string
    admission_queue_capacity?: number
    // Bytes the artifact cache directory holds, swept to `models.max_cache_bytes`.
    cache_bytes?: number
    // Bytes resident across every runtime, bounded by `models.max_loaded_bytes`.
    loaded_bytes?: number
    loaded?: ModelLoaded[]
    failed_to_load?: ModelLoadIssue[]
    [key: string]: unknown
  }
  /**
   * The scheduler's own health (1.6), present only alongside `components.cron`.
   * A reconciler that errors on every pass is alive, restarts nothing, and
   * simply stops firing — `reconcile_age_secs` is what says so.
   */
  cron?: {
    // Unix seconds (an `i64`), not an RFC 3339 string like every other
    // timestamp on the admin plane. Null before the first pass completes.
    last_reconcile_at?: number | string | null
    reconcile_age_secs?: number | null
    oldest_pending_age_secs?: number | null
    lease_renewal_failures?: number
    scheduled_channels?: number
    [key: string]: unknown
  }
  /**
   * The `[packages] apply` progress behind `components.packages` (1.9),
   * admin-only detail. Present only when this node is configured to apply its
   * own packages at startup.
   */
  packages?: BootPackageStatus[]
  // Per-task breakdown behind `components.background_tasks` (1.4), admin-only.
  background_tasks?: BackgroundTaskReport[]
  workflows_loaded: number
  uptime_seconds: number
  version: string
  // Build provenance, served only to an admin caller.
  git_hash?: string | null
  build_timestamp?: string | null
}

// Trace types
export type TraceStatus = "pending" | "running" | "completed" | "failed"

export const TRACE_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const satisfies readonly TraceStatus[]

/**
 * One row of the trace list. Since 1.0 the list is a payload-free projection:
 * `task_trace_json`, `input_json` and `result_json` are NOT returned here, so
 * one request cannot dump every request's body. Fetch a single trace by id for
 * the payload and the per-task trace.
 */
/**
 * How a trace was submitted: `sync`, `async` or `cron` (a scheduled
 * occurrence, linked from the occurrence ledger by `trace_id`) in 2.0. An open
 * string on the wire by design — an edition's channel driver (`orion-ext`'s
 * Kafka) may add its own, and 1.x stored `kafka` rows — so the filter keeps an
 * unlisted value visible rather than dropping it.
 */
export type TraceMode = "sync" | "async" | "cron" | (string & {})

export const TRACE_MODES: TraceMode[] = ["sync", "async", "cron"]

export interface Trace {
  id: string
  // Channel name as it was when the trace ran — a snapshot, not a key.
  channel: string
  channel_id?: string | null
  status: string
  mode: TraceMode
  error_message: string | null
  duration_ms: number | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

// Parsed workflow result stored on a completed trace (dataflow-rs 3.0 shape).
export interface WorkflowResult {
  id?: string
  status?: string
  data?: Record<string, unknown>
  errors?: unknown[]
}

export interface TraceDetail {
  id: string
  status: string
  mode: TraceMode
  // Channel name at the time of the run; the id is null for a Kafka trace.
  channel?: string
  channel_id?: string | null
  duration_ms?: number | null
  // Parsed workflow result, present only when status === "completed".
  message?: WorkflowResult
  // Error text, present only when status === "failed".
  error?: string
  // Parsed per-task execution trace, present only when the channel opted into
  // task_details. Shape mirrors ExecutionTrace.
  task_trace_json?: ExecutionTrace | unknown
  created_at: string
  started_at?: string | null
  completed_at?: string | null
}

/**
 * `GET admin/traces` (2.0): cursor-paged, newest first. 1.x's `offset`,
 * `sort_by` and `sort_order` are gone. Pass a `next_cursor` back unmodified;
 * `include_total` is off by default because the count is a full scan of the
 * filtered set.
 */
export interface ListTracesParams extends PageParams {
  status?: string
  channel?: string
  mode?: TraceMode
}

/** One page of the trace list. Rows are payload-free: fetch a trace for its steps. */
export type TracePage = Page<Trace>

// Audit log types
export interface AuditLog {
  id: string
  principal: string
  action: string
  resource_type: string
  resource_id: string
  details?: string | null
  created_at: string
}

/**
 * Server-side filters, all exact-match except the time bounds. There is no
 * `sort_by` on this endpoint, and `limit` is clamped to 1–1000.
 */
export interface ListAuditLogsParams extends PageParams {
  action?: string
  resource_type?: string
  resource_id?: string
  principal?: string
  // Inclusive lower bound on created_at, RFC 3339 or a bare naive timestamp.
  start_time?: string
  // Exclusive upper bound.
  end_time?: string
}

// Backups (SQLite only). POST returns the created file; GET lists the backup dir.
export interface BackupCreated {
  filename: string
  path: string
  size_bytes: number
  created_at: string
}

export interface BackupFile {
  filename: string
  size_bytes: number
  /** When the snapshot was taken (2.0; 1.x named it `modified_at`). */
  created_at: string
}

// Workflow function catalogue (GET admin/functions).
//
// Since 1.2 this is *every* name a workflow may use, not just the schema
// registry: the nine engine built-ins (`map`, `filter`, `log`, `parse_json`,
// `parse_xml`, `validation`, `publish_json`, `publish_xml`, …) now appear
// alongside the Orion handlers. The two are told apart by `source`, which is
// also what explains an absent `input_fields`.
export type FunctionFieldKind = "string" | "number" | "bool" | "object" | "array" | "any"

export interface FunctionFieldSchema {
  name: string
  description: string
  kind: FunctionFieldKind
  required: boolean
  // The handler folds `{"var": "..."}` nodes in this field against the
  // message at execution.
  resolvable: boolean
  /**
   * Where inside the field the handler reads key material (1.3): `[]` means
   * nowhere; `[""]` means the field's own value takes `{"secret": "name"}` in
   * place of a literal (`crypto.key`, `jwt_sign.key`, `jwt_verify.issuer` /
   * `audience`); `["[].key"]` means each array element's `key` does
   * (`jwt_verify.keys`). These are also the only paths where an `env://` or
   * `vault://` string is resolved rather than sent on verbatim — anywhere else
   * it is an `UNRESOLVED_SECRET_REF`.
   */
  secret_at: string[]
  /**
   * Where inside the field the engine evaluates JSONLogic (1.5): `[""]` means
   * the field's own value is an expression — compiled once when the workflow
   * loads, evaluated per message — so an object or array there may be an
   * operator call rather than a literal of the declared kind. `[]` means the
   * field is folded (`resolvable`) or literal. A plugin manifest's
   * `template_at = true` arrives as `[""]` too.
   */
  template_at?: string[]
  // Another accepted spelling of the field name, or null.
  alias: string | null
}

/**
 * What a second run of a function does (1.6), served for every catalogue
 * entry. A different question from whether an *error* was transient — Orion
 * retries tasks in several places (the trace DLQ, a Kafka redelivery,
 * `http_call`'s transport retry) and this is what such a retry costs.
 *
 * `depends_on` is the honest variant: `data_write` with `op: "upsert"` is
 * idempotent and with `op: "insert"` is not, so the field names the input to
 * look at rather than collapsing to a boolean that would be wrong half the
 * time.
 */
export type RetrySafetyKind = "pure" | "read" | "idempotent_write" | "unsafe_write" | "depends_on"

export type RetrySafety =
  | { kind: "pure" | "read" | "idempotent_write" | "unsafe_write" }
  | { kind: "depends_on"; input: string }
  // Tolerate a kind a later server adds.
  | { kind: string; input?: string }

/** Which plugin a `source: "plugin"` catalogue entry comes from. */
export interface PluginBinding {
  id: string
  version: number
  // `sha256:…` of the component bytes — what a trace and a package name it by.
  digest: string
  // The WIT package version the component was built against.
  abi: string
}

// `orion` — a handler Orion implements and input-schema validates at create
// time. `engine` — a dataflow-rs built-in the engine executes itself, which
// declares no input schema. `plugin` (1.6) — a function an active WebAssembly
// plugin declares; its field table comes from the plugin's manifest and it
// carries a `plugin` block naming the version and digest serving it.
export type FunctionSource = "orion" | "engine" | "plugin" | (string & {})

export interface FunctionSchema {
  name: string
  description: string
  // `connector` | `control` | `data` | `utility` — open, so unmapped values
  // must degrade rather than throw.
  category: string
  source: FunctionSource
  // **Absent** for an engine built-in — omitted rather than nulled, because
  // absence is the honest encoding of "declares no input schema". Never index
  // this without a guard.
  input_fields?: FunctionFieldSchema[] | null
  // Served for every entry since 1.6, built-ins included.
  retry_safety: RetrySafety
  // Present only on a `source: "plugin"` entry.
  plugin?: PluginBinding
}

// Data types
export interface ProcessRequest {
  data: Record<string, unknown>
  metadata?: Record<string, unknown>
}

// Per-request profiling, present under `_orion.profile` when profiling is
// enabled (X-Orion-Profile header) and the server allows it.
export interface ProfilePhase {
  name: string
  ms: number
  pct: number
}

export interface ProfileResult {
  version: number
  totals_ms?: number
  request_total_ms?: number
  handlers_total_ms?: number
  workflow_total_ms?: number
  phases?: ProfilePhase[]
  handlers?: Array<Record<string, unknown>>
  by_function?: Record<string, { count: number; total_ms: number }>
  by_connector?: Record<string, { count: number; total_ms: number }>
  breakdown_pct?: Record<string, number>
  [key: string]: unknown
}

/**
 * Per-task failure inside a 200. Since 1.1 `code` names the real failure
 * instead of a flat TASK_ERROR: IO_ERROR (no connection), TIMEOUT_ERROR,
 * FUNCTION_ERROR (refused before any socket — SSRF, a closed gate), the
 * connector's own lower-case `circuit_open` for a shed request, and
 * TASK_ERROR still as the fallback for an engine-owned error. Since 1.5 a
 * database constraint violation is its own class — `integrity_unique`,
 * `integrity_foreign_key`, `integrity_not_null`, `integrity_check` — and a run
 * that does not catch one answers 409 for the first two, 400 for the rest.
 */
export interface ProcessTaskError {
  code: string
  message: string
  task_id?: string | null
}

export interface ProcessResponse {
  id?: string
  // Always "ok" — task failures are reported in `errors`, not by flipping this.
  status?: string
  data?: Record<string, unknown>
  errors?: ProcessTaskError[]
  // Present only when `errors` is non-empty; correlates with the stored trace.
  request_id?: string | null
  _orion?: { profile?: ProfileResult }
  [key: string]: unknown
}

/**
 * The 202 acknowledgment from an /async submission. `trace_token` is a
 * capability token scoping the poll to this submission — polling
 * `admin/traces/{id}` without it needs an admin credential.
 */
export interface AsyncSubmitResponse {
  trace_id: string
  trace_token: string
}

// --- Trace dead-letter queue -----------------------------------------------
// Only /async traffic reaches this queue: a sync request carries its own
// failure back to the caller, with nothing left to retry.

// List rows are a payload-free projection — fetch one by id for the payload.
export interface TraceDlqSummary {
  id: string
  trace_id: string
  channel: string
  error_message: string
  retry_count: number
  max_retries: number
  next_retry_at: string
  created_at: string
  updated_at: string
}

/** A DLQ entry with its failed message. 2.0 serves `payload` and `metadata` as objects (1.x sent them as JSON strings). */
export interface TraceDlqEntry extends TraceDlqSummary {
  payload: unknown
  metadata: unknown
}

export interface ListTraceDlqParams extends PageParams {
  channel?: string
  exhausted?: boolean
}

export interface PurgeTraceDlqRequest {
  // Exhausted entries older than this are deleted; 0 purges every exhausted
  // entry. Live entries are never purged.
  older_than_hours: number
}

export interface DlqPurgeResult {
  purged: number
  older_than_hours: number
}

// --- Cron occurrences (1.6) --------------------------------------------------
// Every scheduled instant of a cron channel becomes a durable **occurrence**:
// a row written before the work starts and kept after it finishes. It is
// deliberately not the trace — traces are observability and may be sampled or
// switched off; the ledger is scheduling-correctness state and is always
// written. Terminal occurrences age out with traces; pending ones never do.

/**
 * `pending` (materialised, waiting for a worker), `claimed`, `running`,
 * `completed`, `failed`, `skipped_misfire` (one row summarises a run of missed
 * instants, count and range in `error_message`) or `skipped_singleton` (its
 * `concurrency.key` was held). Open on the wire: tolerate a value you do not
 * know.
 */
export type CronOccurrenceStatus =
  | "pending"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "skipped_misfire"
  | "skipped_singleton"
  | (string & {})

export const CRON_OCCURRENCE_STATUSES: CronOccurrenceStatus[] = [
  "pending",
  "claimed",
  "running",
  "completed",
  "failed",
  "skipped_misfire",
  "skipped_singleton",
]

// `cron` for a scheduled run, `manual` for one started by the trigger endpoint.
export type CronTrigger = "cron" | "manual" | (string & {})

/** One row of `GET admin/cron/occurrences` — what happened and when. */
export interface CronOccurrenceSummary {
  id: string
  channel_id: string
  // The channel's name when this occurrence was materialised, not its name
  // now — renaming a channel does not rewrite what already ran.
  channel_name: string
  trigger: CronTrigger
  // The immutable UTC instant this occurrence was due. Two attempts at one
  // occurrence agree on it, which is what makes it an idempotency key.
  scheduled_for: string
  status: CronOccurrenceStatus
  // 0 while pending, 1 once a first attempt is claimed; a retry keeps the id
  // and increments this.
  attempt: number
  started_at?: string | null
  completed_at?: string | null
  created_at: string
}

/**
 * One occurrence in full: the failure reason, the trace to read the run in,
 * and the lease bookkeeping that answers "which node has it, and until when?".
 */
export interface CronOccurrence extends CronOccurrenceSummary {
  // The version that materialised it, and the one that claimed it. They differ
  // when the channel gained a version between the two — expected, as a queued
  // async trace follows the active generation at claim time.
  channel_version: number
  executing_version?: number | null
  workflow_id?: string | null
  // Both null unless an attempt is in flight.
  claimed_by?: string | null
  claimed_until?: string | null
  // The trace this attempt wrote. Null before admission, and when trace
  // storage dropped the row — the occurrence is kept either way.
  trace_id?: string | null
  error_message?: string | null
  singleton_key?: string | null
  /**
   * Which of the key's `concurrency.slots` this attempt holds, from `0` (1.9).
   * Two occurrences of one key can share a `fencing_token` when they hold
   * different slots, so it is the *pair* that names a hold. `null` under
   * `allow`, and from a pre-1.9 server.
   */
  singleton_slot?: number | null
  // The acquisition generation this attempt holds its key under. Diagnostic.
  fencing_token?: number | null
  updated_at: string
}

/**
 * One channel's schedule as the runtime sees it right now
 * (`GET admin/cron/status`). Deliberately separate from the channel: the
 * channel row is an immutable authored definition, and where its cursor has
 * got to is runtime state that changes every minute.
 */
export interface CronScheduleStatus {
  channel_id: string
  channel_name: string
  // The authored expression, echoed so one read answers "what is scheduled?".
  schedule: string
  timezone: string
  // Null until the reconciler has seen the channel — within one poll interval
  // of activation.
  next_fire_at?: string | null
  // Set when the channel has left the active set; its history is kept.
  paused_at?: string | null
  last_status?: CronOccurrenceStatus | null
  last_scheduled_for?: string | null
  last_completed_at?: string | null
  // Occurrences waiting for a worker. A number that only grows means the
  // schedule produces work faster than the instance runs it.
  pending: number
  // `allow` or `forbid` (1.9); absent from a pre-1.9 server.
  concurrency_policy?: string
  // The lock this channel's runs take. Present under `forbid`.
  singleton_key?: string | null
  // How many runs of `singleton_key` this channel admits at once.
  slots?: number | null
  /**
   * Live leases on `singleton_key` right now, **across every channel sharing
   * the key** — so it can exceed this channel's `slots` when another declares
   * more, or just after `slots` was lowered. Not a bug in the reading.
   */
  slots_held?: number | null
}

export interface ListCronOccurrencesParams extends PageParams {
  // The stable channel id, not the name — an occurrence outlives the name it
  // was materialised under.
  channel_id?: string
  status?: CronOccurrenceStatus
  // Inclusive bounds on `scheduled_for`, RFC 3339.
  since?: string
  until?: string
}

// --- Plugins (1.6) -----------------------------------------------------------
// Custom task functions as sandboxed WebAssembly components. A plugin is a
// versioned entity beside channels, workflows and connectors, with the same
// draft → active → archived lifecycle, promoted in packages and synced across
// a cluster. A plugin function is a pure JSON → JSON transformation: its world
// imports nothing — no filesystem, clock, randomness, sockets, connectors or
// secrets — so `dry-run` runs it for real. Off by default (`plugins.enabled`):
// with the sandbox off `POST admin/plugins` answers 400, and a stored plugin
// row quarantines the workflows naming its functions rather than aborting.

/** One `[[functions.input_fields]]` row of a manifest. */
export interface PluginManifestField {
  name: string
  kind?: FunctionFieldKind
  required?: boolean
  description?: string
  // `{"var": …}` nodes are folded against the message before the guest sees it.
  resolvable?: boolean
  // The field's value is JSONLogic, evaluated per message. Not combinable
  // with `resolvable`.
  template_at?: boolean
  [key: string]: unknown
}

export interface PluginManifestFunction {
  // Must be `<plugin name>.<label>` — a plugin's functions live in its own
  // namespace, which is what keeps them from colliding with a built-in.
  name: string
  description?: string
  // Free text, default `transform`.
  category?: string
  // `data`, `temp_data` or `metadata`: where the result lands when a task
  // names no `output`. Absent means a task must name one.
  output_default_root?: string
  input_fields?: PluginManifestField[]
  [key: string]: unknown
}

/**
 * The manifest, as the server serves it back (validated, as JSON — what was
 * uploaded with nothing inferred added). An upload may carry it as TOML text
 * instead; the shape here is what the CLI's `plugin.toml` declares.
 */
export interface PluginManifest {
  // Must be `orion:plugin@1.0.0`.
  abi?: string
  // The plugin id: lowercase reverse-domain with at least two labels.
  name?: string
  // The author's own version string; Orion assigns the entity version.
  version?: string
  // Path of the component relative to the manifest — read by tooling only.
  component?: string
  functions?: PluginManifestFunction[]
  [key: string]: unknown
}

/**
 * A WebAssembly plugin as the head deploys it: its `plugin.toml` manifest and
 * the facts of its component. The component itself (base64 in the stored
 * definition) is never kept — `useDefinition` replaces it with its size and
 * `sha256:` digest, which is what the catalogue and `/health` name it by.
 */
export interface Plugin extends DeployedEntity {
  plugin_id: string
  manifest: PluginManifest
  // The function names the manifest declares.
  functions: string[]
  // The WIT package version the component was built against (manifest `abi`).
  abi: string
  // The author's own version string from the manifest, informational.
  plugin_version: string
  // The detached Ed25519 signature over the component digest, base64.
  signature?: string | null
  tags: string[]
  /** `sha256:…` of the component bytes, when this browser could hash them. */
  component_digest?: string
  component_bytes?: number
}

// ── Orion 2.0: probes and runtime capabilities ──────────────────────────────

/** `GET /healthz`: liveness. Always `{status: "ok"}` while the process serves; it checks no dependency. */
export interface LivenessResponse {
  status: string
}

/**
 * `GET /readyz`: whether this node should take traffic (`ready` | `not_ready`,
 * 503 when not). In 2.0 it has its own shape, distinct from `/health`.
 */
export interface ReadinessResponse {
  status: "ready" | "not_ready" | (string & {})
  components: {
    /** `ok` | `error`. */
    database: string
    /** Always `ok`; kept for shape. */
    engine: string
    /** Whether startup has completed. */
    initialized: boolean
    /** `ok` | `degraded` | `error`. */
    background_tasks: string
    /** Each channel driver that runs its own listener (an edition's protocol, e.g. `kafka`), by protocol. */
    channel_drivers?: Record<string, string>
    /** The cluster's shared-state store (`orion-ext` with `[cluster]`), e.g. `{name: "redis", status: "ok"}`. */
    cluster_store?: { name: string; status: string } | null
  }
}

/** The edition a node runs, and the distribution tier a provider package declares — a ladder, in this order. */
export type EditionTier = "community" | "standard" | "enterprise"
export const EDITION_TIERS = ["community", "standard", "enterprise"] as const satisfies readonly EditionTier[]

/** The kind of a deployment member. */
export type EntityKind = "workflow" | "channel" | "connection" | "plugin"

/** A deployment member: an entity at a revision (`revision` ≥ 1). */
export interface EntityRef {
  kind: EntityKind
  id: string
  revision: number
}

/** The three connector provider implementation kinds. */
export type ImplementationKind = "rust" | "workflow" | "wasm"

/** What a channel driver declares (`runtime-capabilities.channel_driver_info[]`). */
export interface ChannelDriverInfo {
  protocol: string
  supports_sync: boolean
  supports_async: boolean
  registers_http_routes: boolean
  supports_oauth2_login: boolean
  /** The `orion-json-schema/1` document a channel's `transport_config` must satisfy, when the driver publishes one. */
  transport_schema?: Record<string, unknown> | null
  ingress_guards?: { rate_limit: boolean; validation: boolean; deduplication: boolean; backpressure: boolean } | null
  http_hook?: { validation: boolean; deduplication: boolean; backpressure: boolean } | null
}

/** One connector provider backend this node registers. */
export interface ProviderBackendInfo {
  kind: ImplementationKind
  /** A `rust` driver's id (`org.orion.postgresql`), or a `workflow`/`wasm` package's digest. */
  driver_id: string
  /** A `rust` driver's provider digest — what a connection revision over it names as `provider_digest`. */
  package_digest?: string | null
  /** The operations a `connector_call` may name, by canonical name, with their aliases and schemas. */
  operations?: Record<string, { aliases?: string[]; input_schema?: Record<string, unknown> | null; output_schema?: Record<string, unknown> | null }> | null
  /** The connections the backend calls beside its own, by alias: what a connection over it binds. */
  dependencies?: Record<string, { operations?: string[]; optional?: boolean; provider?: string | null }> | null
}

/** A deployment member this node could not serve, and why. */
export interface QuarantinedEntity {
  entity: EntityRef
  reason: string
}

/** This node's reconciler: what it serves and how it got there. */
export interface NodeStatus {
  node_id: string
  /** Changes on every process start. */
  boot_id: string
  /** The revision the node is converging on. */
  desired_revision: number
  /** The revision the node serves; `0` before it served any. */
  applied_revision: number
  applied_manifest_digest?: string | null
  /** Whether some member of the applied revision is quarantined. */
  configuration_degraded: boolean
  quarantined_entities: QuarantinedEntity[]
  /** Why the last attempt to build the desired revision failed, while it does. */
  last_error?: string | null
  backoff_attempt: number
  backoff_delay_ms: number
  security_lease_expires_at_ms: number
  /** The revisions the node keeps built, ascending. */
  retained_revisions: number[]
}

/**
 * `GET admin/runtime-capabilities` — answered **bare** (no `data` envelope).
 * What this node runs: the contract revision, the edition, its channel
 * drivers and provider backends, the deployment head it knows of, and its
 * reconciler's state. It replaces 1.x's `engine/status.capabilities` as the
 * one answer to "can this server do X".
 */
export interface RuntimeCapabilities {
  /** The contract revision (`2`). A client built for another should say so rather than guess. */
  api_version: number
  edition: EditionTier
  admission_policy_id: string
  /** The channel protocols this node serves (`rest`, `http`, `cron`, …). */
  channel_drivers: string[]
  channel_driver_info: ChannelDriverInfo[]
  schema_profiles: string[]
  /** The WebAssembly plugin worlds this node runs. */
  wasm_worlds: string[]
  provider_backends: ProviderBackendInfo[]
  /** `revision` is `0` before the first apply. */
  deployment_head: { revision: number; epoch: number }
  native_scheduler: { in_flight: number; max_in_flight: number }
  node_status: NodeStatus
}

// ── Orion 2.0: deployments and definitions ──────────────────────────────────

/** A rollout interval: the half-open bucket range `[start_bucket, end_bucket)` of a channel's traffic served by `workflow_revision`. */
export interface RolloutInterval {
  workflow_revision: number
  start_bucket: number
  end_bucket: number
}

/** One member of a manifest: an entity at a revision, what it is (a definition digest, or a connection revision's configuration digest), and what it needs. */
export interface ManifestMember {
  entity: EntityRef
  /** A workflow, channel or plugin's stored definition; a connection revision's `configuration_digest`. */
  definition_digest: string
  /** The members this one needs, each at the revision it uses. Absent means none. */
  requires?: EntityRef[]
  /** A channel's workflow rollout: disjoint intervals covering `[0, 100)` (Standard+). Absent means one workflow serves it all. */
  rollouts?: RolloutInterval[]
  /** The provider package (by digest, one of the manifest's `providers`) that owns this member. */
  owning_package?: string | null
}

/** A provider package a manifest pins. */
export interface ManifestProvider {
  publisher: string
  provider_id: string
  version: string
  digest: string
}

/** What a node serves: every member, all at once. Applying one replaces the head entirely. */
export interface DeploymentManifest {
  schema_version: number
  providers: ManifestProvider[]
  provider_lock_digest?: string | null
  members: ManifestMember[]
}

/** One committed revision, as the history lists it. */
export interface DeploymentRevisionSummary {
  revision: number
  /** The head it was committed on; absent for the first revision. */
  parent_revision?: number | null
  manifest_digest: string
  /** `0` once compacted. */
  member_count: number
  reason: string
  /** The admin key id that committed it. */
  created_by: string
  /** The collector dropped this revision's members: it can no longer be inspected or rolled back to. */
  members_compacted: boolean
  created_at: string
}

/** `GET admin/deployments/{revision}` (bare). A compacted revision's manifest has no members. */
export interface DeploymentRevision extends DeploymentRevisionSummary {
  manifest: DeploymentManifest
}

/**
 * `GET admin/deployments` (bare): one page of revisions, newest first, with
 * the head it was read against and the revision **this node** serves.
 */
export interface DeploymentsPage {
  head_revision: number
  epoch: number
  applied_revision: number
  data: DeploymentRevisionSummary[]
  limit: number
  next_cursor?: string | null
}

/** `GET admin/deployments/{revision}/convergence?target=` (bare). */
export interface ConvergenceStatus {
  converged: boolean
  target_revision: number
  converged_nodes: string[]
  pending_nodes: string[]
  degraded_nodes: string[]
}

/** `this-node`: the node that answered. `observed`: every node the cluster store has heard from. */
export type ConvergenceTarget = "this-node" | "observed"

/** `POST admin/deployments` with `rollback_to`: commit an earlier revision's manifest again as the next revision. */
export interface RollbackDeploymentRequest {
  idempotency_key: string
  /** The current head; anything else is `DEPLOYMENT_HEAD_CONFLICT` (409). */
  base_revision: number
  rollback_to: number
  /** The audit reason the revision records; `rollback` when absent. */
  reason?: string
}

/** The durable receipt of a committed apply or rollback. A replay of the same idempotency key answers the first one's. */
export interface DeploymentReceipt {
  operation_id: string
  idempotency_key: string
  principal: string
  request_hash: string
  committed_revision: number
  manifest_digest: string
  epoch: number
  /** The node that took the write: what `?target=this-node` waits on. */
  receiving_node_id: string
  created_at: string
}

/** `POST admin/deployments` (202, bare). */
export interface CreateDeploymentResponse {
  committed_revision: number
  receipt: DeploymentReceipt
  /** What committing this revision does not do — a rollback does not reverse an external effect, … */
  warnings: string[]
  /** This node's convergence on the committed revision, after it tried to build it. */
  evaluation: ConvergenceStatus
  /** Why this node could not build the committed revision, when it could not. The revision stays committed. */
  local_error?: string | null
}

/** `POST admin/deployment-plans` (bare): what a candidate changes against a base. Commits nothing; a read-only key may call it. */
export interface DeploymentPlan {
  base_revision: number
  reviewed_manifest_digest: string
  added_entities: EntityRef[]
  updated_entities: { kind: EntityKind; id: string; from_revision: number; to_revision: number }[]
  removed_entities: EntityRef[]
}

/** The definitions a member may name. A connection is not one: its member names a connection revision's configuration digest. */
export type DefinitionKind = "workflow" | "channel" | "plugin"

/** `GET admin/definitions/{digest}` (bare): a stored definition — no id, no version, no status. A channel's credentials come back masked. */
export interface StoredDefinition {
  kind: DefinitionKind
  definition: Record<string, unknown>
  /**
   * Client-side, a plugin's only: the component's facts. `useDefinition`
   * drops the base64 from `definition.component` (writing these facts in
   * its place) so no cache, viewer or diff ever holds the bytes.
   */
  component?: { size_bytes: number; digest?: string }
}

// ── Orion 2.0: connections and provider packages ────────────────────────────

/**
 * One immutable connection revision (bare). `provider_digest` names the
 * provider: a built-in Rust driver's `package_digest` from
 * `runtime-capabilities.provider_backends`, or an admitted provider package.
 * A deployment member for it names `configuration_digest`.
 */
export interface ConnectionRevision {
  connection_id: string
  revision: number
  provider_digest: string
  /** The settings, as created. Never a secret: the server refuses credential-shaped keys. */
  public_config: unknown
  /** Config path → where the secret is read from (`env://…`, `vault://…`). The value itself is never returned. */
  secret_locators: Record<string, string>
  /** Dependency alias → the connection it calls through (a provider that declares dependencies). */
  bindings: Record<string, string>
  /** Over the settings, the locators and the bindings: what a manifest member names. */
  configuration_digest: string
}

/** The normalised class of a connector failure; open for classes a later server adds. */
export type ConnectorErrorClass =
  | "invalid_input"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "deadline"
  | "cancelled"
  | "provider_failure"
  | "contract_violation"
  | (string & {})

/** What the host observed of an external effect, by uncertainty. */
export type EffectStatus = "not_started" | "completed" | "unknown" | (string & {})

/** `POST …/revisions/{rev}/probes` (bare). 200 whatever it found: `healthy` is the finding. */
export interface ConnectionProbe {
  connection_id: string
  revision: number
  /** The built-in driver, or the backend id of the provider package. */
  driver_id: string
  healthy: boolean
  latency_ms: number
  details: {
    /** The check: `configuration`, `SELECT 1`, `TCP connect to the URL's host`, … */
    probe: string
    error?: string | null
    error_class?: ConnectorErrorClass | null
    effect_status?: EffectStatus | null
  }
}

export type PackageArtifactState = "active" | "draining" | "deleted" | (string & {})

/** One file of a package's `inventory.json`. */
export interface PackageInventoryFile {
  path: string
  sha256: string
  size: number
}

/** A stored provider package, as the list carries it (bare). */
export interface ConnectorPackageSummary {
  publisher: string
  provider_id: string
  version: string
  /** `sha256:<64 hex>`: the package's identity. */
  digest: string
  implementation: ImplementationKind
  /** What `distribution.json` declares; `community` when it declares none. */
  tier: EditionTier
  /** Admitted and not revoked. */
  admitted: boolean
  revoked: boolean
  artifact_state: PackageArtifactState
  /** `connector.json`: operations, schemas, dependencies, payload limits. */
  manifest: Record<string, unknown>
  /** `distribution.json`. */
  distribution: Record<string, unknown>
  /** `inventory.json`. */
  inventory: { files?: PackageInventoryFile[] } & Record<string, unknown>
}

/** A package's admission record. An admission under another fingerprint is invalid. */
export interface ProviderAdmission {
  package_digest: string
  policy_id: string
  admission_fingerprint: string
  revoked: boolean
}

/** `GET admin/connector-packages/{digest}` and the upload's 201 (bare). */
export interface ConnectorPackage {
  package: ConnectorPackageSummary
  admission?: ProviderAdmission | null
}

/** A package's files: relative path → UTF-8 text or `base64:<…>`. */
export type PackageFiles = Record<string, string>

export interface UploadPackageRequest {
  files: PackageFiles
  /** Admit in the same request. */
  admit?: boolean
  /** With `admit`: the provider lock the admission must verify against. */
  lock?: unknown
}

export interface AdmitPackageResponse {
  admission: ProviderAdmission
}

export interface RevokePackageResponse {
  package_digest: string
  reason?: string | null
}

/** `POST admin/authoring/scaffold`. */
export interface ScaffoldRequest {
  publisher: string
  provider_id: string
  kind: ImplementationKind
  tier?: EditionTier
  /** Semantic version; `1.0.0` when absent. */
  version?: string
}

export interface ScaffoldResponse {
  files: PackageFiles
  implementation: ImplementationKind
  package_digest: string
  provider_id: string
  publisher: string
  version: string
}

/** `POST admin/authoring/lint`: 200 whenever linting ran; `valid` is the verdict. */
export interface LintResponse {
  valid: boolean
  /** Each problem, `CODE: where`. */
  errors: string[]
  implementation?: ImplementationKind | null
  provider_id?: string | null
  version?: string | null
}

/** `POST admin/authoring/pack`: the files, `inventory.json` included, and the digest an upload gets. */
export interface PackResponse {
  files: PackageFiles
  package_digest: string
}
