import { api } from "./client"
import type { BackupCreated, BackupFile, DataResponse } from "./types"

// Backups are SQLite-only server-side; non-SQLite backends return 400.
// There is no restore endpoint in v0.3.
export const backupApi = {
  create: () => api.post<DataResponse<BackupCreated>>("admin/backups").then((r) => r.data),

  list: () => api.get<DataResponse<BackupFile[]>>("admin/backups").then((r) => r.data),
}
