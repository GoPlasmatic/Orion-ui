import { api } from "./client"
import type { ProcessRequest, ProcessResponse } from "./types"

export const dataApi = {
  processSync: (channel: string, req: ProcessRequest, profile = false) =>
    api.post<ProcessResponse>(
      `data/${channel}`,
      req,
      profile ? { headers: { "X-Orion-Profile": "1" } } : undefined
    ),

  processAsync: (channel: string, req: ProcessRequest) =>
    api.post<{ trace_id: string | null }>(`data/${channel}/async`, req),

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
