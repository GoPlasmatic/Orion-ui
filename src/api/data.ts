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
}
