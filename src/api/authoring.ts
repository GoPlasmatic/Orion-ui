import { api } from "./client"
import type { LintResponse, PackResponse, PackageFiles, ScaffoldRequest, ScaffoldResponse } from "./types"

/**
 * The provider-package authoring tools, served so a browser can use them:
 * scaffold a package, lint its files, pack them to the digest an upload
 * would get. Nothing is stored, so a read-only key may use all three.
 */
export const authoringApi = {
  scaffold: (req: ScaffoldRequest) => api.post<ScaffoldResponse>("admin/authoring/scaffold", req),
  lint: (files: PackageFiles) => api.post<LintResponse>("admin/authoring/lint", { files }),
  pack: (files: PackageFiles) => api.post<PackResponse>("admin/authoring/pack", { files }),
}
