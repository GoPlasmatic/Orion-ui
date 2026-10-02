import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { cacheApi } from "@/api/cache"
import { toastError } from "@/lib/toast-error"

// Invalidating a namespace changes no entity and nothing the console caches,
// so there is nothing to invalidate on our side — only the server's entries.
export function useInvalidateCacheNamespace() {
  return useMutation({
    mutationFn: (namespace: string) => cacheApi.invalidateNamespace(namespace),
    onSuccess: (r) =>
      toast.success(
        `Invalidated "${r.namespace}" in ${r.stores} cache ${r.stores === 1 ? "store" : "stores"}`
      ),
    onError: (e) => toastError("Failed to invalidate cache namespace", e),
  })
}
