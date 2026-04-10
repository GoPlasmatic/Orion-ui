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
}

// Channel types
export type ChannelType = "sync" | "async"
export type ChannelProtocol = "http" | "rest" | "kafka"

export interface RateLimitConfig {
  rps?: number
  burst?: number
  key_logic?: JsonLogicValue
}

export interface BackpressureConfig {
  max_concurrent?: number
}

export interface CorsConfig {
  origins?: string[]
}

export interface CacheConfig {
  enabled?: boolean
  ttl_secs?: number
  cache_key_fields?: string[]
}

export interface DeduplicationConfig {
  header?: string
  retention_secs?: number
}

export interface ChannelConfig {
  rate_limit?: RateLimitConfig
  backpressure?: BackpressureConfig
  timeout_ms?: number
  cors?: CorsConfig
  validation_logic?: JsonLogicValue
  cache?: CacheConfig
  deduplication?: DeduplicationConfig
}

export interface Channel {
  channel_id: string
  name: string
  description: string | null
  channel_type: ChannelType
  protocol: ChannelProtocol
  route_pattern: string | null
  methods: string[]
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
  name: string
  channel_type: ChannelType
  protocol: ChannelProtocol
  route_pattern?: string
  methods?: string[]
  workflow_id?: string
  config?: ChannelConfig
}

export interface UpdateChannelRequest {
  name?: string
  channel_type?: ChannelType
  protocol?: ChannelProtocol
  route_pattern?: string
  methods?: string[]
  workflow_id?: string
  config?: ChannelConfig
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

export interface WorkflowTestRequest {
  data: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface TraceStep {
  task_id: string
  task_name: string
  function: string
  status: "executed" | "skipped" | "error"
  duration_ms: number
  error?: string
  output?: Record<string, unknown>
}

export interface WorkflowTestResponse {
  success: boolean
  result: Record<string, unknown>
  trace: TraceStep[]
  duration_ms: number
}

export interface WorkflowVersion {
  version: number
  status: EntityStatus
  created_at: string
}

export interface WorkflowRolloutRequest {
  rollout_percentage: number
}

// Connector types
export type ConnectorType = "http" | "kafka" | "db" | "cache" | "mongo" | "storage"

export interface Connector {
  id: string
  name: string
  connector_type: ConnectorType
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ListConnectorsParams {
  limit?: number
  offset?: number
  connector_type?: ConnectorType
}

export interface CreateConnectorRequest {
  name: string
  connector_type: ConnectorType
  config: Record<string, unknown>
}

export interface UpdateConnectorRequest {
  name?: string
  connector_type?: ConnectorType
  config?: Record<string, unknown>
}

export interface CircuitBreaker {
  key: string
  state: string
  failure_count?: number
  last_failure?: string
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
}

export interface AuditChange {
  path: string
  old_value: unknown
  new_value: unknown
}

export interface AuditTrailEntry {
  workflow_id: string
  task_id: string
  timestamp: string
  status: number
  changes: AuditChange[]
}

export interface TraceMessage {
  id: string
  payload: Record<string, unknown>
  context: Record<string, unknown>
  audit_trail: AuditTrailEntry[]
  errors: unknown[]
}

export interface TraceDetail {
  id: string
  status: string
  mode: string
  duration_ms: number | null
  message: TraceMessage | null
  created_at: string
  started_at: string | null
  completed_at: string | null
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
  action: string
  resource_type: string
  resource_id: string
  details?: Record<string, unknown>
  timestamp: string
  user?: string
}

export interface ListAuditLogsParams {
  limit?: number
  offset?: number
  action?: string
  resource_type?: string
}

// Data types
export interface ProcessRequest {
  data: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface ProcessResponse {
  [key: string]: unknown
}
