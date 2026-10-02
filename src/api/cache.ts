import { api, unwrap } from "./client"
import type { CacheInvalidatedResponse, DataResponse } from "./types"

/**
 * The response cache's invalidation namespaces (Orion 1.10).
 *
 * A channel names the namespaces its entries belong to in
 * `config.cache.namespaces`; each has a version counter in the cache store.
 * Invalidating bumps the counter, so every entry stored under the older
 * version stops matching — one INCR, no scan, no delete, and nothing to undo.
 * There is no listing endpoint: the namespaces in use are read off the channel
 * configs (`lib/cache-namespaces.ts`).
 */
export const cacheApi = {
  // 400 for a name outside 1–64 chars of `a-z0-9_-.:`. Audited as
  // `invalidate` / `cache_namespace`.
  invalidateNamespace: (namespace: string) =>
    api
      .post<DataResponse<CacheInvalidatedResponse>>(
        `admin/cache/namespaces/${encodeURIComponent(namespace)}/invalidate`
      )
      .then(unwrap),
}
