import { api, unwrap } from "./client"
import type { DataResponse, EngineStatus, HealthResponse } from "./types"

/**
 * The running generation and `/health`. 2.0 has no reload endpoint: applying
 * a deployment is what rebuilds the engine, and `deployments/{rev}/convergence`
 * is how its progress is watched.
 */
export const engineApi = {
  status: () => api.get<DataResponse<EngineStatus>>("admin/engine/status").then(unwrap),

  // Not an admin-plane route, so no `data` envelope.
  health: () => api.get<HealthResponse>("/health"),
}
