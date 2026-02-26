import { api } from "./client"
import type { Job, ListJobsParams, PaginatedResponse } from "./types"

function buildQuery(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  if (entries.length === 0) return ""
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")
}

export const jobsApi = {
  list: (params: ListJobsParams = {}) =>
    api.get<PaginatedResponse<Job>>(`data/jobs${buildQuery(params as Record<string, string | number | undefined>)}`),

  get: (id: string) =>
    api.get<PaginatedResponse<Job>>(`data/jobs?limit=1&offset=0`).then((res) => {
      const job = res.data.find((j) => j.id === id)
      if (!job) throw new Error(`Job ${id} not found`)
      return job
    }),
}
