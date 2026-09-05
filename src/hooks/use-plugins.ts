import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-error"
import { pluginsApi } from "@/api/plugins"
import type {
  CreatePluginRequest,
  ImportOptions,
  ListPluginsParams,
  StatusChangeRequest,
  UpdatePluginRequest,
} from "@/api/types"

export function usePlugins(params: ListPluginsParams = {}, enabled = true) {
  return useQuery({
    queryKey: ["plugins", params],
    queryFn: () => pluginsApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function usePlugin(id: string) {
  return useQuery({
    queryKey: ["plugins", id],
    queryFn: () => pluginsApi.get(id),
    enabled: !!id,
  })
}

export function usePluginVersions(id: string) {
  return useQuery({
    queryKey: ["plugins", id, "versions"],
    queryFn: () => pluginsApi.listVersions(id),
    enabled: !!id,
  })
}

export function usePluginDependencies(id: string) {
  return useQuery({
    queryKey: ["plugins", id, "dependencies"],
    queryFn: () => pluginsApi.dependencies(id),
    enabled: !!id,
  })
}

export function useCreatePlugin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (req: CreatePluginRequest) => pluginsApi.create(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plugins"] })
      toast.success("Plugin uploaded as draft")
    },
    onError: (e) => toastError("Failed to upload plugin", e),
  })
}

export function useUpdatePlugin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdatePluginRequest }) =>
      pluginsApi.update(id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plugins"] })
      toast.success("Plugin updated")
    },
    onError: (e) => toastError("Failed to update plugin", e),
  })
}

export function useDeletePlugin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => pluginsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plugins"] })
      queryClient.invalidateQueries({ queryKey: ["functions"] })
      toast.success("Plugin deleted")
    },
    onError: (e) => toastError("Failed to delete plugin", e),
  })
}

/**
 * Activating or archiving a plugin changes the function vocabulary: its
 * functions enter or leave `GET admin/functions`, and every workflow calling
 * them is re-screened. So the catalogue and the workflow list are invalidated
 * alongside the plugin itself.
 */
export function useChangePluginStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: StatusChangeRequest }) =>
      pluginsApi.changeStatus(id, req),
    onSuccess: (_data, { req }) => {
      queryClient.invalidateQueries({ queryKey: ["plugins"] })
      queryClient.invalidateQueries({ queryKey: ["functions"] })
      queryClient.invalidateQueries({ queryKey: ["workflows"] })
      queryClient.invalidateQueries({ queryKey: ["engine"] })
      queryClient.invalidateQueries({ queryKey: ["health"] })
      toast.success(`Plugin ${req.status === "active" ? "activated" : req.status}`)
    },
    onError: (e) => toastError("Failed to change plugin status", e),
  })
}

/** Untoasted — the findings render inline; a refusal is information. */
export function usePluginStatusDryRun() {
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: StatusChangeRequest }) =>
      pluginsApi.changeStatusDryRun(id, req),
  })
}

export function useCreatePluginVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => pluginsApi.createVersion(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["plugins", id] })
      queryClient.invalidateQueries({ queryKey: ["plugins", id, "versions"] })
      toast.success("New plugin version created")
    },
    onError: (e) => toastError("Failed to create plugin version", e),
  })
}

/** Untoasted — the validation envelope renders inline in the form. */
export function useValidatePlugin() {
  return useMutation({
    mutationFn: (req: CreatePluginRequest) => pluginsApi.validate(req),
  })
}

export function useImportPlugins() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ items, ...opts }: { items: CreatePluginRequest[] } & ImportOptions) =>
      pluginsApi.import(items, opts),
    onSuccess: (_data, vars) => {
      if (!vars.dryRun) queryClient.invalidateQueries({ queryKey: ["plugins"] })
    },
  })
}
