import { api, buildQuery } from "./client"
import type {
  AdmitPackageResponse,
  ConnectorPackage,
  ConnectorPackageSummary,
  Page,
  PageParams,
  RevokePackageResponse,
  UploadPackageRequest,
} from "./types"

/**
 * Connector provider packages (2.0): a provider shipped as files — a
 * `workflow` composite or a `wasm` component — uploaded by digest, then
 * admitted under this node's admission policy before a connection may name
 * it. Revocation is permanent for that digest. Every answer is bare.
 */
export const connectorPackagesApi = {
  list: (params: PageParams = {}) =>
    api.get<Page<ConnectorPackageSummary>>(`admin/connector-packages${buildQuery({ ...params })}`),

  get: (digest: string) => api.get<ConnectorPackage>(`admin/connector-packages/${encodeURIComponent(digest)}`),

  /** Store a package's files (relative path → UTF-8 text or `base64:<…>`), optionally admitting it at once. */
  upload: (req: UploadPackageRequest) => api.post<ConnectorPackage>("admin/connector-packages", req),

  /** Admit an uploaded package, optionally against a provider lock. */
  admit: (digest: string, lock?: unknown) =>
    api.put<AdmitPackageResponse>(
      `admin/connector-packages/${encodeURIComponent(digest)}/admission`,
      lock === undefined ? null : { lock },
    ),

  /** Revoke an admitted package: no connection over it may be planned again. */
  revoke: (digest: string, reason?: string) =>
    api.post<RevokePackageResponse>(
      `admin/connector-packages/${encodeURIComponent(digest)}/revocations`,
      reason ? { reason } : null,
    ),
}
