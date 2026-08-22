import { api, buildQuery, unwrap } from "./client"
import type {
  DataResponse,
  DlqPurgeResult,
  ListTraceDlqParams,
  PaginatedResponse,
  PurgeTraceDlqRequest,
  TraceDlqEntry,
  TraceDlqSummary,
} from "./types"

/**
 * The operator view of the async dead-letter queue.
 *
 * Only `/async` traffic reaches this queue — a sync request carries its own
 * failure back to the caller, with nothing left to retry. Two different
 * failures land here and the queue does not distinguish them: the run failed
 * (task error or channel timeout), or the run never started (the pre-run status
 * write failed). A *result* write that fails after a successful run does NOT
 * queue — the work is already done and re-running would repeat side effects.
 */
export const traceDlqApi = {
  // Summaries only: the failed payload is omitted so one request cannot dump
  // every failed request's body.
  list: (params: ListTraceDlqParams = {}) =>
    api.get<PaginatedResponse<TraceDlqSummary>>(
      `admin/trace-dlq${buildQuery(params as Record<string, string | number | boolean | undefined>)}`
    ),

  get: (id: string) =>
    api.get<DataResponse<TraceDlqEntry>>(`admin/trace-dlq/${encodeURIComponent(id)}`).then(unwrap),

  // Resets retry_count to 0 and schedules an immediate retry, including for an
  // entry that has already exhausted its retries.
  requeue: (id: string) =>
    api
      .post<DataResponse<TraceDlqEntry>>(`admin/trace-dlq/${encodeURIComponent(id)}/requeue`)
      .then(unwrap),

  // Deletes only *exhausted* entries; live ones are never purged.
  // `older_than_hours: 0` purges every exhausted entry.
  purge: (req: PurgeTraceDlqRequest) =>
    api.post<DataResponse<DlqPurgeResult>>("admin/trace-dlq/purge", req).then(unwrap),
}
