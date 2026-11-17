import { api, unwrap } from "./client"
import type { CronOccurrence, DataResponse } from "./types"

/**
 * What 2.0 kept of the channel routes: the manual cron run. A channel is
 * otherwise a deployment member — read through the head manifest
 * (`hooks/use-registry.ts`), changed only by applying a deployment.
 */
export const channelsApi = {
  /**
   * Run a deployed `cron` channel now, by its member id. Answers 202 with the
   * new occurrence, minted at the current instant and marked
   * `trigger: "manual"`. Not a side door: it goes through the same claim,
   * singleton and execution path a scheduled occurrence does, so triggering a
   * `forbid` channel while its scheduled run is in flight records
   * `skipped_singleton` rather than running alongside it. Audited as
   * `trigger` / `channel`.
   */
  trigger: (id: string) =>
    api
      .post<DataResponse<CronOccurrence>>(`admin/channels/${encodeURIComponent(id)}/trigger`)
      .then(unwrap),
}
