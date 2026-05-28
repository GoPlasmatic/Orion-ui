import { api, buildQuery } from "./client"
import type {
  DataResponse,
  ImportResult,
  ListWorkflowsParams,
  PaginatedResponse,
  StatusChangeRequest,
  ValidationResponse,
  Workflow,
  WorkflowRolloutRequest,
  WorkflowTestRequest,
  WorkflowTestResponse,
} from "./types"

export const workflowsApi = {
  list: (params: ListWorkflowsParams = {}) =>
    api.get<PaginatedResponse<Workflow>>(
      `admin/workflows${buildQuery(params as Record<string, string | number | undefined>)}`
    ),

  get: (id: string) =>
    api.get<DataResponse<Workflow>>(`admin/workflows/${id}`).then((r) => r.data),

  delete: (id: string) => api.delete<void>(`admin/workflows/${id}`),

  changeStatus: (id: string, req: StatusChangeRequest) =>
    api.patch<DataResponse<Workflow>>(`admin/workflows/${id}/status`, req).then((r) => r.data),

  setRollout: (id: string, req: WorkflowRolloutRequest) =>
    api.patch<DataResponse<Workflow>>(`admin/workflows/${id}/rollout`, req).then((r) => r.data),

  listVersions: (id: string) =>
    api.get<PaginatedResponse<Workflow>>(`admin/workflows/${id}/versions`),

  createVersion: (id: string) =>
    api.post<DataResponse<Workflow>>(`admin/workflows/${id}/versions`).then((r) => r.data),

  test: (id: string, req: WorkflowTestRequest) =>
    api.post<WorkflowTestResponse>(`admin/workflows/${id}/test`, req),

  validate: (req: unknown) =>
    api.post<ValidationResponse>("admin/workflows/validate", req),

  import: (items: unknown[], dryRun = false) =>
    api.post<ImportResult>(`admin/workflows/import${buildQuery({ dry_run: dryRun })}`, items),

  export: (params: { tag?: string; status?: string } = {}) =>
    api.get<Workflow[]>(
      `admin/workflows/export${buildQuery(params as Record<string, string | undefined>)}`
    ),
}
