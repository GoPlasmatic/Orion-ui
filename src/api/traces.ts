import { api, buildQuery } from "./client"
import type { Trace, TraceDetail, ListTracesParams, PaginatedResponse } from "./types"

export const tracesApi = {
  list: (params: ListTracesParams = {}) =>
    api.get<PaginatedResponse<Trace>>(
      `data/traces${buildQuery(params as Record<string, string | number | undefined>)}`
    ),

  get: (id: string) => api.get<TraceDetail>(`data/traces/${id}`),
}
