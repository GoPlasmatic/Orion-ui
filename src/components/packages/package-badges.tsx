import { Badge } from "@/components/ui/badge"
import { EDITION_TIERS, type ConnectorPackageSummary, type EditionTier } from "@/api/types"

/** A package's tier, and — when it is above this node's edition — that this node cannot admit it. */
export function TierBadge({ tier, edition }: { tier: EditionTier; edition: EditionTier | undefined }) {
  const above = !!edition && EDITION_TIERS.indexOf(tier) > EDITION_TIERS.indexOf(edition)
  return (
    <Badge
      variant="outline"
      className={above ? "border-dashed text-muted-foreground" : undefined}
      title={above ? `Needs Orion ${tier}; this node is ${edition}, so it can store the package but not admit it` : undefined}
    >
      {tier}
      {above && " · needs edition"}
    </Badge>
  )
}

/** Admitted, revoked or only stored — and the artifact's own state when it is leaving. */
export function PackageStateBadge({ pkg }: { pkg: Pick<ConnectorPackageSummary, "admitted" | "revoked" | "artifact_state"> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {pkg.revoked ? (
        <Badge variant="outline" className="border-destructive/40 text-destructive">
          revoked
        </Badge>
      ) : pkg.admitted ? (
        <Badge variant="outline" className="border-success/40 text-success">
          admitted
        </Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          not admitted
        </Badge>
      )}
      {pkg.artifact_state !== "active" && (
        <Badge variant="outline" className="text-muted-foreground" title="Where the stored bytes are in their lifecycle">
          {pkg.artifact_state}
        </Badge>
      )}
    </span>
  )
}
