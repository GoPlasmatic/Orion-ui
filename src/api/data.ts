import { api } from "./client"
import type { AsyncSubmitResponse, ProcessRequest, ProcessResponse } from "./types"

/** Caller-supplied request headers: an API key, an HMAC signature, an idempotency key. */
export type ExtraHeaders = Record<string, string>

// A guarded channel answers 401 to a bare request, so the console has to be
// able to send the credential a real caller would.
const options = (profile: boolean, headers?: ExtraHeaders) => {
  const merged: Record<string, string> = { ...(headers ?? {}) }
  if (profile) merged["X-Orion-Profile"] = "1"
  return Object.keys(merged).length > 0 ? { headers: merged } : undefined
}

export const dataApi = {
  processSync: (channel: string, req: ProcessRequest, profile = false, headers?: ExtraHeaders) =>
    api.post<ProcessResponse>(`data/${channel}`, req, options(profile, headers)),

  // Answers 202 with an acknowledgment, never a result. The `trace_token` is a
  // capability token scoping the trace poll to this submission — without it,
  // reading the trace needs an admin credential.
  processAsync: (channel: string, req: ProcessRequest, headers?: ExtraHeaders) =>
    api.post<AsyncSubmitResponse>(`data/${channel}/async`, req, options(false, headers)),

  // Invoke a REST-routed channel (route_pattern + methods) with an arbitrary
  // verb and concrete path, e.g. GET /orders/42. Bodyless verbs send no payload.
  processRest: (
    method: string,
    path: string,
    req?: ProcessRequest,
    profile = false,
    headers?: ExtraHeaders,
  ) =>
    api.send<ProcessResponse>(
      method,
      `data${path.startsWith("/") ? path : `/${path}`}`,
      req,
      options(profile, headers),
    ),
}
