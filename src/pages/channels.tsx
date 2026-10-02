import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import { useChannels, useImportChannels } from "@/hooks/use-channels"
import { useHealth } from "@/hooks/use-health"
import { DEFAULT_TRAFFIC_WINDOW, useChannelTraffic, type TrafficWindow } from "@/hooks/use-metrics"
import { useExport } from "@/hooks/use-export"
import { ImportDialog } from "@/components/shared/import-dialog"
import type { CreateChannelRequest } from "@/api/types"
import { useTable, createColumnHelper } from "@tanstack/react-table"
import { listTableFeatures } from "@/lib/table"
import { useListState } from "@/lib/use-list-state"
import type { Channel, EntityStatus, ChannelProtocol, ChannelType } from "@/api/types"
import { CHANNEL_PROTOCOLS, CHANNEL_TYPES, ENTITY_STATUSES } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { channelsApi } from "@/api/channels"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { PAGE_SIZE, REGISTRY_LIMIT } from "@/lib/use-pagination"
import { StatusBadge } from "@/components/shared/status-badge"
import { EmptyState, NoMatches } from "@/components/shared/empty-state"
import { EntityTable } from "@/components/shared/entity-table"
import { FilterBar, FilterTextInput, FILTER_W } from "@/components/shared/filter-bar"
import { formatDate, formatWhen, downloadJson, plural } from "@/lib/utils"
import { cronTransport } from "@/lib/cron"
import { healthOf } from "@/lib/traffic-encoding"
import { TrafficCell } from "@/components/admin/traffic-cell"
import { CalendarClock, Download, Plus, Radio, Upload } from "lucide-react"

const columnHelper = createColumnHelper<typeof listTableFeatures, Channel>()

/** Filters in the URL so a filtered list is a link; sort and page ride along. */
const FILTER_KEYS = ["status", "protocol", "type", "tag", "q"] as const

/**
 * The status the list shows when the URL names none. An operator opening
 * Channels wants what is serving; drafts and the archive were mixed in, and
 * on QA 148 rows read as one undifferentiated list. `?status=all` is the
 * explicit everything.
 */
const DEFAULT_CHANNEL_STATUS = "active"
const ALL = "all"

/** What each dropdown accepts; anything else in the URL reads as unset. */
const FILTER_VALUES = {
  status: [...ENTITY_STATUSES, ALL],
  protocol: CHANNEL_PROTOCOLS,
  type: CHANNEL_TYPES,
}

/** The `status` a list request sends for the URL's value: active when absent, none for `all`. */
function channelStatusQuery(urlValue: string): EntityStatus | undefined {
  if (!urlValue) return DEFAULT_CHANNEL_STATUS
  if (urlValue === ALL) return undefined
  return urlValue as EntityStatus
}

/** Column id → the server's `sort_by` field; the rest are not sortable. */
const SORT_FIELDS: Record<string, string> = {
  name: "name",
  channel_type: "channel_type",
  protocol: "protocol",
  status: "status",
  updated_at: "updated_at",
}

const TAGS_SHOWN = 3

/**
 * Columns take the quarantine set: the engine refused these channels at load,
 * and a list that paints them "active" is wrong about the one thing an
 * operator scanning it wants to know.
 */
function buildColumns(quarantined: ReadonlyMap<string, string>, traffic: TrafficWindow) {
  return columnHelper.columns([
    columnHelper.accessor("name", {
      header: "Name",
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
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
        <Badge variant="outline" className="uppercase">{info.getValue()}</Badge>
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
        return (
          <span className="font-mono text-xs text-muted-foreground">
            {info.getValue() ?? "—"}
          </span>
        )
      },
    }),
    columnHelper.accessor("workflow_id", {
      header: "Workflow",
      cell: (info) => {
        const id = info.getValue()
        if (!id) return <span className="text-muted-foreground">—</span>
        return (
          <Link
            to={`/workflows/${id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-xs text-primary underline-offset-2 hover:underline"
          >
            {id}
          </Link>
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
              <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
            ))}
            {tags.length > TAGS_SHOWN && (
              <Badge variant="outline" className="text-xs">+{tags.length - TAGS_SHOWN}</Badge>
            )}
          </div>
        )
      },
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => {
        const reason = quarantined.get(info.row.original.name)
        return (
          <span className="inline-flex flex-wrap items-center gap-1">
            <StatusBadge status={info.getValue()} />
            {reason !== undefined && (
              <Badge
                variant="destructive"
                className="text-xs"
                title={reason || "Refused at load — the route is not being served"}
              >
                quarantined
              </Badge>
            )}
          </span>
        )
      },
    }),
    columnHelper.accessor("version", {
      header: "Version",
      cell: (info) => <span className="text-muted-foreground">v{info.getValue()}</span>,
    }),
    columnHelper.accessor("updated_at", {
      header: "Updated",
      cell: (info) => (
        <span className="whitespace-nowrap text-muted-foreground" title={formatDate(info.getValue())}>
          {formatWhen(info.getValue())}
        </span>
      ),
    }),
  ])
}

/** Client-side sort for the search path, on the same fields the server sorts by. */
function compareChannels(a: Channel, b: Channel, field: string): number {
  switch (field) {
    case "name":
    case "channel_type":
    case "protocol":
    case "status":
      return String(a[field]).localeCompare(String(b[field]))
    case "updated_at":
      return a.updated_at.localeCompare(b.updated_at)
    default:
      return 0
  }
}

export function ChannelsPage() {
  const navigate = useNavigate()
  const { filters, update, clear, hasFilters, sortQuery, sort, sortBy, sortOrder, offset, prev, next } =
    useListState(FILTER_KEYS, SORT_FIELDS, { values: FILTER_VALUES })
  const status = channelStatusQuery(filters.status)
  const protocolFilter = filters.protocol as ChannelProtocol | ""
  const typeFilter = filters.type as ChannelType | ""
  const search = filters.q.trim().toLowerCase()
  const [showImport, setShowImport] = useState(false)
  const { data: health } = useHealth()
  const traffic = useChannelTraffic(DEFAULT_TRAFFIC_WINDOW)

  const quarantined = useMemo(
    () => new Map((health?.channels?.quarantined ?? []).map((q) => [q.channel, q.reason ?? ""])),
    [health?.channels?.quarantined],
  )
  const columns = useMemo(() => buildColumns(quarantined, traffic), [quarantined, traffic])

  const query = {
    status,
    protocol: protocolFilter || undefined,
    channel_type: typeFilter || undefined,
    tag: filters.tag || undefined,
  }

  // Export honours the server-side filters, and emits the shape /import accepts.
  const exportAll = useExport(async () => {
    const channels = await channelsApi.export(query)
    downloadJson(channels, "orion-channels")
    return `Exported ${plural(channels.length, "channel")}`
  })
  const importChannels = useImportChannels()

  // The server has no name filter (admin/channels takes status, type,
  // protocol, tag), so a name search runs here over the registry — the same
  // REGISTRY_LIMIT read the map and the dashboard share — with the other
  // filters, the sort and the page applied in the browser too.
  const serverPage = useChannels({ limit: PAGE_SIZE, offset, ...query, ...sortQuery }, !search)
  const registry = useChannels({ limit: REGISTRY_LIMIT }, !!search)
  const searched = useMemo(() => {
    if (!search) return null
    const tag = filters.tag.toLowerCase()
    const rows = (registry.data?.data ?? []).filter(
      (c) =>
        c.name.toLowerCase().includes(search) &&
        (!status || c.status === status) &&
        (!protocolFilter || c.protocol === protocolFilter) &&
        (!typeFilter || c.channel_type === typeFilter) &&
        (!tag || c.tags.some((t) => t.toLowerCase() === tag)),
    )
    if (sortBy) {
      const dir = sortOrder === "desc" ? -1 : 1
      rows.sort((a, b) => dir * compareChannels(a, b, sortBy))
    }
    return rows
  }, [search, registry.data, status, protocolFilter, typeFilter, filters.tag, sortBy, sortOrder])

  const rows = searched ? searched.slice(offset, offset + PAGE_SIZE) : (serverPage.data?.data ?? [])
  const total = searched ? searched.length : serverPage.data?.total
  const isLoading = search ? registry.isLoading : serverPage.isLoading

  // What the default hides, and whether the registry is empty at all: two
  // one-row reads for their totals, so "No channels yet" is never said over
  // a registry of drafts.
  const hidingByDefault = !filters.status
  const archived = useChannels({ limit: 1, status: "archived" }, hidingByDefault)
  const anyStatus = useChannels({ limit: 1 }, hidingByDefault && !hasFilters && rows.length === 0 && !isLoading)
  const archivedCount = archived.data?.total ?? 0
  const otherCount = anyStatus.data?.total ?? anyStatus.data?.data.length ?? 0

  const table = useTable({
    features: listTableFeatures,
    data: rows,
    columns,
  })

  return (
    <div className="space-y-6">
      <PageHeader title="Channels" description="Manage service endpoints and routing">
        <Button variant="outline" onClick={exportAll.run} disabled={exportAll.pending}>
          <Download className="h-4 w-4" />
          {exportAll.pending ? "Exporting..." : "Export"}
        </Button>
        <Button variant="outline" onClick={() => setShowImport(true)}>
          <Upload className="h-4 w-4" />
          Import
        </Button>
        <Button onClick={() => navigate("/channels/new")}>
          <Plus className="h-4 w-4" />
          Create Channel
        </Button>
      </PageHeader>

      {showImport && (
        <ImportDialog
          title="Import Channels"
          onImport={(items, opts) =>
            importChannels.mutateAsync({ items: items as CreateChannelRequest[], ...opts })
          }
          onClose={() => setShowImport(false)}
        />
      )}

      <FilterBar>
        <FilterTextInput
          value={filters.q}
          onChange={(q) => update({ q })}
          placeholder="Name contains… (in browser)"
          ariaLabel="Search channels by name"
          title="The server has no name filter: this searches the loaded registry in the browser"
          className="w-full sm:w-56"
        />
        <Select
          value={filters.status || DEFAULT_CHANNEL_STATUS}
          onChange={(e) =>
            update({ status: e.target.value === DEFAULT_CHANNEL_STATUS ? "" : e.target.value })
          }
          className={FILTER_W}
          aria-label="Filter by status"
        >
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
          <option value={ALL}>All statuses</option>
        </Select>
        <Select
          value={protocolFilter}
          onChange={(e) => update({ protocol: e.target.value })}
          className={FILTER_W}
          aria-label="Filter by protocol"
        >
          <option value="">All protocols</option>
          <option value="http">HTTP</option>
          <option value="rest">REST</option>
          <option value="kafka">Kafka</option>
          <option value="cron">Cron</option>
        </Select>
        <Select
          value={typeFilter}
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
        {hidingByDefault && archivedCount > 0 && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => update({ status: ALL })}
            title="The list shows active channels unless a status is chosen"
          >
            {archivedCount} archived hidden · show all
          </button>
        )}
      </FilterBar>

      <EntityTable
        table={table}
        isLoading={isLoading}
        sort={sort}
        onOpen={(channel) => navigate(`/channels/${channel.channel_id}`)}
        empty={
          hasFilters ? (
            <NoMatches noun="channels" onClear={clear} />
          ) : otherCount > 0 ? (
            <EmptyState
              icon={Radio}
              title="No active channels"
              description={`Nothing is serving: every channel in the registry is a draft or archived (${otherCount} in all).`}
              action={
                <Button variant="outline" onClick={() => update({ status: ALL })}>
                  Show every status
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Radio}
              title="No channels yet"
              description="Channels are the service endpoints that receive requests and run a workflow. Create your first one or import existing definitions."
              action={
                <>
                  <Button variant="outline" onClick={() => setShowImport(true)}>
                    <Upload className="h-4 w-4" /> Import
                  </Button>
                  <Button onClick={() => navigate("/channels/new")}>
                    <Plus className="h-4 w-4" /> Create Channel
                  </Button>
                </>
              }
            />
          )
        }
      />

      <PaginationFooter
        offset={offset}
        count={rows.length}
        total={total}
        onPrev={prev}
        onNext={next}
      />
    </div>
  )
}
