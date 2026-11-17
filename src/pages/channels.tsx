import { useMemo } from "react"
import { Link, useNavigate } from "react-router"
import { useTable, createColumnHelper } from "@tanstack/react-table"
import { useChannels } from "@/hooks/use-channels"
import { useNodeHealth } from "@/hooks/use-registry"
import { DEFAULT_TRAFFIC_WINDOW, useChannelTraffic, type TrafficWindow } from "@/hooks/use-metrics"
import { listTableFeatures } from "@/lib/table"
import { useListState } from "@/lib/use-list-state"
import { hasTag, matchesText, sortRows } from "@/lib/deployed-list"
import { memberRefKey } from "@/lib/deployment-diff"
import type { Channel } from "@/api/types"
import { CHANNEL_TYPES } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/ui/select"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { PAGE_SIZE } from "@/lib/use-pagination"
import { NoMatches } from "@/components/shared/empty-state"
import { EntityTable } from "@/components/shared/entity-table"
import { ErrorState } from "@/components/shared/error-state"
import { NothingDeployedState, QuarantineBadge } from "@/components/shared/deployed-state"
import { FilterBar, FilterTextInput, FILTER_W, UnknownOption } from "@/components/shared/filter-bar"
import { RolloutBar } from "@/components/deployments/rollout-bar"
import { cronTransport } from "@/lib/cron"
import { healthOf } from "@/lib/traffic-encoding"
import { TrafficCell } from "@/components/admin/traffic-cell"
import { CalendarClock, Radio } from "lucide-react"

const columnHelper = createColumnHelper<typeof listTableFeatures, Channel>()

/** Filters in the URL so a filtered list is a link; sort and page ride along. */
const FILTER_KEYS = ["protocol", "type", "tag", "q"] as const

/** What the type dropdown accepts; the protocol is open (an edition's driver may add one). */
const FILTER_VALUES = { type: CHANNEL_TYPES }

/** Column id → the sort key the URL carries. */
const SORT_FIELDS: Record<string, string> = {
  name: "name",
  channel_type: "channel_type",
  protocol: "protocol",
  revision: "revision",
}

const TAGS_SHOWN = 3

function sortValue(c: Channel, field: string) {
  if (field === "revision") return c.revision
  if (field === "name" || field === "channel_type" || field === "protocol") return c[field]
  return null
}

/**
 * Columns take the quarantine set: this node refused these members, and a
 * list that shows them as plainly serving is wrong about the one thing an
 * operator scanning it wants to know.
 */
function buildColumns(quarantined: ReadonlyMap<string, string>, traffic: TrafficWindow) {
  return columnHelper.columns([
    columnHelper.accessor("name", {
      header: "Name",
      cell: (info) => {
        const c = info.row.original
        return (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{c.name}</span>
            {c.channel_id !== c.name && <span className="font-mono text-xs text-muted-foreground">{c.channel_id}</span>}
            <QuarantineBadge reason={quarantined.get(memberRefKey(c.member.entity))} />
          </span>
        )
      },
    }),
    columnHelper.display({
      id: "traffic",
      header: "Traffic",
      // Rate · error share · p95 over the dashboard's default window, from
      // the shared `/metrics` poll. A channel reached only by channel_call has
      // no series of its own and reads idle — see `deriveLoad`.
      cell: (info) => {
        const t = traffic.byChannel.get(info.row.original.name)
        return (
          <TrafficCell
            state={traffic.state}
            level={healthOf(t)}
            ratePerMin={t?.ratePerMin}
            errorPct={t?.errorPct}
            p95Ms={t?.p95Ms}
            windowed={t?.windowed}
            spanLabel={traffic.spanLabel}
          />
        )
      },
    }),
    columnHelper.accessor("channel_type", {
      header: "Type",
      cell: (info) => <Badge variant="outline">{info.getValue()}</Badge>,
    }),
    columnHelper.accessor("protocol", {
      header: "Protocol",
      cell: (info) => (
        <Badge variant="outline" className="uppercase">
          {info.getValue()}
        </Badge>
      ),
    }),
    columnHelper.accessor("route_pattern", {
      header: "Route",
      // A cron channel has no route: the thing that starts it is its schedule.
      cell: (info) => {
        const schedule = cronTransport(info.row.original)
        if (schedule) {
          return (
            <span
              className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground"
              title={`Schedule · ${schedule.timezone ?? "UTC"}`}
            >
              <CalendarClock className="h-3 w-3" />
              {schedule.schedule}
            </span>
          )
        }
        return <span className="font-mono text-xs text-muted-foreground">{info.getValue() ?? "—"}</span>
      },
    }),
    columnHelper.accessor("workflow_id", {
      header: "Workflow",
      cell: (info) => {
        const c = info.row.original
        const id = info.getValue()
        if (!id) return <span className="text-muted-foreground">—</span>
        return (
          <div className="space-y-1">
            <Link
              to={`/workflows/${encodeURIComponent(id)}`}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-xs text-primary underline-offset-2 hover:underline"
            >
              {id}
            </Link>
            {c.rollouts && c.rollouts.length > 1 && (
              <RolloutBar rollouts={c.rollouts} workflow={id} compact />
            )}
          </div>
        )
      },
    }),
    columnHelper.accessor("tags", {
      header: "Tags",
      cell: (info) => {
        const tags = info.getValue()
        if (!tags || tags.length === 0) return <span className="text-muted-foreground">—</span>
        return (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, TAGS_SHOWN).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {tags.length > TAGS_SHOWN && (
              <Badge variant="outline" className="text-xs">
                +{tags.length - TAGS_SHOWN}
              </Badge>
            )}
          </div>
        )
      },
    }),
    columnHelper.accessor("revision", {
      header: "Revision",
      cell: (info) => <span className="font-mono text-xs text-muted-foreground">r{info.getValue()}</span>,
    }),
  ])
}

export function ChannelsPage() {
  const navigate = useNavigate()
  const { filters, update, clear, hasFilters, sort, sortBy, sortOrder, offset, prev, next } = useListState(
    FILTER_KEYS,
    SORT_FIELDS,
    { values: FILTER_VALUES },
  )
  const search = filters.q.trim().toLowerCase()
  const { data: channels, isLoading, error, empty, refetch } = useChannels()
  const { quarantined } = useNodeHealth()
  const traffic = useChannelTraffic(DEFAULT_TRAFFIC_WINDOW)
  const columns = useMemo(() => buildColumns(quarantined, traffic), [quarantined, traffic])

  const protocols = useMemo(() => [...new Set(channels.map((c) => c.protocol))].sort(), [channels])
  const filtered = useMemo(() => {
    const rows = channels.filter(
      (c) =>
        matchesText(search, c.name, c.channel_id, c.route_pattern) &&
        (!filters.protocol || c.protocol === filters.protocol) &&
        (!filters.type || c.channel_type === filters.type) &&
        hasTag(c.tags, filters.tag),
    )
    return sortRows(rows, sortBy, sortOrder, sortValue)
  }, [channels, search, filters.protocol, filters.type, filters.tag, sortBy, sortOrder])
  const rows = filtered.slice(offset, offset + PAGE_SIZE)

  const table = useTable({ features: listTableFeatures, data: rows, columns })

  if (error && channels.length === 0) {
    return <ErrorState title="Failed to read the deployed channels" error={error} onRetry={refetch} />
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Channels" description="The service endpoints the head deploys, and what each one serves" />

      <FilterBar>
        <FilterTextInput
          value={filters.q}
          onChange={(q) => update({ q })}
          placeholder="Name, id or route contains…"
          ariaLabel="Search channels"
          className="w-full sm:w-56"
        />
        <Select
          value={filters.protocol}
          onChange={(e) => update({ protocol: e.target.value })}
          className={FILTER_W}
          aria-label="Filter by protocol"
        >
          <option value="">All protocols</option>
          {protocols.map((p) => (
            <option key={p} value={p}>
              {p.toUpperCase()}
            </option>
          ))}
          <UnknownOption value={filters.protocol} options={protocols} />
        </Select>
        <Select
          value={filters.type}
          onChange={(e) => update({ type: e.target.value })}
          className={FILTER_W}
          aria-label="Filter by channel type"
        >
          <option value="">Sync and async</option>
          <option value="sync">Sync</option>
          <option value="async">Async</option>
        </Select>
        <FilterTextInput
          value={filters.tag}
          onChange={(tag) => update({ tag })}
          placeholder="Exact tag..."
          ariaLabel="Filter by tag"
          title="Matches one whole tag, not part of one"
        />
      </FilterBar>

      <EntityTable
        table={table}
        isLoading={isLoading && channels.length === 0}
        sort={sort}
        onOpen={(channel) => navigate(`/channels/${encodeURIComponent(channel.channel_id)}`)}
        empty={
          hasFilters ? (
            <NoMatches noun="channels" onClear={clear} />
          ) : (
            <NothingDeployedState
              icon={Radio}
              noun="channels"
              headEmpty={empty}
              what="Channels are the service endpoints that receive requests, or a schedule, and run a workflow."
            />
          )
        }
      />

      <PaginationFooter offset={offset} count={rows.length} total={filtered.length} onPrev={prev} onNext={next} />
    </div>
  )
}
