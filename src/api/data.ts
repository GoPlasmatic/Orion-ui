import { api } from "./client"
import type { ProcessRequest, ProcessResponse } from "./types"

export const dataApi = {
  processSync: (channel: string, req: ProcessRequest) =>
    api.post<ProcessResponse>(`data/${channel}`, req),

  processAsync: (channel: string, req: ProcessRequest) =>
    api.post<ProcessResponse>(`data/${channel}/async`, req),
}
