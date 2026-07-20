import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { backupApi } from "@/api/backup"

const errorDescription = (e: unknown) => (e instanceof Error ? e.message : undefined)

export function useBackups() {
  return useQuery({
    queryKey: ["backups"],
    queryFn: () => backupApi.list(),
  })
}

export function useCreateBackup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => backupApi.create(),
    onSuccess: (backup) => {
      queryClient.invalidateQueries({ queryKey: ["backups"] })
      toast.success("Backup created", { description: backup.filename })
    },
    onError: (e) => toast.error("Failed to create backup", { description: errorDescription(e) }),
  })
}
