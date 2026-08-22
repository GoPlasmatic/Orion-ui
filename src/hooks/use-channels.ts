import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { channelsApi } from "@/api/channels"
import type {
  CreateChannelRequest,
  ImportOptions,
  ListChannelsParams,
  StatusChangeRequest,
  UpdateChannelRequest,
} from "@/api/types"

const errorDescription = (e: unknown) => (e instanceof Error ? e.message : undefined)

export function useChannels(params: ListChannelsParams = {}, enabled = true) {
  return useQuery({
    queryKey: ["channels", params],
    queryFn: () => channelsApi.list(params),
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
    onError: (e) => toast.error("Failed to create channel", { description: errorDescription(e) }),
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
    onError: (e) => toast.error("Failed to update channel", { description: errorDescription(e) }),
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
    onError: (e) => toast.error("Failed to delete channel", { description: errorDescription(e) }),
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
    onError: (e) => toast.error("Failed to change channel status", { description: errorDescription(e) }),
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
    onError: (e) => toast.error("Failed to create channel version", { description: errorDescription(e) }),
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
