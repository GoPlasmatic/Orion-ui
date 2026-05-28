import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { channelsApi } from "@/api/channels"
import type {
  CreateChannelRequest,
  ListChannelsParams,
  StatusChangeRequest,
  UpdateChannelRequest,
} from "@/api/types"

export function useChannels(params: ListChannelsParams = {}) {
  return useQuery({
    queryKey: ["channels", params],
    queryFn: () => channelsApi.list(params),
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
    },
  })
}

export function useUpdateChannel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateChannelRequest }) =>
      channelsApi.update(id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] })
    },
  })
}

export function useDeleteChannel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => channelsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] })
    },
  })
}

export function useChangeChannelStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: StatusChangeRequest }) =>
      channelsApi.changeStatus(id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] })
      queryClient.invalidateQueries({ queryKey: ["engine"] })
    },
  })
}

export function useCreateChannelVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => channelsApi.createVersion(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["channels", id] })
      queryClient.invalidateQueries({ queryKey: ["channels", id, "versions"] })
    },
  })
}

export function useImportChannels() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ items, dryRun }: { items: CreateChannelRequest[]; dryRun?: boolean }) =>
      channelsApi.import(items, dryRun),
    onSuccess: (_data, vars) => {
      if (!vars.dryRun) queryClient.invalidateQueries({ queryKey: ["channels"] })
    },
  })
}
