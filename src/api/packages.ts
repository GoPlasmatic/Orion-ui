import { api, buildQuery, unwrap } from "./client"
import type {
  DataResponse,
  ListPackagesParams,
  PackageDetail,
  PackageReceipt,
  PaginatedResponse,
} from "./types"

/**
 * Package promotion receipts — read-only here.
 *
 * A package is the channels, workflows and connectors of one service promoted
 * between instances as a versioned unit. Packaging itself lives in client
 * tooling (`orion-server package`); what the server keeps is one receipt per
 * package version, because the promotion rule cannot be enforced unless the
 * target remembers what was applied: an applied version is immutable, and the
 * same version arriving with a different content hash is refused with a 409.
 *
 * `PUT admin/packages/{name}` is deliberately not exposed in the console —
 * recording and advancing receipts is CI's job, and hand-editing promotion
 * state from a UI would desync it from the artifact that owns it.
 */
export const packagesApi = {
  // Ordered by package name, newest first within a package.
  list: (params: ListPackagesParams = {}) =>
    api.get<PaginatedResponse<PackageReceipt>>(
      `admin/packages${buildQuery(params as Record<string, number | undefined>)}`
    ),

  // `current` names the newest applied version, or null if nothing is applied.
  get: (name: string) =>
    api.get<DataResponse<PackageDetail>>(`admin/packages/${encodeURIComponent(name)}`).then(unwrap),
}
