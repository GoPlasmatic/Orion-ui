import { api } from "./client"
import type { DataResponse, FunctionSchema } from "./types"

export const functionsApi = {
  list: () => api.get<DataResponse<FunctionSchema[]>>("admin/functions").then((r) => r.data),
}
