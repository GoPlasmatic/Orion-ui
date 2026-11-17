import { api, buildQuery, type RequestOptions } from "./client"
import type {
  ApplyDeploymentRequest,
  ConvergenceStatus,
  ConvergenceTarget,
  CreateDeploymentResponse,
  DeploymentManifest,
  DeploymentPlan,
  DeploymentRevision,
  DeploymentsPage,
  RollbackDeploymentRequest,
} from "./types"

/**
 * Orion 2.0's deployments: what a node serves is one manifest, committed as an
 * immutable, numbered revision. History is append-only — a rollback commits
 * an earlier revision's manifest again as the next revision. Every answer here
 * is bare (no `data` envelope).
 */
export const deploymentsApi = {
  /** Newest first, cursor-paged, with the head and the revision this node serves. */
  list: (params: { limit?: number; cursor?: string } = {}) =>
    api.get<DeploymentsPage>(`admin/deployments${buildQuery(params)}`),

  /** One revision with its manifest; a compacted revision's has no members. */
  get: (revision: number) => api.get<DeploymentRevision>(`admin/deployments/${revision}`),

  /** Which nodes serve `revision`: this one, or every node the cluster store has heard from. */
  convergence: (revision: number, target: ConvergenceTarget = "this-node") =>
    api.get<ConvergenceStatus>(`admin/deployments/${revision}/convergence${buildQuery({ target })}`),

  /** What a candidate changes against a base. Commits nothing; a read-only key may call it. */
  plan: (baseRevision: number, manifest: DeploymentManifest) =>
    api.post<DeploymentPlan>("admin/deployment-plans", { base_revision: baseRevision, manifest }),

  /**
   * Commit a reviewed candidate (202). The server re-checks it as of now and
   * refuses a `reviewed_manifest_digest` that plans to anything else. A replay
   * of the same `idempotency_key` answers the first receipt.
   */
  apply: (req: ApplyDeploymentRequest, opts?: RequestOptions) =>
    api.post<CreateDeploymentResponse>("admin/deployments", req, opts),

  /**
   * Commit an earlier revision's manifest again as the next revision (202).
   * 409 `DEPLOYMENT_HEAD_CONFLICT` when the head moved past `base_revision`;
   * a replay of the same `idempotency_key` answers the first receipt, so a
   * retry after a dropped response is safe.
   */
  rollback: (req: RollbackDeploymentRequest, opts?: RequestOptions) =>
    api.post<CreateDeploymentResponse>("admin/deployments", req, opts),
}
