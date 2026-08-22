import { api, buildQuery, unwrap } from "./client"
import type { DataResponse, ListTracesParams, TraceDetail, TracePage } from "./types"

/**
 * Trace reads live on the admin plane since 1.0 — they moved off `data/` because
 * `/traces` was a static route shadowing the data-plane catch-all, which made a
 * channel actually named `traces` permanently unreachable. There is no redirect:
 * the old `data/traces` paths now resolve as a channel name and 404.
 *
 * The single-trace GET is the one path under `admin/` not covered by the blanket
 * admin guard — it also accepts the `trace_token` handed out with an async 202.
 */
export const tracesApi = {
  list: (params: ListTracesParams = {}) => {
    // `buildQuery` serializes `offset: 0`, and the server refuses `cursor`
    // together with `offset`. Drop offset entirely when paging by cursor.
    const query = params.cursor ? { ...params, offset: undefined } : params
    return api.get<TracePage>(
      `admin/traces${buildQuery(query as Record<string, string | number | boolean | undefined>)}`
    )
  },

  /**
   * `token` is the capability token from an async submission's 202. Callers
   * holding an admin credential can omit it.
   */
  get: (id: string, token?: string) =>
    api
      .get<DataResponse<TraceDetail>>(
        `admin/traces/${encodeURIComponent(id)}`,
        token ? { headers: { "x-trace-token": token } } : undefined
      )
      .then(unwrap),
}
