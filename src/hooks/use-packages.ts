import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { packagesApi } from "@/api/packages"
import type { ListPackagesParams } from "@/api/types"

export function usePackages(params: ListPackagesParams = {}) {
  return useQuery({
    queryKey: ["packages", params],
    queryFn: () => packagesApi.list(params),
    placeholderData: keepPreviousData,
  })
}

export function usePackage(name: string) {
  return useQuery({
    queryKey: ["packages", name],
    queryFn: () => packagesApi.get(name),
    enabled: !!name,
  })
}
