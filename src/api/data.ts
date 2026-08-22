import { api } from "./client"
import type { AsyncSubmitResponse, ProcessRequest, ProcessResponse } from "./types"

export const dataApi = {
  processSync: (channel: string, req: ProcessRequest, profile = false) =>
    api.post<ProcessResponse>(
      `data/${channel}`,
      req,
      profile ? { headers: { "X-Orion-Profile": "1" } } : undefined
    ),

  // Answers 202 with an acknowledgment, never a result. The `trace_token` is a
  // capability token scoping the trace poll to this submission — without it,
  // reading the trace needs an admin credential.
  processAsync: (channel: string, req: ProcessRequest) =>
    api.post<AsyncSubmitResponse>(`data/${channel}/async`, req),

  // Invoke a REST-routed channel (route_pattern + methods) with an arbitrary
  // verb and concrete path, e.g. GET /orders/42. Bodyless verbs send no payload.
  processRest: (method: string, path: string, req?: ProcessRequest, profile = false) =>
    api.send<ProcessResponse>(
      method,
      `data${path.startsWith("/") ? path : `/${path}`}`,
      req,
      profile ? { headers: { "X-Orion-Profile": "1" } } : undefined
    ),
}
