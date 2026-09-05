import { api, buildQuery, unwrap } from "./client"
import type {
  CreatePluginRequest,
  DataResponse,
  ExportPluginsParams,
  ImportOptions,
  ImportResult,
  ListPluginsParams,
  PaginatedResponse,
  Plugin,
  PluginDependencies,
  StatusChangeOptions,
  StatusChangeRequest,
  UpdatePluginRequest,
  ValidationResponse,
} from "./types"

/**
 * WebAssembly plugins (Orion 1.6): custom task functions in a sandbox, with
 * the lifecycle a workflow has. An upload carries the manifest (TOML text or
 * JSON) and the component as base64; the server validates, hashes, compiles
 * and probes it before the draft exists. Activating a version reloads the
 * engine and its functions appear in `GET admin/functions` with
 * `source: "plugin"`.
 *
 * Every route answers 400 on a node with `plugins.enabled = false` — the
 * sandbox is off, not merely empty — and an archive or delete is a 409 while
 * an active workflow calls one of the plugin's functions.
 */
export const pluginsApi = {
  list: (params: ListPluginsParams = {}) =>
    api.get<PaginatedResponse<Plugin>>(
      `admin/plugins${buildQuery(params as Record<string, string | number | undefined>)}`
    ),

  // The latest version, with this node's load state under `health`.
  get: (id: string) =>
    api.get<DataResponse<Plugin>>(`admin/plugins/${encodeURIComponent(id)}`).then(unwrap),

  create: (req: CreatePluginRequest) =>
    api.post<DataResponse<Plugin>>("admin/plugins", req).then(unwrap),

  // Updates the draft; an absent field keeps its value.
  update: (id: string, req: UpdatePluginRequest) =>
    api.put<DataResponse<Plugin>>(`admin/plugins/${encodeURIComponent(id)}`, req).then(unwrap),

  // Every version and any component nothing else names.
  delete: (id: string) => api.delete<void>(`admin/plugins/${encodeURIComponent(id)}`),

  /**
   * Validate a manifest and component without storing them: `valid: true`
   * means `POST admin/plugins` would accept the payload on this node — so a
   * signature the node's trust keys refuse is reported here too.
   */
  validate: (req: CreatePluginRequest) =>
    api.post<DataResponse<ValidationResponse>>("admin/plugins/validate", req).then(unwrap),

  /**
   * Activate (supersedes the previously active version) or archive. Activation
   * checks every active workflow calling the plugin's functions against the
   * schema this version declares — a renamed or newly-required field is a 409
   * naming the workflow, and the previous version keeps serving.
   */
  changeStatus: (id: string, req: StatusChangeRequest, opts: StatusChangeOptions = {}) =>
    api
      .patch<DataResponse<Plugin>>(
        `admin/plugins/${encodeURIComponent(id)}/status${buildQuery({ reload: opts.reload })}`,
        req
      )
      .then(unwrap),

  /** Pre-flight the transition — see `channelsApi.changeStatusDryRun`. */
  changeStatusDryRun: (id: string, req: StatusChangeRequest) =>
    api
      .patch<DataResponse<ValidationResponse>>(
        `admin/plugins/${encodeURIComponent(id)}/status${buildQuery({ dry_run: true })}`,
        req
      )
      .then(unwrap),

  listVersions: (id: string, params: { limit?: number; offset?: number } = {}) =>
    api.get<PaginatedResponse<Plugin>>(
      `admin/plugins/${encodeURIComponent(id)}/versions${buildQuery(params as Record<string, number | undefined>)}`
    ),

  createVersion: (id: string) =>
    api
      .post<DataResponse<Plugin>>(`admin/plugins/${encodeURIComponent(id)}/versions`)
      .then(unwrap),

  // The functions the latest version declares and the active workflows calling
  // them — the ones an archive or delete is refused for.
  dependencies: (id: string) =>
    api
      .get<DataResponse<PluginDependencies>>(
        `admin/plugins/${encodeURIComponent(id)}/dependencies`
      )
      .then(unwrap),

  // Items carry the component inline or name a digest the target holds.
  import: (items: CreatePluginRequest[], opts: ImportOptions = {}) =>
    api
      .post<DataResponse<ImportResult>>(
        `admin/plugins/import${buildQuery({ dry_run: opts.dryRun, on_conflict: opts.onConflict })}`,
        items
      )
      .then(unwrap),

  /**
   * Exports in the shape `/import` accepts. Without `include_artifacts` each
   * item names its component by `digest` only, which round-trips on an
   * instance that already holds the bytes and nowhere else.
   */
  export: (params: ExportPluginsParams = {}) =>
    api
      .get<DataResponse<Plugin[]>>(
        `admin/plugins/export${buildQuery(params as Record<string, string | number | boolean | undefined>)}`
      )
      .then(unwrap),
}
