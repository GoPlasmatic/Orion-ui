const API_BASE = "/api/v1"

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

export interface RequestOptions {
  headers?: Record<string, string>
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
 * Parse Orion's structured error envelope `{ "error": { "code", "message" } }`.
 * Falls back to raw text / status text for non-JSON error bodies.
 */
async function parseError(res: Response): Promise<ApiError> {
  const body = await res.text()
  if (body) {
    try {
      const parsed = JSON.parse(body)
      const err = parsed?.error
      if (err && typeof err.message === "string") {
        return new ApiError(res.status, err.message, err.code)
      }
    } catch {
      // not JSON — fall through to raw text
    }
  }
  return new ApiError(res.status, body || res.statusText)
}

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  if (entries.length === 0) return ""
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>(path, { headers: opts?.headers }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: opts?.headers,
    }),
  put: <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body), headers: opts?.headers }),
  patch: <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body), headers: opts?.headers }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
}
