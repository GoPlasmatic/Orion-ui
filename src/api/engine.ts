import { api, unwrap } from "./client"
import type { DataResponse, EngineReloaded, EngineStatus, HealthResponse } from "./types"

export const engineApi = {
  status: () => api.get<DataResponse<EngineStatus>>("admin/engine/status").then(unwrap),

  /**
   * Rebuilds the engine and bumps the cluster config epoch once. This is also
   * what finishes a batch of `reload=defer` transitions — until it runs, the
   * database and the running engine intentionally disagree.
   */
  reload: () => api.post<DataResponse<EngineReloaded>>("admin/engine/reload").then(unwrap),

  // Not an admin-plane route, so no `data` envelope.
  health: () => api.get<HealthResponse>("/health"),
}
