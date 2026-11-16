import { Link, useNavigate } from "react-router"
import { useDeploymentList } from "@/hooks/use-deployments"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { Fact } from "@/components/shared/fact"
import { EmptyState } from "@/components/shared/empty-state"
import { ErrorState } from "@/components/shared/error-state"
import { LoadMoreFooter } from "@/components/shared/load-more"
import { shortDigest } from "@/lib/deployment-diff"
import { formatDate, formatRelative } from "@/lib/utils"
import { GitCommitVertical } from "lucide-react"

/**
 * The deployment history (2.0): every committed revision, newest first. A
 * node serves one manifest at a time — the head — and history is append-only:
 * a rollback is a new revision carrying an older one's manifest. The header
 * says what the head is and what the node that answered serves, because the
 * two differ while it converges.
 */
export function DeploymentsPage() {
  const navigate = useNavigate()
  const list = useDeploymentList()
  const first = list.first
  const head = first?.head_revision ?? 0
  const applied = first?.applied_revision ?? 0

  if (list.error && !first) {
    return <ErrorState title="Could not read the deployment history" error={list.error} onRetry={list.refetch} />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deployments"
        description="Every revision committed to this server, newest first. Changes are applied with orion-cli; here they are inspected, compared and rolled back."
      />

      {first && head > 0 && (
        <Card>
          <CardContent className="pt-6">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <Fact label="Head revision">
                <Link to={`/deployments/${head}`} className="underline underline-offset-2">
                  {head}
                </Link>
              </Fact>
              <Fact label="Served by this node">{applied === 0 ? "none" : applied}</Fact>
              <Fact label="Epoch">{first.epoch}</Fact>
              <Fact label="Latest change" mono={false}>
                {first.data[0] ? formatRelative(first.data[0].created_at) ?? formatDate(first.data[0].created_at) : "—"}
              </Fact>
            </dl>
            {applied !== head && (
              <Callout variant="info" className="mt-4">
                This node serves revision {applied || "none"} while the head is {head}: it is converging,
                or cannot build the head.{" "}
                <Link to={`/deployments/${head}?tab=convergence`}>See convergence</Link>
              </Callout>
            )}
          </CardContent>
        </Card>
      )}

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Revision</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Manifest</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Committed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : list.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="p-0">
                  <EmptyState
                    icon={GitCommitVertical}
                    title="Nothing deployed yet"
                    description="A deployment is the whole of what this server serves: its channels, workflows, connections and plugins, committed as one numbered revision. Compile a definition set and apply it with orion-cli deployments apply -d."
                  />
                </TableCell>
              </TableRow>
            ) : (
              list.rows.map((r) => (
                <TableRow key={r.revision} onActivate={() => navigate(`/deployments/${r.revision}`)}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span className="font-mono font-medium">{r.revision}</span>
                      {r.revision === head && <Badge variant="outline">head</Badge>}
                      {r.revision === applied && r.revision !== head && (
                        <Badge variant="outline" title="The revision the node that answered serves">
                          served here
                        </Badge>
                      )}
                      {r.members_compacted && (
                        <Badge variant="outline" className="text-muted-foreground" title="The collector dropped this revision's members: it can no longer be inspected or rolled back to">
                          compacted
                        </Badge>
                      )}
                    </span>
                    {r.parent_revision != null && (
                      <span className="text-xs text-muted-foreground">on {r.parent_revision}</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs truncate" title={r.reason}>
                    {r.reason || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="tabular-nums">{r.members_compacted ? "—" : r.member_count}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground" title={r.manifest_digest}>
                    {shortDigest(r.manifest_digest)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.created_by}</TableCell>
                  <TableCell className="text-muted-foreground" title={formatDate(r.created_at)}>
                    {formatRelative(r.created_at) ?? formatDate(r.created_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <LoadMoreFooter
        count={list.rows.length}
        hasMore={list.hasMore}
        pending={list.isFetchingMore}
        onLoadMore={list.loadMore}
        noun="revision"
      />
    </div>
  )
}
