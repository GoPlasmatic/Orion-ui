import { useMemo } from "react"
import { Link, useParams } from "react-router"
import { useConnection, useLastProbe, useProbeConnection, useProviderResolver } from "@/hooks/use-connections"
import { useEntityHistory, useQuarantineReason, useRegistry } from "@/hooks/use-registry"
import { useCircuitBreakers, useResetCircuitBreaker } from "@/hooks/use-circuit-breakers"
import { READ_ONLY_REASON, useCanMutate } from "@/hooks/use-admin-auth"
import { useUrlFilters } from "@/lib/use-url-filters"
import { breakerRows } from "@/lib/breakers"
import { breakerStateBadgeClass } from "@/lib/status"
import { dependents, shortDigest } from "@/lib/deployment-diff"
import { locatorScheme } from "@/lib/connections"
import { describeError } from "@/lib/toast-error"
import type { ConnectionRevision } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DetailHeader, DetailSkeleton } from "@/components/shared/detail-header"
import { ErrorState } from "@/components/shared/error-state"
import { Fact } from "@/components/shared/fact"
import { JsonViewer } from "@/components/shared/json-viewer"
import { JsonDiff } from "@/components/shared/json-diff"
import { QuarantineBadge } from "@/components/shared/deployed-state"
import { ProbeBadge, ProbeResult } from "@/components/connections/probe-result"
import { cn } from "@/lib/utils"
import { RotateCcw, Stethoscope } from "lucide-react"

const URL_KEYS = ["revision", "compare"] as const

/** What a revision *is*, for a diff: everything but its identity and its digest. */
const content = (r: ConnectionRevision) => ({
  provider_digest: r.provider_digest,
  public_config: r.public_config,
  secret_locators: r.secret_locators,
  bindings: r.bindings,
})

/**
 * One connection: its revisions (immutable — a change is a new one), the one
 * the head deploys, what each is configured with and where its secrets are
 * read from (never the values), a live probe from this node, the members
 * requiring it, the deployments that carried each revision, and its circuit
 * breakers on this node.
 */
export function ConnectionDetailPage() {
  const { id = "" } = useParams<{ id: string }>()
  const { values, set } = useUrlFilters(URL_KEYS)
  const { revisions, isLoading, error, refetch } = useConnection(id)
  const registry = useRegistry()
  const provider = useProviderResolver()
  const member = registry.connections.find((m) => m.entity.id === id)
  const deployedRevision = member?.entity.revision
  const quarantine = useQuarantineReason(member?.entity)
  const usedBy = useMemo(() => dependents(registry.members, { kind: "connection", id }), [registry.members, id])
  const history = useEntityHistory({ kind: "connection", id })
  const { data: breakerStatus } = useCircuitBreakers({ refetchInterval: 15_000 })
  const breakers = useMemo(() => breakerRows(breakerStatus).filter((b) => b.connector === id), [breakerStatus, id])
  const reset = useResetCircuitBreaker()
  const canMutate = useCanMutate()
  const probe = useProbeConnection()

  const picked = Number(values.revision)
  const selected =
    revisions.find((r) => r.revision === picked) ??
    revisions.find((r) => r.revision === deployedRevision) ??
    revisions[0]
  const lastProbe = useLastProbe(id, selected?.revision)
  const compareTo = revisions.find((r) => r.revision === Number(values.compare))

  if (isLoading) return <DetailSkeleton />
  if (error) {
    return (
      <ErrorState
        title={`Failed to load connection ${id}`}
        error={error}
        onRetry={() => refetch()}
        backTo={{ to: "/connections", label: "Back to Connections" }}
      />
    )
  }
  if (!selected) {
    return (
      <ErrorState
        title={`No connection "${id}" is stored`}
        backTo={{ to: "/connections", label: "Back to Connections" }}
      />
    )
  }

  const p = provider(selected.provider_digest)
  const locators = Object.entries(selected.secret_locators ?? {})
  const bindings = Object.entries(selected.bindings ?? {})
  const probeBlocked = !canMutate ? READ_ONLY_REASON : undefined
  const runProbe = (revision: number) => probe.mutate({ id, revision })

  return (
    <div className="space-y-6">
      <DetailHeader
        breadcrumbs={[{ label: "Connections", to: "/connections" }, { label: id }]}
        title={id}
        titleClassName="font-mono"
        badges={
          <>
            {deployedRevision != null ? (
              <Badge variant="outline">deployed r{deployedRevision}</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                not deployed
              </Badge>
            )}
            <QuarantineBadge reason={quarantine} />
          </>
        }
        meta={
          <p className="text-sm text-muted-foreground">
            {revisions.length} revision{revisions.length === 1 ? "" : "s"} · provider{" "}
            {p.source === "package" ? (
              <Link to={`/provider-packages/${encodeURIComponent(p.digest)}`} className="font-mono underline underline-offset-2">
                {p.label}
              </Link>
            ) : (
              <span className="font-mono">{p.label}</span>
            )}
          </p>
        }
        actions={
          <Button
            variant="outline"
            onClick={() => runProbe(selected.revision)}
            disabled={probe.isPending || !!probeBlocked}
            title={probeBlocked ?? `Probe revision ${selected.revision} from this node, with its real credentials`}
          >
            <Stethoscope className="h-4 w-4" /> {probe.isPending ? "Probing…" : `Probe r${selected.revision}`}
          </Button>
        }
      />

      {quarantine && <Callout variant="destructive">Quarantined on this node: {quarantine}</Callout>}
      {probe.error && <Callout variant="destructive">{describeError(probe.error)}</Callout>}
      {lastProbe.data && <ProbeResult probe={lastProbe.data} />}
      {!canMutate && (
        <p className="text-xs text-muted-foreground">
          A probe reaches the real backend with the real credentials, so the server refuses it to a read-only key.
        </p>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Revisions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Revision</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Configuration</TableHead>
                <TableHead>Deployed in</TableHead>
                <TableHead>Probe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {revisions.map((r) => {
                const deployments = history.entries.filter((e) => e.revision === r.revision).flatMap((e) => e.deployments)
                return (
                  <TableRow
                    key={r.revision}
                    className={cn(r.revision === selected.revision && "bg-accent/60")}
                    onActivate={() => set({ revision: String(r.revision) })}
                    aria-current={r.revision === selected.revision || undefined}
                  >
                    <TableCell className="font-mono text-xs">
                      r{r.revision}
                      {r.revision === deployedRevision && (
                        <Badge variant="outline" className="ml-2">
                          deployed
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{provider(r.provider_digest).label}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground" title={r.configuration_digest}>
                      {shortDigest(r.configuration_digest)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {deployments.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        deployments.slice(0, 6).map((d, i) => (
                          <span key={d}>
                            {i > 0 && ", "}
                            <Link to={`/deployments/${d}`} className="underline underline-offset-2">
                              {d}
                            </Link>
                          </span>
                        ))
                      )}
                    </TableCell>
                    <TableCell>
                      <RevisionProbe id={id} revision={r.revision} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Revision {selected.revision}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Fact label="Provider" title={selected.provider_digest}>
                {p.label}
              </Fact>
              <Fact label="Configuration digest" title={selected.configuration_digest}>
                {shortDigest(selected.configuration_digest)}
              </Fact>
            </dl>
            <JsonViewer data={selected.public_config} label="Settings" maxHeight="20rem" />
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Secrets</p>
              {locators.length === 0 ? (
                <p className="text-xs text-muted-foreground">None: this revision reads no secret.</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {locators.map(([path, locator]) => (
                    <li key={path} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{path}</span>
                      <span className="text-muted-foreground">←</span>
                      <Badge variant="outline" className="text-[10px]">
                        {locatorScheme(locator)}
                      </Badge>
                      <span className="font-mono text-muted-foreground">{locator}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Where each credential is read from on the node. The values are never returned.
              </p>
            </div>
            {bindings.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Bindings</p>
                <ul className="space-y-1 text-xs">
                  {bindings.map(([alias, target]) => (
                    <li key={alias}>
                      <span className="font-mono">{alias}</span> →{" "}
                      <Link to={`/connections/${encodeURIComponent(target)}`} className="font-mono underline underline-offset-2">
                        {target}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Required by ({usedBy.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {usedBy.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {deployedRevision != null
                    ? "Deployed, but no member of the head requires it."
                    : "Nothing: the head does not deploy it."}
                </p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {usedBy.map((m) => (
                    <li key={`${m.entity.kind}:${m.entity.id}@${m.entity.revision}`}>
                      <Link to={`/${m.entity.kind}s/${encodeURIComponent(m.entity.id)}`} className="font-medium underline underline-offset-2">
                        {m.entity.id}
                      </Link>{" "}
                      <span className="text-xs text-muted-foreground">
                        {m.entity.kind} r{m.entity.revision}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Circuit breakers on this node</CardTitle>
            </CardHeader>
            <CardContent>
              {breakers.length === 0 ? (
                <p className="text-sm text-muted-foreground">None has tripped or been tracked for this connection.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {breakers.map((b) => (
                    <li key={b.key} className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/circuit-breakers?key=${encodeURIComponent(b.key)}`}
                        className="font-mono text-xs underline underline-offset-2"
                      >
                        {b.channel || "—"}
                      </Link>
                      <Badge variant="outline" className={breakerStateBadgeClass(b.state)}>
                        {b.state}
                      </Badge>
                      {b.state !== "closed" && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={reset.isPending || !canMutate}
                          title={canMutate ? "Close the breaker on every node" : READ_ONLY_REASON}
                          onClick={() => reset.mutate(b.key)}
                        >
                          <RotateCcw /> Reset
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {revisions.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Compare</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Revision {selected.revision} against</span>
              <Select
                value={compareTo ? String(compareTo.revision) : ""}
                onChange={(e) => set({ compare: e.target.value })}
                className="w-40"
                aria-label="Compare with revision"
              >
                <option value="">choose a revision</option>
                {revisions
                  .filter((r) => r.revision !== selected.revision)
                  .map((r) => (
                    <option key={r.revision} value={r.revision}>
                      r{r.revision}
                      {r.revision === deployedRevision ? " (deployed)" : ""}
                    </option>
                  ))}
              </Select>
            </div>
            {compareTo && compareTo.revision !== selected.revision && (
              <JsonDiff before={content(compareTo)} after={content(selected)} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** One revision's last probe this session, in its table row. */
function RevisionProbe({ id, revision }: { id: string; revision: number }) {
  const { data } = useLastProbe(id, revision)
  return <ProbeBadge probe={data} />
}
