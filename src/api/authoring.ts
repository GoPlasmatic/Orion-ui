import { api } from "./client"
import type { LintResponse, PackResponse, PackageFiles, ScaffoldRequest, ScaffoldResponse } from "./types"

/**
 * The provider-package authoring tools, served so a browser can use them:
 * scaffold a package, lint its files, pack them to the digest an upload
 * would get. Nothing is stored, so the server means a read-only key to be
 * allowed all three; Orion 2.0.0 still refuses them (its check sees the path
 * with the nested `/api/v2/admin` prefix stripped), and the 403 is reported
 * like any other refusal.
 */
export const authoringApi = {
  scaffold: (req: ScaffoldRequest) => api.post<ScaffoldResponse>("admin/authoring/scaffold", req),
  lint: (files: PackageFiles) => api.post<LintResponse>("admin/authoring/lint", { files }),
  pack: (files: PackageFiles) => api.post<PackResponse>("admin/authoring/pack", { files }),
}
