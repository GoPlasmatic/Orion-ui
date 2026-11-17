import { useMemo } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-error"
import { channelsApi } from "@/api/channels"
import { useRegistry } from "@/hooks/use-registry"

/** Every channel the head deploys. 2.0 has no channel listing: this reads the manifest (`useRegistry`). */
export function useChannels() {
  const registry = useRegistry()
  return { data: registry.channels, isLoading: registry.isLoading, error: registry.error, empty: registry.empty, refetch: registry.refetch }
}

/**
 * One deployed channel by its member id. `notDeployed` is the honest answer
 * for an id the head does not carry — it may be in an older revision, or a
 * 1.x link to a channel that never existed here.
 */
export function useChannel(id: string) {
  const registry = useRegistry()
  const channel = useMemo(() => registry.channels.find((c) => c.channel_id === id), [registry.channels, id])
  return {
    data: channel,
    isLoading: registry.isLoading && !channel,
    error: registry.error,
    refetch: registry.refetch,
    notDeployed: !registry.isLoading && !registry.error && !channel,
  }
}

/**
 * Run a deployed cron channel now. The occurrence ledger is what changes, so
 * that is what gets invalidated.
 */
export function useTriggerChannel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => channelsApi.trigger(id),
    onSuccess: (occurrence) => {
      queryClient.invalidateQueries({ queryKey: ["cron"] })
      toast.success("Occurrence created", {
        description:
          occurrence.status === "skipped_singleton"
            ? "Skipped: another occurrence holds the singleton key"
            : `Attempt ${occurrence.attempt} · ${occurrence.status}`,
      })
    },
    onError: (e) => toastError("Failed to trigger channel", e),
  })
}
