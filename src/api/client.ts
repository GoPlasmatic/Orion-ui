import type { DataResponse, ErrorFieldDetail } from "./types"

const API_BASE = "/api/v1"

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

  constructor(
    status: number,
    message: string,
    code?: string,
    details?: ErrorFieldDetail[],
    requestId?: string
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
  }
}

export interface RequestOptions {
  headers?: Record<string, string>
  /**
   * Groups the audit rows of a multi-request operation — a promotion is many
   * API calls, and every audit row this one produces carries the value under
   * `details.change_context`. Free-form; the server truncates at 256 bytes.
   */
  changeContext?: string
}

/** Merge `RequestOptions` into the header bag the fetch layer sends. */
function buildHeaders(opts?: RequestOptions): Record<string, string> | undefined {
  if (!opts) return undefined
  if (!opts.changeContext) return opts.headers
  return { ...opts.headers, "X-Orion-Change-Context": opts.changeContext }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = path.startsWith("/") ? path : `${API_BASE}/${path}`

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  })

  if (!res.ok) {
    throw await parseError(res)
  }

  // Handle 204 No Content
  if (res.status === 204) return undefined as T

  return res.json()
}

/**
 * Parse Orion's structured error envelope
 * `{ "error": { "code", "message", "details"?, "request_id"? } }`.
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
          typeof err.request_id === "string" ? err.request_id : undefined
        )
      }
    } catch {
      // not JSON — fall through to raw text
    }
  }
  return new ApiError(res.status, body || res.statusText)
}

/**
 * Unwrap the admin envelope. Since 1.0 every admin 2xx body puts its payload
 * under `data`; list endpoints add the pagination counters alongside it.
 */
export const unwrap = <T>(r: DataResponse<T>): T => r.data

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  if (entries.length === 0) return ""
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>(path, { headers: buildHeaders(opts) }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: buildHeaders(opts),
    }),
  put: <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body), headers: buildHeaders(opts) }),
  patch: <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body), headers: buildHeaders(opts) }),
  delete: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { method: "DELETE", headers: buildHeaders(opts) }),
  // Arbitrary-method escape hatch for the data-plane catch-all (REST route
  // patterns accept any verb). Body is omitted when undefined (GET/DELETE).
  send: <T>(method: string, path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, {
      method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: buildHeaders(opts),
    }),
}
