import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-error"
import { backupApi } from "@/api/backup"

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
    onError: (e) => toastError("Failed to create backup", e),
  })
}
