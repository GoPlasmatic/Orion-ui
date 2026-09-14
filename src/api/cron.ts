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

/**
 * `since` / `until` on this endpoint are `chrono::NaiveDateTime` — and unlike
 * the audit plane's `start_time`/`end_time`, which accept either spelling, the
 * deserializer here refuses a trailing zone or fraction outright:
 * `2026-09-13T03:00:00.000Z` answers 400 `since: trailing input`, and only
 * `2026-09-13T03:00:00` is taken.
 *
 * Every value the app has is a UTC instant from `Date.toISOString()` or
 * `toRfc3339()`, so the trim happens here, at the one boundary that needs it,
 * rather than in each caller — a caller that forgot produced a silently empty
 * result, not a visible error.
 */
function toNaiveUtc(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?$/.exec(value)
  return match ? match[1] : value
}

export const cronApi = {
  // Newest first. Summaries only — an occurrence carries no payload, so this
  // is for readability rather than cost.
  listOccurrences: ({ since, until, ...rest }: ListCronOccurrencesParams = {}) =>
    api.get<PaginatedResponse<CronOccurrenceSummary>>(
      `admin/cron/occurrences${buildQuery({
        ...rest,
        since: toNaiveUtc(since),
        until: toNaiveUtc(until),
      } as Record<string, string | number | undefined>)}`
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
