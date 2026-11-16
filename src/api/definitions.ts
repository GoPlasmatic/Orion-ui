import { api } from "./client"
import type { StoredDefinition } from "./types"

/**
 * Content-addressed definitions (2.0). A definition has no id, version or
 * status of its own — a manifest member binds it to an entity. Its digest
 * covers the whole document, so a fetched definition never changes: callers
 * cache it forever. There is no list: definitions are reached through the
 * manifests that name them.
 */
export const definitionsApi = {
  get: (digest: string) => api.get<StoredDefinition>(`admin/definitions/${encodeURIComponent(digest)}`),
}
