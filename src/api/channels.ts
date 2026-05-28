import { api, buildQuery } from "./client"
import type {
  Channel,
  CreateChannelRequest,
  DataResponse,
  ImportResult,
  ListChannelsParams,
  PaginatedResponse,
  StatusChangeRequest,
  UpdateChannelRequest,
} from "./types"

export const channelsApi = {
  list: (params: ListChannelsParams = {}) =>
    api.get<PaginatedResponse<Channel>>(
      `admin/channels${buildQuery(params as Record<string, string | number | undefined>)}`
    ),

  get: (id: string) =>
    api.get<DataResponse<Channel>>(`admin/channels/${id}`).then((r) => r.data),

  create: (req: CreateChannelRequest) =>
    api.post<DataResponse<Channel>>("admin/channels", req).then((r) => r.data),

  update: (id: string, req: UpdateChannelRequest) =>
    api.put<DataResponse<Channel>>(`admin/channels/${id}`, req).then((r) => r.data),

  delete: (id: string) => api.delete<void>(`admin/channels/${id}`),

  changeStatus: (id: string, req: StatusChangeRequest) =>
    api.patch<DataResponse<Channel>>(`admin/channels/${id}/status`, req).then((r) => r.data),

  listVersions: (id: string) =>
    api.get<PaginatedResponse<Channel>>(`admin/channels/${id}/versions`),

  createVersion: (id: string) =>
    api.post<DataResponse<Channel>>(`admin/channels/${id}/versions`).then((r) => r.data),

  import: (items: CreateChannelRequest[], dryRun = false) =>
    api.post<ImportResult>(`admin/channels/import${buildQuery({ dry_run: dryRun })}`, items),
}
