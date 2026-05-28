import { api, buildQuery } from "./client"
import type {
  CircuitBreakerStatus,
  Connector,
  CreateConnectorRequest,
  DataResponse,
  ImportResult,
  ListConnectorsParams,
  PaginatedResponse,
  UpdateConnectorRequest,
} from "./types"

export const connectorsApi = {
  list: (params: ListConnectorsParams = {}) =>
    api.get<PaginatedResponse<Connector>>(
      `admin/connectors${buildQuery(params as Record<string, string | number | undefined>)}`
    ),

  get: (id: string) =>
    api.get<DataResponse<Connector>>(`admin/connectors/${id}`).then((r) => r.data),

  create: (req: CreateConnectorRequest) =>
    api.post<DataResponse<Connector>>("admin/connectors", req).then((r) => r.data),

  update: (id: string, req: UpdateConnectorRequest) =>
    api.put<DataResponse<Connector>>(`admin/connectors/${id}`, req).then((r) => r.data),

  delete: (id: string) => api.delete<void>(`admin/connectors/${id}`),

  import: (items: CreateConnectorRequest[], dryRun = false) =>
    api.post<ImportResult>(`admin/connectors/import${buildQuery({ dry_run: dryRun })}`, items),

  getCircuitBreakers: () =>
    api.get<CircuitBreakerStatus>("admin/connectors/circuit-breakers"),

  resetCircuitBreaker: (key: string) =>
    api.post<{ reset: boolean; key: string }>(`admin/connectors/circuit-breakers/${key}`),
}
