import { Link } from "react-router"
import { useEntityHistory } from "@/hooks/use-registry"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/shared/empty-state"
import type { DefinitionKind } from "@/api/types"
import { PackageX, type LucideIcon } from "lucide-react"

/**
 * A detail page for an id the head does not deploy. It may have served in an
 * earlier revision — say which, since that is where its definition can still
 * be read — or it may be a 1.x link to something that never existed here.
 */
export function NotDeployedState({
  kind,
  id,
  backTo,
}: {
  kind: DefinitionKind
  id: string
  backTo: { to: string; label: string }
}) {
  const history = useEntityHistory({ kind, id })
  const last = history.entries[0]?.deployments[0]
  return (
    <div className="rounded-xl border bg-card shadow-xs">
      <EmptyState
        icon={PackageX}
        title={`The head does not deploy ${kind} "${id}"`}
        description={
          history.isLoading
            ? "Looking for it in the recent deployments…"
            : last != null
              ? `Revision ${last} was the last of the recent deployments to carry it. A ${kind} serves only while the deployed manifest names it.`
              : `None of the recent deployments carries it. In 2.0 a ${kind} exists only as a member of a deployment, applied with orion-cli.`
        }
        action={
          <>
            <Button variant="outline" asChild>
              <Link to={backTo.to}>{backTo.label}</Link>
            </Button>
            {last != null && (
              <Button asChild>
                <Link to={`/deployments/${last}`}>Open revision {last}</Link>
              </Button>
            )}
          </>
        }
      />
    </div>
  )
}

/** A member's health on this node, as a badge: quarantined, or nothing when it serves. */
export function QuarantineBadge({ reason }: { reason: string | undefined }) {
  if (!reason) return null
  return (
    <Badge variant="outline" className="border-destructive/40 text-destructive" title={reason}>
      quarantined
    </Badge>
  )
}

/**
 * An entity list over a head that deploys none of them. Teaches where they
 * come from in 2.0 — a deployment applied from the CLI — rather than offering
 * a Create button the server no longer has.
 */
export function NothingDeployedState({
  icon,
  noun,
  what,
  headEmpty,
}: {
  icon: LucideIcon
  /** Plural, lower case: "channels". */
  noun: string
  /** One sentence on what the primitive is. */
  what: string
  /** True before the first apply: nothing at all is deployed. */
  headEmpty: boolean
}) {
  return (
    <EmptyState
      icon={icon}
      title={headEmpty ? "Nothing is deployed yet" : `The head deploys no ${noun}`}
      description={`${what} They are deployed as members of a manifest: compile a definition set and apply it with orion-cli deployments apply -d <dir>.`}
      action={
        <Button variant="outline" asChild>
          <Link to="/deployments">Deployments</Link>
        </Button>
      }
    />
  )
}
