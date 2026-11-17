import type { ConnectorErrorDetail, DataResponse, ErrorFieldDetail } from "./types"
import {
  credentialHeaders,
  isGuardedPath,
  mayCarryAdminKey,
  isHeldBack,
  noteAuthorized,
  noteForbidden,
  noteMutationAccepted,
  readOnlyMayCall,
  noteUnauthorized,
  whenProbed,
} from "./auth"

export const API_BASE = "/api/v2"

export class ApiError extends Error {
  status: number
  code?: string
  /**
   * Field-pathed validation entries, present only on validation failures.
   * Orion omits `details` when empty, so an absent array is the normal case.
   */
  details?: ErrorFieldDetail[]
  /** Echoes the `x-request-id` response header; absent when the request had none. */
  requestId?: string
  /**
   * The connector failure behind a data-plane answer (2.0): its class and the
   * provider's own code. Absent for every other error.
   */
  connector?: ConnectorErrorDetail
  /**
   * True when the request never left the browser: the server had asked for an
   * admin key and none that works is held (see `api/auth.ts`).
   */
  heldBack?: boolean

  constructor(
    status: number,
    message: string,
    code?: string,
    details?: ErrorFieldDetail[],
    requestId?: string,
    connector?: ConnectorErrorDetail
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
    this.connector = connector
  }
}

/** A 401 or 403: retrying cannot help until the credential changes. */
export const isAuthError = (e: unknown): boolean =>
  e instanceof ApiError && (e.status === 401 || e.status === 403)

export interface RequestOptions {
  headers?: Record<string, string>
  /**
   * Groups the audit rows of a multi-request operation — a promotion is many
   * API calls, and every audit row this one produces carries the value under
   * `details.change_context`. Free-form; the server truncates at 256 bytes.
   */
  changeContext?: string
  /**
   * Called with the response headers, success or failure — for the few
   * callers that read one (the console shows `X-Orion-Workflow-Revision`, the
   * revision a canary split routed to).
   */
  onHeaders?: (headers: Headers) => void
}

/** Merge `RequestOptions` into the header bag the fetch layer sends. */
function buildHeaders(opts?: RequestOptions): Record<string, string> | undefined {
  if (!opts) return undefined
  if (!opts.changeContext) return opts.headers
  return { ...opts.headers, "X-Orion-Change-Context": opts.changeContext }
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"])

async function request<T>(path: string, options?: RequestInit, onHeaders?: (h: Headers) => void): Promise<T> {
  const url = path.startsWith("/") ? path : `${API_BASE}/${path}`
  const guarded = isGuardedPath(url)
  const method = (options?.method ?? "GET").toUpperCase()

  if (guarded) {
    await whenProbed()
    if (isHeldBack()) {
      const held = new ApiError(401, "An admin API key is needed", "UNAUTHORIZED")
      held.heldBack = true
      throw held
    }
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(mayCarryAdminKey(url) ? credentialHeaders() : {}),
      ...options?.headers,
    },
  })

  onHeaders?.(res.headers)

  if (!res.ok) {
    const err = await parseError(res)
    if (guarded && res.status === 401) noteUnauthorized(err.message)
    if (guarded && res.status === 403 && err.code === "FORBIDDEN" && MUTATING.has(method)) noteForbidden()
    throw err
  }

  if (guarded) {
    noteAuthorized()
    if (MUTATING.has(method) && !readOnlyMayCall(url)) noteMutationAccepted()
  }

  // Handle 204 No Content
  if (res.status === 204) return undefined as T

  return res.json()
}

/**
 * Parse Orion's structured error envelope
 * `{ "error": { "code", "message", "details"?, "request_id"?, "connector"? } }`.
 * Falls back to raw text / status text for non-JSON error bodies.
 */
async function parseError(res: Response): Promise<ApiError> {
  const body = await res.text()
  if (body) {
    try {
      const parsed = JSON.parse(body)
      const err = parsed?.error
      if (err && typeof err.message === "string") {
        return new ApiError(
          res.status,
          err.message,
          err.code,
          Array.isArray(err.details) && err.details.length > 0 ? err.details : undefined,
          typeof err.request_id === "string" ? err.request_id : undefined,
          err.connector && typeof err.connector === "object" ? err.connector : undefined
        )
      }
    } catch {
      // not JSON — fall through to raw text
    }
  }
  return new ApiError(res.status, body || res.statusText)
}

/**
 * Unwrap the admin envelope. The surfaces carried over from 1.x answer
 * `{ data: T }` (a `Data_*` schema in the spec); a list answers a `Page_*`
 * (`{ data, limit, next_cursor?, total? }`), used whole. The resources new in
 * 2.0 — definitions, deployments, plans, connections, connector packages,
 * runtime capabilities — answer the object **bare**, with no envelope, so
 * their modules do not call this. The contract test holds each function to
 * its endpoint's response schema.
 */
export const unwrap = <T>(r: DataResponse<T>): T => r.data

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  if (entries.length === 0) return ""
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { headers: buildHeaders(opts) }, opts?.onHeaders),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(
      path,
      {
        method: "POST",
        body: body !== undefined ? JSON.stringify(body) : undefined,
        headers: buildHeaders(opts),
      },
      opts?.onHeaders,
    ),
  put: <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body), headers: buildHeaders(opts) }, opts?.onHeaders),
  patch: <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body), headers: buildHeaders(opts) }, opts?.onHeaders),
  delete: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { method: "DELETE", headers: buildHeaders(opts) }, opts?.onHeaders),
  // Arbitrary-method escape hatch for the data-plane catch-all (REST route
  // patterns accept any verb). Body is omitted when undefined (GET/DELETE).
  send: <T>(method: string, path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(
      path,
      {
        method,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        headers: buildHeaders(opts),
      },
      opts?.onHeaders,
    ),
}
