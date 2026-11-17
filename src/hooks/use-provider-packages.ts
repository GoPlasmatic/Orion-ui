import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { connectorPackagesApi } from "@/api/connector-packages"
import { authoringApi } from "@/api/authoring"
import { useCursorList } from "@/hooks/use-cursor-list"
import { toastError } from "@/lib/toast-error"
import type { ConnectorPackageSummary, Page, PackageFiles, ScaffoldRequest, UploadPackageRequest } from "@/api/types"

/** The stored provider packages, a page at a time. */
export function useProviderPackageList() {
  return useCursorList<Page<ConnectorPackageSummary>>(
    ["connector-packages", "list"],
    (cursor) => connectorPackagesApi.list({ limit: 50, cursor }),
  )
}

export function useProviderPackage(digest: string) {
  return useQuery({
    queryKey: ["connector-packages", "one", digest],
    queryFn: () => connectorPackagesApi.get(digest),
    enabled: !!digest,
  })
}

/** Admitting or revoking changes what this node's provider backends serve. */
function invalidateAfterChange(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["connector-packages"] })
  void queryClient.invalidateQueries({ queryKey: ["runtime-capabilities"] })
  void queryClient.invalidateQueries({ queryKey: ["audit-logs"] })
}

/** Untoasted on error: the upload dialog renders the server's findings inline. */
export function useUploadPackage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (req: UploadPackageRequest) => connectorPackagesApi.upload(req),
    onSuccess: (res) => {
      invalidateAfterChange(queryClient)
      toast.success(res.admission ? "Package uploaded and admitted" : "Package uploaded")
    },
  })
}

export function useAdmitPackage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ digest, lock }: { digest: string; lock?: unknown }) => connectorPackagesApi.admit(digest, lock),
    onSuccess: () => {
      invalidateAfterChange(queryClient)
      toast.success("Package admitted")
    },
    onError: (e) => toastError("Failed to admit the package", e),
  })
}

export function useRevokePackage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ digest, reason }: { digest: string; reason?: string }) => connectorPackagesApi.revoke(digest, reason),
    onSuccess: () => {
      invalidateAfterChange(queryClient)
      toast.success("Package revoked")
    },
    onError: (e) => toastError("Failed to revoke the package", e),
  })
}

/** The authoring tools: untoasted, their answers render inline. A read-only key may use all three. */
export function useScaffold() {
  return useMutation({ mutationFn: (req: ScaffoldRequest) => authoringApi.scaffold(req) })
}
export function useLintPackage() {
  return useMutation({ mutationFn: (files: PackageFiles) => authoringApi.lint(files) })
}
export function usePackPackage() {
  return useMutation({ mutationFn: (files: PackageFiles) => authoringApi.pack(files) })
}
