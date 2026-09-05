import { api, buildQuery, unwrap } from "./client"
import type {
  Channel,
  CreateChannelRequest,
  CronOccurrence,
  DataResponse,
  ExportChannelsParams,
  ImportOptions,
  ImportResult,
  ListChannelsParams,
  PaginatedResponse,
  StatusChangeOptions,
  StatusChangeRequest,
  UpdateChannelRequest,
  ValidationResponse,
} from "./types"

export const channelsApi = {
  list: (params: ListChannelsParams = {}) =>
    api.get<PaginatedResponse<Channel>>(
      `admin/channels${buildQuery(params as Record<string, string | number | undefined>)}`
    ),

  get: (id: string) => api.get<DataResponse<Channel>>(`admin/channels/${id}`).then(unwrap),

  create: (req: CreateChannelRequest) =>
    api.post<DataResponse<Channel>>("admin/channels", req).then(unwrap),

  update: (id: string, req: UpdateChannelRequest) =>
    api.put<DataResponse<Channel>>(`admin/channels/${id}`, req).then(unwrap),

  delete: (id: string) => api.delete<void>(`admin/channels/${id}`),

  /**
   * Runs the same validator `POST admin/channels` runs, so `valid: true` means
   * create would accept the payload. An `env://` reference unset on the
   * validating host is a warning, not an error.
   */
  validate: (req: CreateChannelRequest) =>
    api.post<DataResponse<ValidationResponse>>("admin/channels/validate", req).then(unwrap),

  /**
   * `reload: "defer"` commits the row but leaves the running engine — and every
   * peer — on the previous configuration until `POST admin/engine/reload`.
   * A deferred activation is not serving yet, so a caller that defers must
   * always finish with the explicit reload.
   */
  changeStatus: (id: string, req: StatusChangeRequest, opts: StatusChangeOptions = {}) =>
    api
      .patch<DataResponse<Channel>>(
        `admin/channels/${id}/status${buildQuery({ reload: opts.reload })}`,
        req
      )
      .then(unwrap),

  /**
   * Pre-flight the transition. Answers the /validate envelope without writing;
   * gates the real request fails as a 4xx — "not found", and the workflow-active
   * gate — come back as `errors` entries in a 200, so one pass collects every
   * finding instead of stopping at the first.
   */
  changeStatusDryRun: (id: string, req: StatusChangeRequest) =>
    api
      .patch<DataResponse<ValidationResponse>>(
        `admin/channels/${id}/status${buildQuery({ dry_run: true })}`,
        req
      )
      .then(unwrap),

  listVersions: (id: string, params: { limit?: number; offset?: number } = {}) =>
    api.get<PaginatedResponse<Channel>>(
      `admin/channels/${id}/versions${buildQuery(params as Record<string, number | undefined>)}`
    ),

  createVersion: (id: string) =>
    api.post<DataResponse<Channel>>(`admin/channels/${id}/versions`).then(unwrap),

  import: (items: CreateChannelRequest[], opts: ImportOptions = {}) =>
    api
      .post<DataResponse<ImportResult>>(
        `admin/channels/import${buildQuery({ dry_run: opts.dryRun, on_conflict: opts.onConflict })}`,
        items
      )
      .then(unwrap),

  export: (params: ExportChannelsParams = {}) =>
    api
      .get<DataResponse<Channel[]>>(
        `admin/channels/export${buildQuery(params as Record<string, string | number | undefined>)}`
      )
      .then(unwrap),

  /**
   * Run an active `cron` channel now (1.6). Answers 202 with the new
   * occurrence, minted at the current instant and marked `trigger: "manual"`.
   * Not a side door: it goes through the same claim, singleton and execution
   * path a scheduled occurrence does, so triggering a `forbid` channel while
   * its scheduled run is in flight records `skipped_singleton` rather than
   * running alongside it. Audited as `trigger` / `channel`.
   */
  trigger: (id: string) =>
    api
      .post<DataResponse<CronOccurrence>>(`admin/channels/${encodeURIComponent(id)}/trigger`)
      .then(unwrap),
}
