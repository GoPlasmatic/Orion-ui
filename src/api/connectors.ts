import { api } from "./client"
import type { Connector, ListConnectorsParams, PaginatedResponse } from "./types"

function buildQuery(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  if (entries.length === 0) return ""
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")
}

export const connectorsApi = {
  list: (params: ListConnectorsParams = {}) =>
    api.get<PaginatedResponse<Connector>>(`admin/connectors${buildQuery(params as Record<string, string | number | undefined>)}`),

  get: (id: string) =>
    api.get<Connector>(`admin/connectors/${id}`),
}
