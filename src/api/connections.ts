import { api, buildQuery } from "./client"
import type {
  ConnectionProbe,
  ConnectionRevision,
  CreateConnectionRevisionRequest,
  CreateConnectionRevisionResponse,
  Page,
  PageParams,
} from "./types"

/**
 * Connections (2.0): what 1.x called connectors, as immutable numbered
 * revisions over a provider (a built-in Rust driver or an admitted provider
 * package, named by digest). A deployment member names one revision by its
 * `configuration_digest`. Secrets never come back — only where each is read
 * from (`secret_locators`). Every answer is bare.
 */
export const connectionsApi = {
  /** Every revision of every connection, a page at a time. There is no "latest only". */
  list: (params: PageParams = {}) =>
    api.get<Page<ConnectionRevision>>(`admin/connections${buildQuery({ ...params })}`),

  /** One connection's revisions, a page at a time. */
  revisions: (id: string, params: PageParams = {}) =>
    api.get<Page<ConnectionRevision>>(
      `admin/connections/${encodeURIComponent(id)}/revisions${buildQuery({ ...params })}`,
    ),

  /**
   * Create an immutable revision (201). The same content answers the stored
   * revision again; different content at a stored number is 409
   * `IMMUTABLE_CONNECTION_CONFLICT`. The CLI performs this before a plan; the
   * console adds it for a change set.
   */
  createRevision: (id: string, req: CreateConnectionRevisionRequest) =>
    api.post<CreateConnectionRevisionResponse>(
      `admin/connections/${encodeURIComponent(id)}/revisions`,
      req,
    ),

  get: (id: string, revision: number) =>
    api.get<ConnectionRevision>(`admin/connections/${encodeURIComponent(id)}/revisions/${revision}`),

  /**
   * Probe one revision's backend from this node. A probe that ran answers 200
   * whatever it found — `healthy` is the finding. It reaches the real backend
   * with the real credentials, so a read-only key is refused (403).
   */
  probe: (id: string, revision: number) =>
    api.post<ConnectionProbe>(`admin/connections/${encodeURIComponent(id)}/revisions/${revision}/probes`),
}
