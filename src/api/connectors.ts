import { api, buildQuery } from "./client"
import type {
  CircuitBreaker,
  Connector,
  CreateConnectorRequest,
  ListConnectorsParams,
  PaginatedResponse,
  UpdateConnectorRequest,
} from "./types"

export const connectorsApi = {
  list: (params: ListConnectorsParams = {}) =>
    api.get<PaginatedResponse<Connector>>(
      `admin/connectors${buildQuery(params as Record<string, string | number | undefined>)}`
    ),

  get: (id: string) => api.get<Connector>(`admin/connectors/${id}`),

  create: (req: CreateConnectorRequest) =>
    api.post<Connector>("admin/connectors", req),

  update: (id: string, req: UpdateConnectorRequest) =>
    api.put<Connector>(`admin/connectors/${id}`, req),

  delete: (id: string) => api.delete<void>(`admin/connectors/${id}`),

  reload: () => api.post<{ message: string }>("admin/connectors/reload"),

  getCircuitBreakers: () =>
    api.get<CircuitBreaker[]>("admin/connectors/circuit-breakers"),

  resetCircuitBreaker: (key: string) =>
    api.post<void>(`admin/connectors/circuit-breakers/${key}`),
}
