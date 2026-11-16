import { useQuery } from "@tanstack/react-query"
import { fetchReadiness, runtimeApi } from "@/api/runtime"
import { EDITION_TIERS, type EditionTier } from "@/api/types"

/** The API contract revision this console is built for. */
export const SUPPORTED_API_VERSION = 2

/**
 * `GET admin/runtime-capabilities`, the one answer to "can this server do X":
 * the edition, channel drivers, provider backends, the deployment head and
 * this node's reconciler. Polled slowly — the head moves on every apply, and
 * the node status is what a convergence banner reads.
 */
export function useRuntimeCapabilities() {
  return useQuery({
    queryKey: ["runtime-capabilities"],
    queryFn: () => runtimeApi.capabilities(),
    refetchInterval: 30_000,
  })
}

export function useReadiness() {
  return useQuery({
    queryKey: ["readiness"],
    queryFn: fetchReadiness,
    refetchInterval: 30_000,
  })
}

/** Whether `edition` is at or above `tier` on the community < standard < enterprise ladder. */
export function editionAtLeast(edition: EditionTier, tier: EditionTier): boolean {
  return EDITION_TIERS.indexOf(edition) >= EDITION_TIERS.indexOf(tier)
}

/**
 * Features a lower edition does not serve, and the tier each needs. The
 * server is the authority (it answers 403 `TIER_NOT_ENABLED`); this is how
 * the console says so *before* anyone tries, as a neutral fact rather than a
 * failure.
 */
export const FEATURE_TIERS = {
  /** Canary traffic splitting: a channel member's `rollouts` across workflow revisions. */
  rollouts: "standard",
} as const satisfies Record<string, EditionTier>

export type Feature = keyof typeof FEATURE_TIERS

export interface FeatureAvailability {
  /** `undefined` while the edition is not yet known — neither offer nor refuse. */
  enabled: boolean | undefined
  /** The tier the feature needs. */
  requires: EditionTier
  /** The edition this node runs, once known. */
  edition: EditionTier | undefined
}

export function useFeature(feature: Feature): FeatureAvailability {
  const edition = useRuntimeCapabilities().data?.edition
  const requires = FEATURE_TIERS[feature]
  return { enabled: edition ? editionAtLeast(edition, requires) : undefined, requires, edition }
}
