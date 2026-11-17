import { useMemo } from "react"
import { useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { useTable, createColumnHelper } from "@tanstack/react-table"
import { probeKey, useConnections, useProviderResolver } from "@/hooks/use-connections"
import { useNodeHealth, useRegistry } from "@/hooks/use-registry"
import { listTableFeatures } from "@/lib/table"
import { useListState } from "@/lib/use-list-state"
import { matchesText, sortRows } from "@/lib/deployed-list"
import { dependents, memberRefKey } from "@/lib/deployment-diff"
import type { ConnectionGroup, ProviderInfo } from "@/lib/connections"
import type { ConnectionProbe, ManifestMember } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import { Select } from "@/components/ui/select"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { PAGE_SIZE } from "@/lib/use-pagination"
import { EmptyState, NoMatches } from "@/components/shared/empty-state"
import { EntityTable } from "@/components/shared/entity-table"
import { ErrorState } from "@/components/shared/error-state"
import { QuarantineBadge } from "@/components/shared/deployed-state"
import { FilterBar, FilterTextInput, FILTER_W, UnknownOption } from "@/components/shared/filter-bar"
import { ProbeBadge } from "@/components/connections/probe-result"
import { plural } from "@/lib/utils"
import { Plug } from "lucide-react"

interface Row {
  group: ConnectionGroup
  provider: ProviderInfo
  usedBy: ManifestMember[]
  probe: ConnectionProbe | null | undefined
}

const columnHelper = createColumnHelper<typeof listTableFeatures, Row>()

const FILTER_KEYS = ["q", "deployed", "family"] as const
const FILTER_VALUES = { deployed: ["yes", "no"] }
const SORT_FIELDS: Record<string, string> = { id: "id", revisions: "revisions", used_by: "used_by" }

function sortValue(r: Row, field: string) {
  if (field === "id") return r.group.connection_id
  if (field === "revisions") return r.group.revisions.length
  if (field === "used_by") return r.usedBy.length
  return null
}

function buildColumns(quarantined: ReadonlyMap<string, string>) {
  return columnHelper.columns([
    columnHelper.accessor((r) => r.group.connection_id, {
      id: "id",
      header: "Connection",
      cell: (info) => {
        const g = info.row.original.group
        const reason = g.deployed
          ? quarantined.get(memberRefKey({ kind: "connection", id: g.connection_id, revision: g.deployed.revision }))
          : undefined
        return (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-medium">{g.connection_id}</span>
            <QuarantineBadge reason={reason} />
          </span>
        )
      },
    }),
    columnHelper.display({
      id: "provider",
      header: "Provider",
      cell: (info) => {
        const p = info.row.original.provider
        return (
          <span className="inline-flex flex-wrap items-center gap-1.5" title={p.digest}>
            <span className="font-mono text-xs">{p.label}</span>
            {p.source === "package" && (
              <Badge variant="outline" className="text-[10px]">
                package
              </Badge>
            )}
            {p.revoked && (
              <Badge variant="outline" className="border-destructive/40 text-[10px] text-destructive">
                revoked
              </Badge>
            )}
          </span>
        )
      },
    }),
    columnHelper.display({
      id: "deployed",
      header: "Deployed",
      cell: (info) => {
        const g = info.row.original.group
        if (g.deployedMissing) return <span className="font-mono text-xs">r{g.deployedMissing}</span>
        if (!g.deployed) return <span className="text-xs text-muted-foreground">not deployed</span>
        return (
          <span className="font-mono text-xs">
            r{g.deployed.revision}
            {g.latest.revision > g.deployed.revision && (
              <span className="ml-1.5 font-sans text-muted-foreground" title="A newer revision is stored but not deployed">
                · r{g.latest.revision} stored
              </span>
            )}
          </span>
        )
      },
    }),
    columnHelper.accessor((r) => r.group.revisions.length, {
      id: "revisions",
      header: "Revisions",
      cell: (info) => <span className="text-muted-foreground">{info.getValue()}</span>,
    }),
    columnHelper.accessor((r) => r.usedBy.length, {
      id: "used_by",
      header: "Required by",
      cell: (info) => {
        const used = info.row.original.usedBy
        if (used.length === 0) return <span className="text-xs text-muted-foreground">nothing</span>
        return (
          <span className="text-xs text-muted-foreground" title={used.map((m) => `${m.entity.kind} ${m.entity.id}`).join(", ")}>
            {used.length === 1 ? `${used[0].entity.kind} ${used[0].entity.id}` : plural(used.length, "member")}
          </span>
        )
      },
    }),
    columnHelper.display({
      id: "probe",
      header: "Last probe",
      cell: (info) => <ProbeBadge probe={info.row.original.probe} />,
    }),
  ])
}

/**
 * Connections: what workflows and channels call out to. One row per
 * connection over every stored revision — the list endpoint returns them all,
 * so they are grouped here — with the revision the head deploys and the
 * provider its digest resolves to. Probes are not stored by the server; the
 * column shows this session's last one.
 */
export function ConnectionsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { filters, update, clear, hasFilters, sort, sortBy, sortOrder, offset, prev, next } = useListState(
    FILTER_KEYS,
    SORT_FIELDS,
    { values: FILTER_VALUES },
  )
  const connections = useConnections()
  const registry = useRegistry()
  const provider = useProviderResolver()
  const { quarantined } = useNodeHealth()
  const columns = useMemo(() => buildColumns(quarantined), [quarantined])

  const all: Row[] = useMemo(
    () =>
      connections.data.map((group) => ({
        group,
        provider: provider((group.deployed ?? group.latest).provider_digest),
        usedBy: dependents(registry.members, { kind: "connection", id: group.connection_id }),
        probe: queryClient.getQueryData<ConnectionProbe | null>(
          probeKey(group.connection_id, (group.deployed ?? group.latest).revision),
        ),
      })),
    [connections.data, provider, registry.members, queryClient],
  )
  const families = useMemo(() => [...new Set(all.map((r) => r.provider.family))].sort(), [all])
  const search = filters.q.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      sortRows(
        all.filter(
          (r) =>
            matchesText(search, r.group.connection_id, r.provider.label) &&
            (!filters.deployed || (filters.deployed === "yes") === !!r.group.deployed) &&
            (!filters.family || r.provider.family === filters.family),
        ),
        sortBy,
        sortOrder,
        sortValue,
      ),
    [all, search, filters.deployed, filters.family, sortBy, sortOrder],
  )
  const rows = filtered.slice(offset, offset + PAGE_SIZE)
  const table = useTable({ features: listTableFeatures, data: rows, columns })

  if (connections.error && all.length === 0) {
    return <ErrorState title="Failed to load connections" error={connections.error} onRetry={() => connections.refetch()} />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connections"
        description="What workflows and channels call out to: every revision, the one deployed, and its provider"
      />

      {connections.truncated && (
        <Callout variant="warning">
          There are more connection revisions than this page reads at once; the oldest are not shown.
        </Callout>
      )}

      <FilterBar>
        <FilterTextInput
          value={filters.q}
          onChange={(q) => update({ q })}
          placeholder="Id or provider contains…"
          ariaLabel="Search connections"
          className="w-full sm:w-56"
        />
        <Select
          value={filters.deployed}
          onChange={(e) => update({ deployed: e.target.value })}
          className={FILTER_W}
          aria-label="Filter by deployment"
        >
          <option value="">Deployed or not</option>
          <option value="yes">Deployed</option>
          <option value="no">Not deployed</option>
        </Select>
        <Select
          value={filters.family}
          onChange={(e) => update({ family: e.target.value })}
          className={FILTER_W}
          aria-label="Filter by kind"
        >
          <option value="">Every kind</option>
          {families.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          <UnknownOption value={filters.family} options={families} />
        </Select>
      </FilterBar>

      <EntityTable
        table={table}
        isLoading={connections.isLoading}
        sort={sort}
        onOpen={(r) => navigate(`/connections/${encodeURIComponent(r.group.connection_id)}`)}
        empty={
          hasFilters ? (
            <NoMatches noun="connections" onClear={clear} />
          ) : (
            <EmptyState
              icon={Plug}
              title="No connections yet"
              description="A connection is a database, an HTTP API, a cache or any other backend a workflow calls, over a built-in driver or an admitted provider package. Revisions are created and deployed with orion-cli."
            />
          )
        }
      />

      <PaginationFooter offset={offset} count={rows.length} total={filtered.length} onPrev={prev} onNext={next} />
    </div>
  )
}
