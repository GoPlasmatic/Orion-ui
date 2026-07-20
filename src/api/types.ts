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
  total: number
  limit: number
  offset: number
}

export interface DataResponse<T> {
  data: T
}

export interface StatusChangeRequest {
  status: EntityStatus
  // Accepted on workflow activation only; defaults to 100 server-side.
  rollout_percentage?: number
}

// Channel types
export type ChannelType = "sync" | "async"
export type ChannelProtocol = "rest" | "http" | "kafka"

// Trace storage mode (global default + per-channel override via config.tracing)
export type TraceStorageMode = "sync" | "async" | "batch" | "off"

export interface RateLimitConfig {
  requests_per_second?: number
  burst?: number
  key_logic?: JsonLogicValue
}

export interface BackpressureConfig {
  max_concurrent?: number
  queue_depth?: number
}

export interface CorsConfig {
  allowed_origins?: string[]
  allowed_methods?: string[]
  allowed_headers?: string[]
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
}

export interface ChannelTracingConfig {
  mode?: TraceStorageMode
  sample_rate?: number
  errors_only?: boolean
  task_details?: boolean
}

export interface ChannelConfig {
  rate_limit?: RateLimitConfig
  backpressure?: BackpressureConfig
  timeout_ms?: number
  cors?: CorsConfig
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
  created_at: string
  updated_at: string
}

export interface ListChannelsParams {
  limit?: number
  offset?: number
  status?: EntityStatus
  channel_type?: ChannelType
  protocol?: ChannelProtocol
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
}

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
  tasks: Task[]
  created_at: string
  updated_at: string
}

export interface ListWorkflowsParams {
  limit?: number
  offset?: number
  status?: EntityStatus
  tag?: string
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

// Bulk import (channels / connectors / workflows)
export interface ImportError {
  index: number
  error: string
}

export interface ImportResult {
  dry_run?: boolean
  imported: number
  failed: number
  would_create?: number
  would_fail?: number
  errors: ImportError[]
}

// Connector types
export type ConnectorType = "http" | "kafka" | "db" | "cache" | "storage" | "es"

// Per-operation gates on db/es connectors (v0.3). All default true server-side;
// `read` gates data_query/db_read/mongo_read, the write flags gate the matching
// data_write operations, and `raw_write` gates the db_write raw-SQL escape hatch.
export interface OperationGates {
  read?: boolean
  insert?: boolean
  update?: boolean
  delete?: boolean
  upsert?: boolean
  raw_write?: boolean
}

export interface Connector {
  id: string
  name: string
  connector_type: ConnectorType
  // JSON string of the connector config, with secrets masked. Parse to display.
  config_json: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface ListConnectorsParams {
  limit?: number
  offset?: number
}

export interface CreateConnectorRequest {
  id?: string
  name: string
  connector_type: ConnectorType
  config: Record<string, unknown>
}

export interface UpdateConnectorRequest {
  name?: string
  connector_type?: ConnectorType
  config?: Record<string, unknown>
  enabled?: boolean
}

// Connector circuit breakers: { enabled, breakers: { "channel:connector": "closed" | "open" | "half_open" } }
export interface CircuitBreakerStatus {
  enabled: boolean
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

export interface HealthResponse {
  status: string
  components: Record<string, string>
  connectors: Record<string, unknown>
  workflows_loaded: number
  uptime_seconds: number
  version: string
}

// Trace types
export type TraceStatus = "pending" | "running" | "completed" | "failed"

export interface Trace {
  id: string
  channel: string
  channel_id?: string | null
  status: string
  mode: string
  error_message: string | null
  result_json: string | null
  input_json: string | null
  duration_ms: number | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string
  task_trace_json?: string | null
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

export interface ListTracesParams {
  limit?: number
  offset?: number
  status?: string
  channel?: string
  mode?: string
  sort_by?: TraceSortBy
  sort_order?: SortOrder
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

// The server's audit-logs endpoint supports pagination only; action /
// resource-type filtering is done client-side (see pages/audit.tsx).
export interface ListAuditLogsParams {
  limit?: number
  offset?: number
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

// Workflow function registry (GET admin/functions) — per-function input schemas.
export type FunctionFieldKind = "string" | "number" | "bool" | "object" | "array" | "any"

export interface FunctionFieldSchema {
  name: string
  description: string
  kind: FunctionFieldKind
  required: boolean
}

export interface FunctionSchema {
  name: string
  description: string
  category: string
  input_fields: FunctionFieldSchema[]
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

export interface ProcessResponse {
  id?: string
  status?: string
  data?: Record<string, unknown>
  errors?: unknown[]
  _orion?: { profile?: ProfileResult }
  [key: string]: unknown
}
