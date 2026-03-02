import { api } from "./client"
import type { Trace, TraceDetail, ListTracesParams, PaginatedResponse } from "./types"

function buildQuery(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  if (entries.length === 0) return ""
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")
}

export const tracesApi = {
  list: (params: ListTracesParams = {}) =>
    api.get<PaginatedResponse<Trace>>(`data/traces${buildQuery(params as Record<string, string | number | undefined>)}`),

  get: (id: string) =>
    api.get<TraceDetail>(`data/traces/${id}`),
}
