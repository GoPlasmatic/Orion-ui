import type { FunctionSchema, RetrySafetyKind, Task } from "@/api/types"

/**
 * What a task *does* to the world: the one answer to "what does this step
 * touch, and how", for every page that asks it — the trace timeline's "uses"
 * column, the workflow lenses, the System Map's references, the retry guard.
 *
 * Before this module four tables answered it and disagreed (`cache_delete` was
 * a delete on one page and a write on the next; an `http_call` GET counted as
 * a write a retry repeats). The function catalogue (`GET admin/functions`) is
 * the authority: `category: "connector"` says a function names a connector,
 * `source: "plugin"` + `plugin` say whose it is, and `retry_safety` says what
 * a second run does. The built-in tables below are only the fallback for a
 * render before the catalogue has loaded, and the vocabulary for the *verb*
 * shown to a person, which the catalogue does not carry.
 */

/** A function catalogue indexed by name and every alias. */
export type FunctionIndex = ReadonlyMap<string, FunctionSchema>

const indexCache = new WeakMap<readonly FunctionSchema[], FunctionIndex>()

/** Index the catalogue once per catalogue array — `useFunctions` data is stable between fetches. */
export function functionIndex(catalogue: readonly FunctionSchema[] | null | undefined): FunctionIndex {
  if (!catalogue) return EMPTY
  const hit = indexCache.get(catalogue)
  if (hit) return hit
  const m = new Map<string, FunctionSchema>()
  for (const fn of catalogue) {
    m.set(fn.name, fn)
    for (const alias of fn.aliases ?? []) m.set(alias, fn)
  }
  indexCache.set(catalogue, m)
  return m
}
const EMPTY: FunctionIndex = new Map()

/**
 * The built-in functions that take a connector — the server's
 * `the_connector_bearing_functions_are_exactly_these` list. Used only when the
 * catalogue has not loaded; with it, `category === "connector"` decides.
 */
export const CONNECTOR_FUNCTIONS: ReadonlySet<string> = new Set([
  "cache_delete",
  "cache_incr",
  "cache_read",
  "cache_write",
  "data_query",
  "data_write",
  "db_read",
  "db_write",
  "http_call",
  "mongo_aggregate",
  "mongo_read",
  "mongo_write",
  "publish_kafka",
  "send_email",
  "storage_head",
  "storage_presign",
])

/** The input keys a connector name is read from, first match wins. */
export const CONNECTOR_KEYS = ["connector", "connector_name", "connector_id"] as const

/**
 * The verb a person reads for a function. `http_call` reads its method and
 * `data_write`/`mongo_write` their `op` when those are literal (see `stepEffect`).
 */
const VERB: Record<string, StepOp> = {
  cache_read: "read",
  cache_write: "write",
  cache_delete: "delete",
  cache_incr: "incr",
  db_read: "read",
  db_write: "write",
  data_query: "read",
  data_write: "write",
  mongo_read: "read",
  mongo_aggregate: "read",
  mongo_write: "write",
  http_call: "call",
  send_email: "send",
  publish_kafka: "publish",
  storage_presign: "presign",
  storage_head: "read",
  channel_call: "call",
  model_infer: "infer",
  cache_invalidate: "invalidate",
  filter: "gate",
}

export type StepOp =
  | "read"
  | "write"
  | "delete"
  | "incr"
  | "call"
  | "send"
  | "publish"
  | "presign"
  | "infer"
  | "invalidate"
  | "gate"
  | "compute"
  | (string & {})

export type ResourceKind = "connector" | "channel" | "model" | "plugin"

export interface StepResource {
  kind: ResourceKind
  /** Connector / channel / model name, or the plugin id. Null when computed per message. */
  name: string | null
  /** The target is JSONLogic evaluated per message, not a literal. */
  dynamic: boolean
  /** A plugin's version, from the catalogue's binding. */
  version?: number
}

/**
 * What a second run of a task does, with `depends_on` resolved against the
 * task's own input where it is a literal: an `http_call` GET is a `read`, a
 * `data_write` upsert an `idempotent_write`, an INSERT `unsafe_write`.
 * `unknown` when the deciding input is computed, absent, or a `channel_call`
 * (whose answer is the target workflow's, not this task's).
 */
export type RetryEffect = Exclude<RetrySafetyKind, "depends_on"> | "unknown"

export interface StepEffect {
  /** The function name as written. */
  fn: string
  op: StepOp
  resource: StepResource | null
  /** A `filter`: it can only halt the run. */
  gate: boolean
  retry: RetryEffect
  /** For an unresolved `depends_on`, the input that decides it. */
  decidedBy?: string
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])
const IDEMPOTENT_METHODS = new Set(["PUT", "DELETE"])
const READ_OPS = new Set(["find", "find_one", "read", "get", "query", "count", "aggregate", "select"])
const IDEMPOTENT_OPS = new Set(["upsert", "replace", "update", "update_one", "update_many", "delete", "delete_one", "delete_many", "set", "merge"])
const UNSAFE_OPS = new Set(["insert", "insert_one", "insert_many", "create", "append", "push"])

/** Resolve a `depends_on` input value to what a retry does. Exported for tests. */
export function resolveDependsOn(input: string, value: unknown): RetryEffect {
  if (typeof value !== "string" || value.trim() === "") return "unknown"
  const v = value.trim()
  switch (input) {
    case "method": {
      const m = v.toUpperCase()
      if (SAFE_METHODS.has(m)) return "read"
      if (IDEMPOTENT_METHODS.has(m)) return "idempotent_write"
      return "unsafe_write"
    }
    case "op": {
      const op = v.toLowerCase()
      if (READ_OPS.has(op)) return "read"
      if (IDEMPOTENT_OPS.has(op)) return "idempotent_write"
      if (UNSAFE_OPS.has(op)) return "unsafe_write"
      return "unknown"
    }
    case "sql": {
      // The statement's first keyword, past comments and a CTE head.
      const sql = v.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim().toUpperCase()
      const head = /^WITH\b[\s\S]*?\)\s*(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/.exec(sql)?.[1] ?? sql.split(/\s+/)[0]
      if (head === "SELECT" || head === "SHOW" || head === "EXPLAIN") return "read"
      if (head === "INSERT") return /\bON\s+(CONFLICT|DUPLICATE\s+KEY)\b/.test(sql) ? "idempotent_write" : "unsafe_write"
      if (head === "UPDATE" || head === "DELETE" || head === "MERGE" || head === "UPSERT" || head === "REPLACE") return "idempotent_write"
      return "unknown"
    }
    default:
      return "unknown"
  }
}

function connectorName(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null
  for (const key of CONNECTOR_KEYS) {
    const v = input[key]
    if (typeof v === "string" && v) return v
  }
  return null
}

/** Whether a function names a connector: the catalogue says so, else the built-in list. */
export function takesConnector(fn: string, index: FunctionIndex = EMPTY): boolean {
  const entry = index.get(fn)
  return entry ? entry.category === "connector" : CONNECTOR_FUNCTIONS.has(fn)
}

/**
 * Everything a page needs to say about one task's effect. Pass the catalogue
 * index whenever it is loaded; without it plugins are not recognised and
 * `retry` falls back to `unknown` for every function the tables do not know.
 */
export function stepEffect(task: Pick<Task, "function">, index: FunctionIndex = EMPTY): StepEffect {
  const fn = task.function?.name ?? ""
  const input = (task.function?.input ?? undefined) as Record<string, unknown> | undefined
  const entry = index.get(fn)
  const canonical = entry?.name ?? fn

  let resource: StepResource | null = null
  if (takesConnector(canonical, index)) {
    const name = connectorName(input)
    resource = { kind: "connector", name, dynamic: name == null && input != null && CONNECTOR_KEYS.some((k) => input[k] != null) }
  } else if (canonical === "channel_call") {
    const target = input?.channel ?? input?.channel_logic
    resource = { kind: "channel", name: typeof target === "string" ? target : null, dynamic: target != null && typeof target !== "string" }
  } else if (canonical === "model_infer") {
    const model = input?.model
    resource = { kind: "model", name: typeof model === "string" ? model : null, dynamic: model != null && typeof model !== "string" }
  } else if (entry?.source === "plugin" && entry.plugin) {
    resource = { kind: "plugin", name: entry.plugin.id, dynamic: false, version: entry.plugin.version }
  }

  let op: StepOp = VERB[canonical] ?? (resource?.kind === "plugin" ? "call" : "compute")
  // A literal method or op is the more specific verb.
  if (canonical === "http_call" && typeof input?.method === "string") op = input.method.toLowerCase()
  if ((canonical === "data_write" || canonical === "mongo_write") && typeof input?.op === "string") op = input.op

  const safety = entry?.retry_safety
  let retry: RetryEffect = "unknown"
  let decidedBy: string | undefined
  if (safety) {
    if (safety.kind === "depends_on") {
      decidedBy = safety.input
      retry = canonical === "channel_call" ? "unknown" : resolveDependsOn(safety.input ?? "", input?.[safety.input ?? ""])
    } else if (["pure", "read", "idempotent_write", "unsafe_write"].includes(safety.kind)) {
      retry = safety.kind as RetryEffect
    }
  } else if (canonical === "filter" || canonical === "map" || canonical === "log" || canonical === "validation") {
    retry = "pure"
  }

  return { fn, op, resource, gate: canonical === "filter", retry, decidedBy: retry === "unknown" ? decidedBy : undefined }
}

/**
 * Whether running this task again may repeat an effect: an `unsafe_write`, or
 * a `depends_on` whose deciding input is not a literal the client can read.
 * `idempotent_write` lands the same state twice and is not a risk.
 */
export function isRetryRisk(effect: Pick<StepEffect, "retry">): boolean {
  return effect.retry === "unsafe_write" || effect.retry === "unknown"
}

/** Whether a task changes state outside the message (any write, known or possible). */
export function isWrite(effect: Pick<StepEffect, "retry">): boolean {
  return effect.retry === "unsafe_write" || effect.retry === "idempotent_write" || effect.retry === "unknown"
}

/** The words for a retry effect, shared with `RetrySafetyBadge`. */
export const RETRY_EFFECT_LABEL: Record<RetryEffect, string> = {
  pure: "pure",
  read: "read only",
  idempotent_write: "idempotent write",
  unsafe_write: "unsafe to retry",
  unknown: "depends on its input",
}
