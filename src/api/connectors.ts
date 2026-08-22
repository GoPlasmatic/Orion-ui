import { api, buildQuery, unwrap } from "./client"
import type {
  CircuitBreakerStatus,
  Connector,
  ConnectorExportItem,
  ConnectorListItem,
  CreateConnectorRequest,
  DataResponse,
  ExportConnectorsParams,
  ImportOptions,
  ImportResult,
  ListConnectorsParams,
  PaginatedResponse,
  ProbeResult,
  UpdateConnectorRequest,
  ValidationResponse,
} from "./types"

export const connectorsApi = {
  list: (params: ListConnectorsParams = {}) =>
    api.get<PaginatedResponse<ConnectorListItem>>(
      `admin/connectors${buildQuery(params as Record<string, string | number | undefined>)}`
    ),

  get: (id: string) => api.get<DataResponse<Connector>>(`admin/connectors/${id}`).then(unwrap),

  create: (req: CreateConnectorRequest) =>
    api.post<DataResponse<Connector>>("admin/connectors", req).then(unwrap),

  update: (id: string, req: UpdateConnectorRequest) =>
    api.put<DataResponse<Connector>>(`admin/connectors/${id}`, req).then(unwrap),

  delete: (id: string) => api.delete<void>(`admin/connectors/${id}`),

  /** Same validator `POST admin/connectors` runs — never laxer. */
  validate: (req: CreateConnectorRequest) =>
    api.post<DataResponse<ValidationResponse>>("admin/connectors/validate", req).then(unwrap),

  /**
   * Probe the saved connector's backend, reading the stored row with its
   * `env://` references resolved rather than the registry — a connector that
   * failed to load has no registry entry, which is exactly when this is useful.
   *
   * An unreachable backend is still a 200. The `http` probe issues one genuine
   * request with genuine credentials; a 401/403 reports as NOT reachable.
   */
  test: (id: string) =>
    api.post<DataResponse<ProbeResult>>(`admin/connectors/${id}/test`).then(unwrap),

  import: (items: CreateConnectorRequest[], opts: ImportOptions = {}) =>
    api
      .post<DataResponse<ImportResult>>(
        `admin/connectors/import${buildQuery({
          dry_run: opts.dryRun,
          on_conflict: opts.onConflict,
        })}`,
        items
      )
      .then(unwrap),

  /**
   * Exports in the shape `/import` accepts, secrets masked. Only `env://` and
   * `vault://`-authored connectors round-trip: a literal credential exports as
   * `"******"` and is refused on import rather than stored as a broken secret.
   */
  export: (params: ExportConnectorsParams = {}) =>
    api
      .get<DataResponse<ConnectorExportItem[]>>(
        `admin/connectors/export${buildQuery(params as Record<string, string | number | undefined>)}`
      )
      .then(unwrap),

  getCircuitBreakers: () =>
    api.get<DataResponse<CircuitBreakerStatus>>("admin/connectors/circuit-breakers").then(unwrap),

  // Breaker keys are `channel:connector`, so the colon must survive as a path
  // segment value rather than being read as anything else.
  resetCircuitBreaker: (key: string) =>
    api
      .post<DataResponse<{ reset: boolean; key: string }>>(
        `admin/connectors/circuit-breakers/${encodeURIComponent(key)}`
      )
      .then(unwrap),
}
