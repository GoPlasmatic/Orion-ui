import { api } from "./client"
import type { EngineStatus, HealthResponse } from "./types"

export const engineApi = {
  status: () => api.get<EngineStatus>("admin/engine/status"),

  reload: () => api.post<{ message: string }>("admin/engine/reload"),

  health: () => api.get<HealthResponse>("/health"),
}
