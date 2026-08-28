// Shared types
export type EntityStatus = "draft" | "active" | "archived"
export type SortOrder = "asc" | "desc"

export type JsonLogicValue =
  | string
  | number
  | boolean
  | null
  | JsonLogicValue[]
  | { [key: string]: JsonLogicValue }

export interface PaginatedResponse<T> {
  data: T[]
  // Every list endpoint returns `total` except the trace list, which makes it
  // opt-in via `?include_total=true` (the count is a full scan of the filtered
  // set). Treat an absent total as "unknown", not as zero.
  total?: number
  limit: number
  offset: number
}

export interface DataResponse<T> {
  data: T
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

export interface StatusChangeRequest {
  status: EntityStatus
  // Accepted on workflow activation only; defaults to 100 server-side.
  rollout_percentage?: number
}

// `?reload=` on the status and rollout endpoints. `defer` commits the row but
// leaves the running engine (and every peer) on the previous configuration
// until POST admin/engine/reload — one rebuild for a whole bundle apply.
export type ReloadMode = "now" | "defer"

// `?on_conflict=` on the import endpoints: what an already-stored conflict key
// means. `new_version` is the upsert mode that makes re-importing an unchanged
// artifact a no-op.
export type OnConflict = "fail" | "skip" | "new_version"

export interface StatusChangeOptions {
  // Runs every gate the real transition runs and answers the /validate
  // envelope without writing. Gates that would 4xx are reported as `errors`.
  dryRun?: boolean
  reload?: ReloadMode
}

export interface ImportOptions {
  dryRun?: boolean
  onConflict?: OnConflict
}

// Channel types
export type ChannelType = "sync" | "async"
export type ChannelProtocol = "rest" | "http" | "kafka"

// Trace storage mode (global default + per-channel override via config.tracing)
export type TraceStorageMode = "sync" | "async" | "batch" | "off"

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
  // Keyed by HTTP status ("400"–"599") plus an optional "default".
  error_bodies?: Record<string, ChannelErrorBody>
}

export interface CacheConfig {
  enabled?: boolean
  ttl_secs?: number
  cache_key_fields?: string[]
  connector?: string
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

// Every key is optional; an empty `{}` is a channel with no guards of its own.
// Unknown keys are REFUSED since 1.0 (they used to be silently ignored), so a
// retired spelling is a 400 with an UNKNOWN_FIELD detail, not a no-op.
export interface ChannelConfig {
  auth?: ChannelAuthConfig
  rate_limit?: RateLimitConfig
  backpressure?: BackpressureConfig
  timeout_ms?: number
  origin_allow_list?: string[]
  request?: ChannelRequestConfig
  response?: ChannelResponseConfig
  validation_logic?: JsonLogicValue
  cache?: CacheConfig
  deduplication?: DeduplicationConfig
  tracing?: ChannelTracingConfig
}

export interface Channel {
  channel_id: string
  name: string
  description: string | null
  channel_type: ChannelType
  protocol: ChannelProtocol
  route_pattern: string | null
  methods: string[] | null
  topic: string | null
  consumer_group: string | null
  transport_config: Record<string, unknown>
  workflow_id: string | null
  config: ChannelConfig
  status: EntityStatus
  version: number
  priority: number
  tags: string[]
  // sha256:… over the canonical importable content, excluding the DB-owned
  // fields. Equal hashes mean importing one over the other is a no-op.
  content_hash: string
  created_at: string
  updated_at: string
}

export interface ListChannelsParams {
  limit?: number
  offset?: number
  status?: EntityStatus
  channel_type?: ChannelType
  protocol?: ChannelProtocol
  tag?: string
  sort_by?: string
  sort_order?: SortOrder
}

export interface ExportChannelsParams {
  status?: EntityStatus
  channel_type?: ChannelType
  protocol?: ChannelProtocol
  tag?: string
  limit?: number
  offset?: number
  sort_by?: string
  sort_order?: SortOrder
}

export interface CreateChannelRequest {
  channel_id?: string
  name: string
  description?: string
  channel_type: ChannelType
  protocol: ChannelProtocol
  methods?: string[]
  route_pattern?: string
  topic?: string
  consumer_group?: string
  transport_config?: Record<string, unknown>
  workflow_id?: string
  config?: ChannelConfig
  priority?: number
  tags?: string[]
}

export interface UpdateChannelRequest {
  name?: string
  description?: string
  methods?: string[]
  route_pattern?: string
  topic?: string
  consumer_group?: string
  transport_config?: Record<string, unknown>
  workflow_id?: string
  config?: ChannelConfig
  priority?: number
  tags?: string[]
}

export interface ChannelVersion {
  version: number
  status: EntityStatus
  created_at: string
}

// Workflow types
export interface TaskFunction {
  name: string
  input?: Record<string, unknown>
}

export interface Task {
  id: string
  name: string
  description?: string
  condition?: JsonLogicValue
  function: TaskFunction
  continue_on_error?: boolean
  // End the workflow once this task has run (dataflow-rs 3.6+). A statement
  // about *position*, not outcome: a false `condition` does not halt, but a
  // task that failed under `continue_on_error` still does.
  terminal?: boolean
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

/** One element of a workflow's `tasks` array: a task, or a group of them. */
export type Step = Task | TaskGroup

export interface Workflow {
  workflow_id: string
  name: string
  description: string | null
  priority: number
  tags: string[]
  condition?: JsonLogicValue
  continue_on_error?: boolean
  status: EntityStatus
  version: number
  rollout_percentage?: number
  // Each element is a `Task` or a `TaskGroup` — use `flattenSteps` for the
  // leaf tasks the engine actually runs.
  tasks: Step[]
  // The engine-managed loop over `tasks`, absent for a workflow that runs its
  // tasks once.
  loop?: unknown
  content_hash: string
  created_at: string
  updated_at: string
}

// What a workflow's tasks reference. The server walks the latest version's
// tasks, so this is authoritative where client-side task parsing is a guess.
export interface ConnectorDependency {
  connector: string
  // The task function that uses it (`db_read`, `http_call`, …).
  function: string
}

export interface WorkflowDependencies {
  workflow_id: string
  version: number
  connectors: ConnectorDependency[]
  // Channel names targeted by `channel_call` tasks, statically.
  channels: string[]
  // True when a `channel_call` resolves its target with `channel_logic` at
  // runtime — the case static analysis cannot see.
  has_dynamic_channel_calls: boolean
}

export interface ListWorkflowsParams {
  limit?: number
  offset?: number
  status?: EntityStatus
  tag?: string
  sort_by?: string
  sort_order?: SortOrder
}

export interface CreateWorkflowRequest {
  workflow_id?: string
  name: string
  description?: string
  priority?: number
  condition?: JsonLogicValue
  tasks: unknown[]
  tags?: string[]
  continue_on_error?: boolean
}

export interface UpdateWorkflowRequest {
  name?: string
  description?: string
  priority?: number
  condition?: JsonLogicValue
  tasks?: unknown[]
  tags?: string[]
  continue_on_error?: boolean
}

export interface WorkflowTestRequest {
  data: Record<string, unknown>
  metadata?: Record<string, unknown>
}

// dataflow-rs 3.0 per-task execution trace.
// `result` is lowercase on the wire ("executed" | "skipped" | "error"); each step
// carries a `message` snapshot of the message state after that task.
export type ExecutionStepResult = "executed" | "skipped" | "error" | string

export interface ExecutionStepMessage {
  id?: string
  payload?: unknown
  context?: { data?: unknown; metadata?: unknown; [key: string]: unknown }
  [key: string]: unknown
}

export interface ExecutionStep {
  task_id?: string
  task_name?: string
  workflow_id?: string
  function?: string
  result?: ExecutionStepResult
  duration_ms?: number
  error?: unknown
  input?: unknown
  output?: unknown
  message?: ExecutionStepMessage
  [key: string]: unknown
}

export interface ExecutionTrace {
  steps: ExecutionStep[]
  [key: string]: unknown
}

export interface WorkflowTestResponse {
  matched: boolean
  trace: ExecutionTrace
  output: Record<string, unknown>
  errors: unknown[]
}

export interface WorkflowVersion {
  version: number
  status: EntityStatus
  created_at: string
}

export interface WorkflowRolloutRequest {
  rollout_percentage: number
}

// Workflow validation
export interface ValidationIssue {
  field: string
  message: string
}

export interface ValidationResponse {
  valid: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

// Bulk import (channels / connectors / workflows).
// At most 1000 items per request; above that the server answers 400.
export interface ImportError {
  index: number
  error: string
}

// What one item did, or on a dry run would do.
export type ImportAction =
  | "created"
  | "updated_draft"
  | "updated"
  | "new_version"
  | "unchanged"
  | "skipped"
  | (string & {})

export interface ImportItemResult {
  index: number
  // The item's conflict key (workflow_id / channel_id / connector name).
  id: string | null
  action: ImportAction
}

// Since 1.0 a dry run reports in the same fields as a real run — the old
// `would_create` / `would_fail` pair is gone.
export interface ImportResult {
  dry_run: boolean
  imported: number
  failed: number
  // Content-identical items under on_conflict=new_version: nothing written.
  unchanged: number
  // Items skipped under on_conflict=skip.
  skipped: number
  errors: ImportError[]
  results: ImportItemResult[]
}

// Connector types. `smtp` is the sixth type, added in 1.1.
export type ConnectorType = "http" | "kafka" | "db" | "cache" | "storage" | "es" | "smtp"

/**
 * Per-operation gates. All default true server-side except
 * `aggregate_write_stages`, which is the one deliberate default-deny.
 * The gate set differs per connector type — see CONNECTOR_GATES.
 */
export interface OperationGates {
  // db / es
  read?: boolean
  insert?: boolean
  update?: boolean
  delete?: boolean
  upsert?: boolean
  raw_write?: boolean
  // cache
  write?: boolean
  // kafka
  publish?: boolean
  // storage
  presign_get?: boolean
  presign_put?: boolean
  head?: boolean
  // http: an allow-list of methods, not a boolean
  methods?: string[]
}

export type BooleanGate = Exclude<keyof OperationGates, "methods">

// Which gates apply to which connector type. `http` gates by method allow-list
// rather than by boolean, so it carries no boolean gates.
export const CONNECTOR_GATES: Record<ConnectorType, BooleanGate[]> = {
  db: ["read", "insert", "update", "delete", "upsert", "raw_write"],
  es: ["read", "insert", "update", "delete", "upsert", "raw_write"],
  cache: ["read", "write"],
  kafka: ["publish"],
  storage: ["presign_get", "presign_put", "head"],
  http: [],
  smtp: [],
}

// Why a connector failed to load, when `load_status === "failed"`.
export type ConnectorLoadStatus = "loaded" | "failed" | "disabled"

export interface Connector {
  id: string
  name: string
  connector_type: ConnectorType
  // The parsed masked config — the shape POST/PUT accept, so a read response
  // can be edited and written straight back. Prefer this over config_json.
  config: Record<string, unknown>
  // The stored document verbatim as a string, secrets masked. Kept for the
  // life of the 1.x line; a client reading it has to parse before writing back.
  config_json: string
  enabled: boolean
  tags: string[]
  content_hash: string
  created_at: string
  updated_at: string
}

// The list endpoint additionally reports why a connector is not serving.
export interface ConnectorListItem extends Connector {
  load_status: ConnectorLoadStatus
  load_error?: string | null
  load_error_stage?: string | null
}

// The shape /import accepts, secrets masked. Only env:// and vault://
// references round-trip; a literal credential exports as "******" and is
// refused on import.
export interface ConnectorExportItem {
  id: string
  name: string
  connector_type: ConnectorType
  config: Record<string, unknown>
  enabled: boolean
  tags: string[]
  content_hash: string
}

export interface ListConnectorsParams {
  limit?: number
  offset?: number
  tag?: string
  sort_by?: string
  sort_order?: SortOrder
}

export interface ExportConnectorsParams {
  tag?: string
  limit?: number
  offset?: number
  sort_by?: string
  sort_order?: SortOrder
}

export interface CreateConnectorRequest {
  id?: string
  name: string
  connector_type: ConnectorType
  config: Record<string, unknown>
  tags?: string[]
}

export interface UpdateConnectorRequest {
  name?: string
  connector_type?: ConnectorType
  config?: Record<string, unknown>
  enabled?: boolean
  tags?: string[]
}

/**
 * Connector reachability probe. A backend that cannot be reached is still a
 * 200 — the probe ran, and `reachable: false` is its answer.
 *
 * `supported: false` means no probe exists for this kind (`es`, `kafka`, or a
 * `db` connector pointing at MongoDB), so key "broken" on
 * `supported && !reachable`, never on `reachable` alone.
 *
 * The `http` probe issues one genuine request with genuine credentials; a
 * 401/403 is reported as NOT reachable, which is the failure it exists to find.
 */
export interface ProbeResult {
  reachable: boolean
  supported: boolean
  connector_type: ConnectorType
  // What the probe did, named plainly, e.g. "SELECT 1".
  probe: string
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
export interface EngineStatus {
  workflows_count: number
  active_workflows: number
  channels: string[]
  uptime_seconds: number
  version: string
}

export interface EngineReloaded {
  reloaded: boolean
  workflows_count: number
}

export interface ChannelLoadIssue {
  channel: string
  reason: string
}

export interface HealthResponse {
  // "ok" | "degraded"
  status: string
  // Per-subsystem state: database, engine, connectors, channels, plus kafka
  // when enabled and cluster_redis in cluster mode.
  components: Record<string, string>
  /**
   * Connector health. `failed_to_load` names connectors the engine could not
   * bring up, so every task using one is failing right now.
   *
   * The spec's `HealthStatus` schema declares only status/version/
   * uptime_seconds/components — the rest of this body is served but
   * undocumented, which is why these are optional and the index signature
   * stays. Verified against a live 1.2.0 server.
   */
  connectors: {
    circuit_breaker_scope?: string
    circuit_breakers?: Record<string, string>
    failed_to_load?: string[]
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
     */
    quarantined?: ChannelLoadIssue[]
    [key: string]: unknown
  }
  workflows_loaded: number
  uptime_seconds: number
  version: string
  // Build provenance, served only to an admin caller.
  git_hash?: string | null
  build_timestamp?: string | null
}

// Trace types
export type TraceStatus = "pending" | "running" | "completed" | "failed"

/**
 * One row of the trace list. Since 1.0 the list is a payload-free projection:
 * `task_trace_json`, `input_json` and `result_json` are NOT returned here, so
 * one request cannot dump every request's body. Fetch a single trace by id for
 * the payload and the per-task trace.
 */
export interface Trace {
  id: string
  channel: string
  channel_id?: string | null
  status: string
  mode: string
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
  mode: string
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

export type TraceSortBy = "created_at" | "updated_at" | "status" | "channel" | "mode"

/**
 * The trace list is the one endpoint that deviates from the shared pagination
 * contract: `total` is opt-in and there is a second, keyset paging mode.
 *
 * Three combinations are 400s:
 *  - `cursor` together with `offset` (two paging modes)
 *  - `cursor` with any `sort_by` other than the default `created_at`
 *  - a `cursor` value that did not come from a `next_cursor`
 *
 * Note `buildQuery` serializes `offset: 0`, so cursor mode must pass
 * `offset: undefined` explicitly rather than relying on a falsy value.
 */
export interface ListTracesParams {
  limit?: number
  offset?: number
  // Opaque; pass a next_cursor back unmodified.
  cursor?: string
  // Off by default: the count is a full scan of the filtered set.
  include_total?: boolean
  status?: string
  channel?: string
  mode?: string
  sort_by?: TraceSortBy
  sort_order?: SortOrder
}

export interface TracePage {
  data: Trace[]
  limit: number
  offset: number
  // Present only with include_total=true.
  total?: number | null
  // Present only while a further page may exist; its absence is how you know
  // you have reached the end. Treat the value as opaque.
  next_cursor?: string | null
}

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
export interface ListAuditLogsParams {
  limit?: number
  offset?: number
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
  modified_at: string
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
  // Another accepted spelling of the field name, or null.
  alias: string | null
}

// `orion` — a handler Orion implements and input-schema validates at create
// time. `engine` — a dataflow-rs built-in the engine executes itself, which
// declares no input schema.
export type FunctionSource = "orion" | "engine" | (string & {})

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
  // Other accepted spellings — `validation` carries `validate`. Omitted when
  // there are none, so the catalogue lists one row per function rather than
  // telling a completion tool there are two.
  aliases?: string[]
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
 * TASK_ERROR still as the fallback for an engine-owned error.
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

export interface TraceDlqEntry extends TraceDlqSummary {
  payload_json: string
  metadata_json: string
}

export interface ListTraceDlqParams {
  limit?: number
  offset?: number
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

// --- Package promotion receipts --------------------------------------------
// One receipt per package version. An applied version is immutable: the same
// version arriving with a different content hash is refused with a 409.

export type PackageState = "staged" | "applied"

export interface PackageReceipt {
  name: string
  version: string
  content_hash: string
  state: PackageState
  // Who recorded this receipt (admin key id, or "anonymous").
  principal: string
  created_at: string
  updated_at: string
}

export interface PackageDetail {
  name: string
  // The newest applied version, or null when nothing has been applied.
  current: PackageReceipt | null
  // Every receipt for this package, newest first.
  versions: PackageReceipt[]
}

export interface ListPackagesParams {
  limit?: number
  offset?: number
}
