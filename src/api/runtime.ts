import { api } from "./client"
import type { ReadinessResponse, RuntimeCapabilities } from "./types"

export const runtimeApi = {
  /** What this node runs (2.0). Bare: no `data` envelope. */
  capabilities: () => api.get<RuntimeCapabilities>("admin/runtime-capabilities"),
}

/**
 * `/readyz` answers 503 with the same body when the node is not ready, and
 * that body is the point — which component holds it back — so a 503 is read
 * rather than thrown, which is why this is a plain `fetch` and not the API
 * client. Not an admin route: no envelope, no credential.
 */
export async function fetchReadiness(): Promise<ReadinessResponse> {
  const res = await fetch("/readyz")
  if (res.ok || res.status === 503) return (await res.json()) as ReadinessResponse
  throw new Error(`/readyz answered ${res.status}`)
}
