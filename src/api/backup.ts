import { api } from "./client"

export const backupApi = {
  create: () => api.post<Blob>("admin/backup"),

  restore: (data: FormData) =>
    api.post<{ message: string }>("admin/restore", data),
}
