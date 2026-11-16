import { Fragment, useState } from "react"
import { hasDefinition, useDefinition } from "@/hooks/use-deployments"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { JsonViewer } from "@/components/shared/json-viewer"
import { ErrorState } from "@/components/shared/error-state"
import { RolloutBar } from "@/components/deployments/rollout-bar"
import { dependents, memberKey, refLabel, shortDigest, sortMembers } from "@/lib/deployment-diff"
import type { ManifestMember } from "@/api/types"
import { ChevronDown, ChevronRight } from "lucide-react"

/**
 * A manifest's members, channels first. A row opens to what the member is —
 * its stored definition (content-addressed, so fetched once) or, for a
 * connection, the configuration digest its revision names — and to what it
 * requires and what requires it. `quarantined` marks members the node that
 * answered could not serve (only meaningful for the revision it applies).
 */
export function MembersTable({
  members,
  quarantined,
}: {
  members: ManifestMember[]
  quarantined?: ReadonlyMap<string, string>
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Kind</TableHead>
            <TableHead>Id</TableHead>
            <TableHead>Revision</TableHead>
            <TableHead>Requires</TableHead>
            <TableHead>Digest</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortMembers(members).map((m) => {
            const key = memberKey(m.entity)
            const isOpen = open.has(key)
            const reason = quarantined?.get(key)
            return (
              <Fragment key={key}>
                <TableRow onActivate={() => toggle(key)} aria-expanded={isOpen}>
                  <TableCell className="text-muted-foreground">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{m.entity.kind}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{m.entity.id}</span>
                    {reason && (
                      <Badge variant="outline" className="ml-2 border-destructive/40 text-destructive" title={reason}>
                        quarantined
                      </Badge>
                    )}
                    {m.rollouts && m.rollouts.length > 1 && (
                      <Badge variant="outline" className="ml-2" title="Traffic is split across workflow revisions">
                        canary
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">r{m.entity.revision}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {(m.requires ?? []).length === 0 ? "—" : (m.requires ?? []).map(refLabel).join(", ")}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground" title={m.definition_digest}>
                    {shortDigest(m.definition_digest)}
                  </TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="bg-muted/30 py-3">
                      <MemberDetail member={m} members={members} quarantineReason={reason} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function MemberDetail({
  member,
  members,
  quarantineReason,
}: {
  member: ManifestMember
  members: ManifestMember[]
  quarantineReason?: string
}) {
  const definable = hasDefinition(member.entity.kind)
  const { data, isLoading, error, refetch } = useDefinition(member.definition_digest, definable)
  const usedBy = dependents(members, member.entity)
  const workflow = member.requires?.find((r) => r.kind === "workflow")?.id ?? member.entity.id

  return (
    <div className="space-y-3">
      {quarantineReason && (
        <p className="text-sm text-destructive">Quarantined on this node: {quarantineReason}</p>
      )}
      {member.rollouts && member.rollouts.length > 0 && <RolloutBar rollouts={member.rollouts} workflow={workflow} />}
      <p className="text-xs text-muted-foreground">
        {usedBy.length === 0
          ? "Nothing in this revision requires it."
          : `Required by ${usedBy.map((d) => refLabel(d.entity)).join(", ")}.`}
        {member.owning_package && ` Owned by provider package ${shortDigest(member.owning_package)}.`}
      </p>
      {!definable ? (
        <p className="text-sm text-muted-foreground">
          A connection member names its revision's configuration digest,{" "}
          <span className="font-mono">{member.definition_digest}</span>, rather than a stored definition.
        </p>
      ) : isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : error || !data ? (
        <ErrorState title={`Could not read the ${member.entity.kind} definition`} error={error} onRetry={refetch} />
      ) : (
        <JsonViewer data={data.definition} label={`${member.entity.kind} definition`} maxHeight="24rem" />
      )}
    </div>
  )
}
