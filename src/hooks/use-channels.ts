import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-error"
import { channelsApi } from "@/api/channels"
import type {
  CreateChannelRequest,
  ImportOptions,
  ListChannelsParams,
  StatusChangeRequest,
  UpdateChannelRequest,
} from "@/api/types"

export function useChannels(params: ListChannelsParams = {}, enabled = true) {
  return useQuery({
    queryKey: ["channels", params],
    queryFn: () => channelsApi.list(params),
    // Paging or filtering changes the query key; without this the table drops
    // to a skeleton on every page turn instead of holding the last page while
    // the next one loads. Every paginated list hook does the same.
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useChannel(id: string) {
  return useQuery({
    queryKey: ["channels", id],
    queryFn: () => channelsApi.get(id),
    enabled: !!id,
  })
}

export function useChannelVersions(id: string) {
  return useQuery({
    queryKey: ["channels", id, "versions"],
    queryFn: () => channelsApi.listVersions(id),
    enabled: !!id,
  })
}

export function useCreateChannel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateChannelRequest) => channelsApi.create(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] })
      toast.success("Channel created")
    },
    onError: (e) => toastError("Failed to create channel", e),
  })
}

export function useUpdateChannel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateChannelRequest }) =>
      channelsApi.update(id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] })
      toast.success("Channel updated")
    },
    onError: (e) => toastError("Failed to update channel", e),
  })
}

export function useDeleteChannel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => channelsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] })
      toast.success("Channel deleted")
    },
    onError: (e) => toastError("Failed to delete channel", e),
  })
}

export function useChangeChannelStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: StatusChangeRequest }) =>
      channelsApi.changeStatus(id, req),
    onSuccess: (_data, { req }) => {
      queryClient.invalidateQueries({ queryKey: ["channels"] })
      queryClient.invalidateQueries({ queryKey: ["engine"] })
      toast.success(`Channel ${req.status === "active" ? "activated" : req.status}`)
    },
    onError: (e) => toastError("Failed to change channel status", e),
  })
}

export function useCreateChannelVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => channelsApi.createVersion(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["channels", id] })
      queryClient.invalidateQueries({ queryKey: ["channels", id, "versions"] })
      toast.success("New channel version created")
    },
    onError: (e) => toastError("Failed to create channel version", e),
  })
}

/** Untoasted — the validation envelope renders inline in the form. */
export function useValidateChannel() {
  return useMutation({
    mutationFn: (req: CreateChannelRequest) => channelsApi.validate(req),
  })
}

export function useChannelStatusDryRun() {
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: StatusChangeRequest }) =>
      channelsApi.changeStatusDryRun(id, req),
  })
}

/**
 * Run an active cron channel now. The occurrence ledger is what changes, so
 * that is what gets invalidated — the channel row itself is untouched.
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

export function useImportChannels() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ items, ...opts }: { items: CreateChannelRequest[] } & ImportOptions) =>
      channelsApi.import(items, opts),
    onSuccess: (_data, vars) => {
      if (!vars.dryRun) queryClient.invalidateQueries({ queryKey: ["channels"] })
    },
  })
}
