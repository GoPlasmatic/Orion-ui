import { api, buildQuery, unwrap } from "./client"
import type {
  CronOccurrence,
  CronOccurrenceSummary,
  CronScheduleStatus,
  DataResponse,
  ListCronOccurrencesParams,
  PaginatedResponse,
} from "./types"

/**
 * The cron occurrence ledger (Orion 1.6).
 *
 * Every scheduled instant of a `protocol: "cron"` channel is a durable row,
 * written before anything runs and kept after it finishes — the answer to
 * "did last night's job run?" that does not depend on which traces survived
 * sampling and retention. Failed occurrences are *not* retried automatically
 * and never enter the trace DLQ: the next scheduled occurrence is the natural
 * retry, and `retryOccurrence` is the manual one.
 *
 * Running a schedule now is `channelsApi.trigger`: it lives under the channel
 * because that is what it acts on, and it goes through the same claim and
 * singleton path a scheduled occurrence does.
 */
export const cronApi = {
  // Newest first. Summaries only — an occurrence carries no payload, so this
  // is for readability rather than cost.
  listOccurrences: (params: ListCronOccurrencesParams = {}) =>
    api.get<PaginatedResponse<CronOccurrenceSummary>>(
      `admin/cron/occurrences${buildQuery(params as Record<string, string | number | undefined>)}`
    ),

  getOccurrence: (id: string) =>
    api
      .get<DataResponse<CronOccurrence>>(`admin/cron/occurrences/${encodeURIComponent(id)}`)
      .then(unwrap),

  /**
   * Another attempt at the same occurrence: same id, same `scheduled_for`,
   * `attempt` incremented — because a retry is another go at the work that was
   * due *then*. 409 unless the occurrence is `failed`, `skipped_misfire` or
   * `skipped_singleton`. Re-running finished work is a trigger, not a retry.
   */
  retryOccurrence: (id: string) =>
    api
      .post<DataResponse<CronOccurrence>>(
        `admin/cron/occurrences/${encodeURIComponent(id)}/retry`
      )
      .then(unwrap),

  // One row per active cron channel: schedule, next fire, last run, backlog.
  status: () => api.get<DataResponse<CronScheduleStatus[]>>("admin/cron/status").then(unwrap),
}
