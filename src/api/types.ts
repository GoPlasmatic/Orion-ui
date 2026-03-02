// Rule types
export type RuleStatus = "active" | "paused" | "archived"

export interface Rule {
  rule_id: string
  name: string
  description: string | null
  channel: string
  priority: number
  status: RuleStatus
  version: number
  tags: string
  condition_json: string | null
  continue_on_error: boolean
  tasks_json: string
  rollout_percentage: number
  created_at: string
  updated_at: string
}

export interface ListRulesParams {
  limit?: number
  offset?: number
  status?: RuleStatus
  channel?: string
  tag?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  limit: number
  offset: number
}

export interface StatusChangeRequest {
  status: RuleStatus
  version?: number
  rollout_percentage?: number
}

export interface TestRuleRequest {
  data: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface TestRuleResponse {
  success: boolean
  result: Record<string, unknown>
  trace: TraceStep[]
  duration_ms: number
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

// Connector types
export interface Connector {
  id: string
  name: string
  connector_type: string
  enabled: boolean
  config_json: string
  created_at: string
  updated_at: string
}

export interface ListConnectorsParams {
  limit?: number
  offset?: number
}

// Engine types
export interface EngineStatus {
  rules_count: number
  active_rules: number
  paused_rules: number
  channels: string[]
  uptime_seconds: number
  version: string
}

export interface HealthResponse {
  status: string
  components: Record<string, string>
  connectors: Record<string, unknown>
  rules_loaded: number
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
export type SortOrder = "asc" | "desc"

export interface ListTracesParams {
  limit?: number
  offset?: number
  status?: string
  channel?: string
  mode?: string
  sort_by?: TraceSortBy
  sort_order?: SortOrder
}

// Data types
export interface ProcessRequest {
  data: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface ProcessResponse {
  [key: string]: unknown
}
