import { api, unwrap } from "./client"
import type { CircuitBreakerStatus, DataResponse } from "./types"

/**
 * Circuit breakers, per `(channel, connection)` and per replica. The one
 * `admin/connectors/*` surface 2.0 kept: connectors themselves became
 * connections (`api/connections.ts`).
 */
export const circuitBreakersApi = {
  list: () => api.get<DataResponse<CircuitBreakerStatus>>("admin/connectors/circuit-breakers").then(unwrap),

  // Breaker keys are `channel:connector`, so the colon must survive as a path
  // segment value rather than being read as anything else.
  reset: (key: string) =>
    api
      .post<DataResponse<{ reset: boolean; key: string }>>(
        `admin/connectors/circuit-breakers/${encodeURIComponent(key)}`,
      )
      .then(unwrap),
}
