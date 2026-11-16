import { useMemo, useState } from "react"
import { Link, useParams } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { useDeployment, useDeploymentHead } from "@/hooks/use-deployments"
import { useRuntimeCapabilities } from "@/hooks/use-runtime-capabilities"
import { READ_ONLY_REASON, useCanMutate } from "@/hooks/use-admin-auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DetailHeader, DetailSkeleton } from "@/components/shared/detail-header"
import { ErrorState } from "@/components/shared/error-state"
import { Fact } from "@/components/shared/fact"
import { JsonViewer } from "@/components/shared/json-viewer"
import { MembersTable } from "@/components/deployments/members-table"
import { RevisionChanges } from "@/components/deployments/revision-changes"
import { ConvergencePanel } from "@/components/deployments/convergence-panel"
import { RollbackDialog } from "@/components/deployments/rollback-dialog"
import { memberKey, shortDigest } from "@/lib/deployment-diff"
import { useUrlFilters } from "@/lib/use-url-filters"
import { formatDate, formatRelative, plural } from "@/lib/utils"
import { History } from "lucide-react"

const TABS = ["members", "changes", "convergence", "manifest"] as const
type Tab = (typeof TABS)[number]
const URL_KEYS = ["tab", "compare"] as const

/**
 * One committed revision: its members, what it changed (against its parent,
 * or any revision in `?compare=`), which nodes serve it, and its raw
 * manifest. A revision that is not the head can be rolled back to, unless
 * the collector compacted its members away.
 */
export function DeploymentDetailPage() {
  const { revision: param } = useParams<{ revision: string }>()
  const revision = Number(param)
  const valid = Number.isInteger(revision) && revision > 0
  const { values, set } = useUrlFilters(URL_KEYS)
  const tab: Tab = (TABS as readonly string[]).includes(values.tab) ? (values.tab as Tab) : "members"

  const { data: rev, isLoading, error, refetch } = useDeployment(valid ? revision : null)
  const head = useDeploymentHead()
  const runtime = useRuntimeCapabilities()
  const canMutate = useCanMutate()
  const queryClient = useQueryClient()
  const [rollingBack, setRollingBack] = useState(false)

  const compareParam = Number(values.compare)
  const compareTo =
    Number.isInteger(compareParam) && compareParam > 0 && compareParam !== revision
      ? compareParam
      : (rev?.parent_revision ?? null)
  const base = useDeployment(tab === "changes" ? compareTo : null)
  const [compareDraft, setCompareDraft] = useState("")

  // What the node that answered could not serve — only meaningful for the
  // revision it applies.
  const node = runtime.data?.node_status
  const quarantined = useMemo(() => {
    if (!node || node.applied_revision !== revision) return undefined
    return new Map(node.quarantined_entities.map((q) => [memberKey(q.entity), q.reason]))
  }, [node, revision])

  if (!valid) {
    return <ErrorState title={`"${param}" is not a revision number`} backTo={{ to: "/deployments", label: "Back to Deployments" }} />
  }
  if (isLoading) return <DetailSkeleton />
  if (error || !rev) {
    return (
      <ErrorState
        title={`Failed to load revision ${revision}`}
        error={error}
        onRetry={() => refetch()}
        backTo={{ to: "/deployments", label: "Back to Deployments" }}
      />
    )
  }

  const headRev = head.data?.head ?? 0
  const isHead = revision === headRev
  const servedHere = node?.applied_revision === revision
  const canRollBack = !isHead && !rev.members_compacted && headRev > 0
  const rollbackBlocked = !canMutate ? READ_ONLY_REASON : undefined

  return (
    <div className="space-y-6">
      <DetailHeader
        breadcrumbs={[{ label: "Deployments", to: "/deployments" }, { label: `Revision ${revision}` }]}
        title={`Revision ${revision}`}
        badges={
          <>
            {isHead && <Badge variant="outline">head</Badge>}
            {servedHere && <Badge variant="outline">served by this node</Badge>}
            {rev.members_compacted && <Badge variant="outline">compacted</Badge>}
          </>
        }
        meta={
          <p className="text-sm text-muted-foreground">
            {rev.reason || "No reason recorded"} · by <span className="font-mono">{rev.created_by}</span> ·{" "}
            <span title={formatDate(rev.created_at)}>{formatRelative(rev.created_at) ?? formatDate(rev.created_at)}</span>
          </p>
        }
        actions={
          canRollBack && (
            <Button
              variant="outline"
              onClick={() => setRollingBack(true)}
              disabled={!!rollbackBlocked}
              title={rollbackBlocked ?? `Commit revision ${revision}'s manifest again as the next revision`}
            >
              <History className="h-4 w-4" /> Roll back to this revision
            </Button>
          )
        }
      />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
        <Fact label="Committed on">
          {rev.parent_revision != null ? (
            <Link to={`/deployments/${rev.parent_revision}`} className="underline underline-offset-2">
              {rev.parent_revision}
            </Link>
          ) : (
            "— (first)"
          )}
        </Fact>
        <Fact label="Members" mono={false}>
          {rev.members_compacted ? "compacted" : plural(rev.member_count, "member")}
        </Fact>
        <Fact label="Providers" mono={false}>
          {rev.manifest.providers.length}
        </Fact>
        <Fact label="Manifest digest" title={rev.manifest_digest}>
          {shortDigest(rev.manifest_digest)}
        </Fact>
        <Fact label="Committed" mono={false}>
          {formatDate(rev.created_at)}
        </Fact>
      </dl>

      {rev.members_compacted && (
        <Callout variant="muted">
          The collector dropped this revision's members to keep the history small. It stays in the
          history, but what it deployed can no longer be shown, compared or rolled back to.
        </Callout>
      )}

      <Tabs defaultValue="members" value={tab} onValueChange={(v) => set({ tab: v === "members" ? "" : v })}>
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="changes">Changes</TabsTrigger>
          <TabsTrigger value="convergence">Convergence</TabsTrigger>
          <TabsTrigger value="manifest">Manifest</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="space-y-3">
          {rev.manifest.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {rev.members_compacted ? "Compacted." : "This revision deploys nothing: every channel stopped serving."}
            </p>
          ) : (
            <MembersTable members={rev.manifest.members} quarantined={quarantined} />
          )}
        </TabsContent>

        <TabsContent value="changes" className="space-y-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              set({ compare: compareDraft.trim() })
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="compare-to">Compared with revision</Label>
              <Input
                id="compare-to"
                inputMode="numeric"
                className="w-32"
                placeholder={rev.parent_revision != null ? String(rev.parent_revision) : "none"}
                value={compareDraft}
                onChange={(e) => setCompareDraft(e.target.value)}
              />
            </div>
            <Button type="submit" variant="outline" size="sm">
              Compare
            </Button>
            {values.compare && (
              <Button type="button" variant="ghost" size="sm" onClick={() => { setCompareDraft(""); set({ compare: "" }) }}>
                Against its parent
              </Button>
            )}
          </form>
          {rev.members_compacted ? (
            <p className="text-sm text-muted-foreground">A compacted revision cannot be compared.</p>
          ) : compareTo == null ? (
            <RevisionChanges before={undefined} after={rev.manifest.members} />
          ) : base.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading revision {compareTo}…</p>
          ) : base.error || !base.data ? (
            <ErrorState title={`Could not read revision ${compareTo}`} error={base.error} />
          ) : base.data.members_compacted ? (
            <p className="text-sm text-muted-foreground">Revision {compareTo} is compacted: there is nothing to compare against.</p>
          ) : (
            <>
              <p className="text-sm">
                What revision {revision} changes against{" "}
                <Link to={`/deployments/${compareTo}`} className="underline underline-offset-2">
                  revision {compareTo}
                </Link>
                {compareTo === rev.parent_revision ? " (its parent)" : ""}:
              </p>
              <RevisionChanges before={base.data.manifest.members} after={rev.manifest.members} />
            </>
          )}
        </TabsContent>

        <TabsContent value="convergence">
          <ConvergencePanel revision={revision} />
        </TabsContent>

        <TabsContent value="manifest">
          <JsonViewer data={rev.manifest} label="Manifest" maxHeight="40rem" />
        </TabsContent>
      </Tabs>

      {rollingBack && (
        <RollbackDialog
          target={revision}
          head={headRev}
          onClose={() => setRollingBack(false)}
          onHeadMoved={() => {
            setRollingBack(false)
            void queryClient.invalidateQueries({ queryKey: ["deployments"] }).then(() => setRollingBack(true))
          }}
        />
      )}
    </div>
  )
}
