import { api, buildQuery, unwrap } from "./client"
import type {
  AdmitModelOptions,
  CreateModelRequest,
  DataResponse,
  ExportModelsParams,
  ImportOptions,
  ImportResult,
  ListModelsParams,
  Model,
  ModelDependencies,
  ModelValidationResponse,
  PaginatedResponse,
  StatusChangeOptions,
  StatusChangeRequest,
  UpdateModelRequest,
} from "./types"

/**
 * Models (Orion 1.8): ONNX graphs as the fifth versioned entity, with the
 * workflow's lifecycle and one verb of its own — `admit`.
 *
 * The server never holds model bytes. A registration carries the manifest and
 * an *artifact reference* (a `storage` connector, an object key, and the
 * `sha256:` digest the bytes must hash to), and answers **202**: the manifest,
 * the connector's read permission and the object's existence are checked
 * synchronously, then the node's admission worker fetches the object, verifies
 * the digest, reads the graph and probes it before the verdict lands on the
 * row. So a create is not the end of the story — poll `get` until
 * `admission.state` leaves `pending`.
 *
 * Activation is a 409 until that verdict is `passed`; archive and delete are a
 * 409 while an active workflow names the model, which `dependencies` lists
 * ahead of time.
 *
 * On a node with `models.enabled = false` the *writes* answer 400 — create,
 * update, admit, status — while `list` and `get` answer normally with whatever
 * is stored, and `validate` answers 200 with `valid: false` and the reason as
 * its one finding. So a disabled node still browses an estate it cannot serve.
 */
export const modelsApi = {
  list: (params: ListModelsParams = {}) =>
    api.get<PaginatedResponse<Model>>(
      `admin/models${buildQuery(params as Record<string, string | number | undefined>)}`
    ),

  // The latest version, with this node's residency under `health`.
  get: (id: string) =>
    api.get<DataResponse<Model>>(`admin/models/${encodeURIComponent(id)}`).then(unwrap),

  /**
   * Registers a draft and queues it for admission on this node. Answers 202 —
   * the row comes back with `admission.state: "pending"` and no `stats`.
   */
  create: (req: CreateModelRequest) =>
    api.post<DataResponse<Model>>("admin/models", req).then(unwrap),

  // Updates the draft; an absent field keeps its value. A changed `artifact`
  // resets the verdict to pending and queues the draft again.
  update: (id: string, req: UpdateModelRequest) =>
    api.put<DataResponse<Model>>(`admin/models/${encodeURIComponent(id)}`, req).then(unwrap),

  // Every version. The cached artifact stays in this node's cache until swept.
  delete: (id: string) => api.delete<void>(`admin/models/${encodeURIComponent(id)}`),

  /**
   * Validate a registration without storing it: `valid: true` means
   * `POST admin/models` would accept this payload on this node. `head` carries
   * what the bucket said about the object — its size and ETag — so a wrong
   * connector or key is caught before a draft exists.
   */
  validate: (req: CreateModelRequest) =>
    api.post<DataResponse<ModelValidationResponse>>("admin/models/validate", req).then(unwrap),

  /**
   * Activate (supersedes the previously active version in the same
   * transaction, so an id resolves to one digest per generation) or archive.
   * Activation is refused with a 409 until admission has passed; archiving is
   * refused while an active workflow names the model.
   */
  changeStatus: (id: string, req: StatusChangeRequest, opts: StatusChangeOptions = {}) =>
    api
      .patch<DataResponse<Model>>(
        `admin/models/${encodeURIComponent(id)}/status${buildQuery({ reload: opts.reload })}`,
        req
      )
      .then(unwrap),

  /** Pre-flight the transition — see `channelsApi.changeStatusDryRun`. */
  changeStatusDryRun: (id: string, req: StatusChangeRequest) =>
    api
      .patch<DataResponse<ModelValidationResponse>>(
        `admin/models/${encodeURIComponent(id)}/status${buildQuery({ dry_run: true })}`,
        req
      )
      .then(unwrap),

  /**
   * Run admission for the latest version on this node again — after fixing a
   * bucket permission, replacing the object, or a fetch that failed. Idempotent.
   * `wait` runs it inline and answers 200 with the verdict recorded; without
   * it the job is queued and the 202 body still carries the *old* verdict.
   */
  admit: (id: string, opts: AdmitModelOptions = {}) =>
    api
      .post<DataResponse<Model>>(
        `admin/models/${encodeURIComponent(id)}/admit${buildQuery({ wait: opts.wait })}`
      )
      .then(unwrap),

  listVersions: (id: string, params: { limit?: number; offset?: number } = {}) =>
    api.get<PaginatedResponse<Model>>(
      `admin/models/${encodeURIComponent(id)}/versions${buildQuery(params as Record<string, number | undefined>)}`
    ),

  // The verdict and stats come with the new draft, because the reference is
  // unchanged — a re-admission is only needed once the artifact moves.
  createVersion: (id: string) =>
    api.post<DataResponse<Model>>(`admin/models/${encodeURIComponent(id)}/versions`).then(unwrap),

  // The active workflows calling `model_infer` on this id as a *literal*, with
  // the task ids. A computed `model` is not listed and not gated on.
  dependencies: (id: string) =>
    api
      .get<DataResponse<ModelDependencies>>(
        `admin/models/${encodeURIComponent(id)}/dependencies`
      )
      .then(unwrap),

  // Items carry the manifest and the reference, never bytes. Each one written
  // is queued for admission on this node.
  import: (items: CreateModelRequest[], opts: ImportOptions = {}) =>
    api
      .post<DataResponse<ImportResult>>(
        `admin/models/import${buildQuery({ dry_run: opts.dryRun, on_conflict: opts.onConflict })}`,
        items
      )
      .then(unwrap),

  // References only, importable as they are — there is no `include_artifacts`
  // counterpart to the plugin export, because a model never travels as bytes.
  export: (params: ExportModelsParams = {}) =>
    api
      .get<DataResponse<Model[]>>(
        `admin/models/export${buildQuery(params as Record<string, string | number | undefined>)}`
      )
      .then(unwrap),
}
