import { useQuery } from "@tanstack/react-query"
import { jobsApi } from "@/api/jobs"
import type { ListJobsParams } from "@/api/types"

export function useJobs(params: ListJobsParams = {}) {
  return useQuery({
    queryKey: ["jobs", params],
    queryFn: () => jobsApi.list(params),
  })
}

export function useJob(id: string) {
  return useQuery({
    queryKey: ["jobs", id],
    queryFn: () => jobsApi.get(id),
    enabled: !!id,
  })
}
