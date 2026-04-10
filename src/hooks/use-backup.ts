import { useMutation } from "@tanstack/react-query"
import { backupApi } from "@/api/backup"

export function useBackup() {
  return useMutation({
    mutationFn: () => backupApi.create(),
  })
}

export function useRestore() {
  return useMutation({
    mutationFn: (data: FormData) => backupApi.restore(data),
  })
}
