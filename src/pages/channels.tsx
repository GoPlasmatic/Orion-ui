import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import { useChannels, useImportChannels } from "@/hooks/use-channels"
import { useHealth } from "@/hooks/use-health"
import { useExport } from "@/hooks/use-export"
import { ImportDialog } from "@/components/shared/import-dialog"
import type { CreateChannelRequest } from "@/api/types"
import { useTable, createColumnHelper } from "@tanstack/react-table"
import { listTableFeatures } from "@/lib/table"
import { useListState } from "@/lib/use-list-state"
import type { Channel, EntityStatus, ChannelProtocol, ChannelType } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { channelsApi } from "@/api/channels"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { PAGE_SIZE } from "@/lib/use-pagination"
import { StatusBadge } from "@/components/shared/status-badge"
import { EmptyState } from "@/components/shared/empty-state"
import { EntityTable } from "@/components/shared/entity-table"
import { FilterBar, FILTER_W } from "@/components/shared/filter-bar"
import { formatDate, formatWhen, downloadJson } from "@/lib/utils"
import { cronTransport } from "@/lib/cron"
import { CalendarClock, Download, Plus, Radio, Upload } from "lucide-react"

const columnHelper = createColumnHelper<typeof listTableFeatures, Channel>()

/** Filters in the URL so a filtered list is a link; sort and page ride along. */
const FILTER_KEYS = ["status", "protocol", "type", "tag"] as const

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
function buildColumns(quarantined: ReadonlyMap<string, string>) {
  return columnHelper.columns([
    columnHelper.accessor("name", {
      header: "Name",
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
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
        <span className="text-muted-foreground" title={formatDate(info.getValue())}>
          {formatWhen(info.getValue())}
        </span>
      ),
    }),
  ])
}

export function ChannelsPage() {
  const navigate = useNavigate()
  const { filters, update, sortQuery, sort, offset, prev, next } = useListState(FILTER_KEYS, SORT_FIELDS)
  const statusFilter = filters.status as EntityStatus | ""
  const protocolFilter = filters.protocol as ChannelProtocol | ""
  const typeFilter = filters.type as ChannelType | ""
  const [showImport, setShowImport] = useState(false)
  const { data: health } = useHealth()

  const quarantined = useMemo(
    () => new Map((health?.channels?.quarantined ?? []).map((q) => [q.channel, q.reason ?? ""])),
    [health?.channels?.quarantined],
  )
  const columns = useMemo(() => buildColumns(quarantined), [quarantined])

  const query = {
    status: statusFilter || undefined,
    protocol: protocolFilter || undefined,
    channel_type: typeFilter || undefined,
    tag: filters.tag || undefined,
  }

  // Export honours the active filters, and emits the shape /import accepts.
  const exportAll = useExport(async () => {
    const channels = await channelsApi.export(query)
    downloadJson(channels, "orion-channels")
    return `Exported ${channels.length} channel${channels.length !== 1 ? "s" : ""}`
  })
  const importChannels = useImportChannels()

  const { data, isLoading } = useChannels({ limit: PAGE_SIZE, offset, ...query, ...sortQuery })

  const table = useTable({
    features: listTableFeatures,
    data: data?.data ?? [],
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
        <Select
          value={statusFilter}
          onChange={(e) => update({ status: e.target.value })}
          className={FILTER_W}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
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
        <Input
          value={filters.tag}
          onChange={(e) => update({ tag: e.target.value })}
          placeholder="Filter by tag..."
          className={FILTER_W}
          aria-label="Filter by tag"
        />
      </FilterBar>

      <EntityTable
        table={table}
        isLoading={isLoading}
        sort={sort}
        onOpen={(channel) => navigate(`/channels/${channel.channel_id}`)}
        empty={
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
        }
      />

      <PaginationFooter
        offset={offset}
        count={data?.data.length ?? 0}
        total={data?.total}
        onPrev={prev}
        onNext={next}
      />
    </div>
  )
}
