import { api, type RequestOptions } from "./client"
import type { AsyncSubmitResponse, ProcessRequest, ProcessResponse } from "./types"

/** Caller-supplied request headers: an API key, an HMAC signature, an idempotency key. */
export type ExtraHeaders = Record<string, string>

/** Called with the response headers — `X-Orion-Workflow-Revision` names the revision a canary split routed to. */
export type OnHeaders = (headers: Headers) => void

// A guarded channel answers 401 to a bare request, so the console has to be
// able to send the credential a real caller would. The admin key is never
// added here (`api/auth.ts::mayCarryAdminKey`).
const options = (profile: boolean, headers?: ExtraHeaders, onHeaders?: OnHeaders): RequestOptions | undefined => {
  const merged: Record<string, string> = { ...(headers ?? {}) }
  if (profile) merged["X-Orion-Profile"] = "1"
  if (Object.keys(merged).length === 0 && !onHeaders) return undefined
  return { headers: Object.keys(merged).length > 0 ? merged : undefined, onHeaders }
}

export const dataApi = {
  processSync: (channel: string, req: ProcessRequest, profile = false, headers?: ExtraHeaders, onHeaders?: OnHeaders) =>
    api.post<ProcessResponse>(`data/${channel}`, req, options(profile, headers, onHeaders)),

  // Answers 202 with an acknowledgment, never a result. The `trace_token` is a
  // capability token scoping the trace poll to this submission — without it,
  // reading the trace needs an admin credential.
  processAsync: (channel: string, req: ProcessRequest, headers?: ExtraHeaders, onHeaders?: OnHeaders) =>
    api.post<AsyncSubmitResponse>(`data/${channel}/async`, req, options(false, headers, onHeaders)),

  // Invoke a REST-routed channel (route_pattern + methods) with an arbitrary
  // verb and concrete path, e.g. GET /orders/42. Bodyless verbs send no payload.
  processRest: (
    method: string,
    path: string,
    req?: ProcessRequest,
    profile = false,
    headers?: ExtraHeaders,
    onHeaders?: OnHeaders,
  ) =>
    api.send<ProcessResponse>(
      method,
      `data${path.startsWith("/") ? path : `/${path}`}`,
      req,
      options(profile, headers, onHeaders),
    ),
}
