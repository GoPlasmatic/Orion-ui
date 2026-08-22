import { api, buildQuery, unwrap } from "./client"
import type {
  CreateWorkflowRequest,
  DataResponse,
  ImportOptions,
  ImportResult,
  ListWorkflowsParams,
  PaginatedResponse,
  ReloadMode,
  StatusChangeOptions,
  StatusChangeRequest,
  UpdateWorkflowRequest,
  ValidationResponse,
  Workflow,
  WorkflowDependencies,
  WorkflowRolloutRequest,
  WorkflowTestRequest,
  WorkflowTestResponse,
} from "./types"

export const workflowsApi = {
  create: (req: CreateWorkflowRequest) =>
    api.post<DataResponse<Workflow>>("admin/workflows", req).then(unwrap),

  update: (id: string, req: UpdateWorkflowRequest) =>
    api.put<DataResponse<Workflow>>(`admin/workflows/${id}`, req).then(unwrap),

  list: (params: ListWorkflowsParams = {}) =>
    api.get<PaginatedResponse<Workflow>>(
      `admin/workflows${buildQuery(params as Record<string, string | number | undefined>)}`
    ),

  get: (id: string) => api.get<DataResponse<Workflow>>(`admin/workflows/${id}`).then(unwrap),

  delete: (id: string) => api.delete<void>(`admin/workflows/${id}`),

  changeStatus: (id: string, req: StatusChangeRequest, opts: StatusChangeOptions = {}) =>
    api
      .patch<DataResponse<Workflow>>(
        `admin/workflows/${id}/status${buildQuery({ reload: opts.reload })}`,
        req
      )
      .then(unwrap),

  /** Pre-flight the transition — see `channelsApi.changeStatusDryRun`. */
  changeStatusDryRun: (id: string, req: StatusChangeRequest) =>
    api
      .patch<DataResponse<ValidationResponse>>(
        `admin/workflows/${id}/status${buildQuery({ dry_run: true })}`,
        req
      )
      .then(unwrap),

  setRollout: (id: string, req: WorkflowRolloutRequest, opts: { reload?: ReloadMode } = {}) =>
    api
      .patch<DataResponse<Workflow>>(
        `admin/workflows/${id}/rollout${buildQuery({ reload: opts.reload })}`,
        req
      )
      .then(unwrap),

  listVersions: (id: string, params: { limit?: number; offset?: number } = {}) =>
    api.get<PaginatedResponse<Workflow>>(
      `admin/workflows/${id}/versions${buildQuery(params as Record<string, number | undefined>)}`
    ),

  createVersion: (id: string) =>
    api.post<DataResponse<Workflow>>(`admin/workflows/${id}/versions`).then(unwrap),

  test: (id: string, req: WorkflowTestRequest) =>
    api.post<DataResponse<WorkflowTestResponse>>(`admin/workflows/${id}/test`, req).then(unwrap),

  validate: (req: unknown) =>
    api.post<DataResponse<ValidationResponse>>("admin/workflows/validate", req).then(unwrap),

  /**
   * What the workflow's tasks reference: connector names with the referencing
   * function, statically-targeted `channel_call` channels, and whether any
   * `channel_call` resolves its target at runtime. The server walks the latest
   * version's tasks, so this is authoritative where client-side parsing guesses.
   */
  dependencies: (id: string) =>
    api.get<DataResponse<WorkflowDependencies>>(`admin/workflows/${id}/dependencies`).then(unwrap),

  import: (items: unknown[], opts: ImportOptions = {}) =>
    api
      .post<DataResponse<ImportResult>>(
        `admin/workflows/import${buildQuery({ dry_run: opts.dryRun, on_conflict: opts.onConflict })}`,
        items
      )
      .then(unwrap),

  export: (params: { tag?: string; status?: string } = {}) =>
    api
      .get<DataResponse<Workflow[]>>(
        `admin/workflows/export${buildQuery(params as Record<string, string | undefined>)}`
      )
      .then(unwrap),
}
