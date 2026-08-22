import { useState } from "react"
import { useNavigate } from "react-router"
import { useChannels, useImportChannels } from "@/hooks/use-channels"
import { ImportDialog } from "@/components/shared/import-dialog"
import type { CreateChannelRequest } from "@/api/types"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table"
import type { Channel, EntityStatus, ChannelProtocol } from "@/api/types"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { toast } from "sonner"
import { channelsApi } from "@/api/channels"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { usePagination, PAGE_SIZE } from "@/lib/use-pagination"
import { StatusBadge } from "@/components/shared/status-badge"
import { EmptyState } from "@/components/shared/empty-state"
import { FilterBar, FILTER_W } from "@/components/shared/filter-bar"
import { formatDate, downloadJson } from "@/lib/utils"
import { Download, Plus, Radio, Upload } from "lucide-react"

const columnHelper = createColumnHelper<Channel>()

const columns = [
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
    cell: (info) => (
      <span className="font-mono text-xs text-muted-foreground">
        {info.getValue() ?? "--"}
      </span>
    ),
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
  columnHelper.accessor("version", {
    header: "Version",
    cell: (info) => <span className="text-muted-foreground">v{info.getValue()}</span>,
  }),
  columnHelper.accessor("updated_at", {
    header: "Updated",
    cell: (info) => (
      <span className="text-muted-foreground">{formatDate(info.getValue())}</span>
    ),
  }),
]

export function ChannelsPage() {
  const navigate = useNavigate()
  const { offset, reset: resetPage, prev, next } = usePagination()
  const [statusFilter, setStatusFilter] = useState<EntityStatus | "">("")
  const [protocolFilter, setProtocolFilter] = useState<ChannelProtocol | "">("")
  const [showImport, setShowImport] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Export honours the active filters, and emits the shape /import accepts.
  const handleExport = async () => {
    setExporting(true)
    try {
      const channels = await channelsApi.export({
        status: statusFilter || undefined,
        protocol: protocolFilter || undefined,
      })
      downloadJson(channels, "orion-channels")
      toast.success(`Exported ${channels.length} channel${channels.length !== 1 ? "s" : ""}`)
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : undefined })
    } finally {
      setExporting(false)
    }
  }
  const importChannels = useImportChannels()

  const { data, isLoading } = useChannels({
    limit: PAGE_SIZE,
    offset,
    status: statusFilter || undefined,
    protocol: protocolFilter || undefined,
  })

  const table = useReactTable({
    data: data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })


  return (
    <div className="space-y-6">
      <PageHeader title="Channels" description="Manage service endpoints and routing">
        <Button variant="outline" onClick={handleExport} disabled={exporting}>
          <Download className="h-4 w-4" />
          {exporting ? "Exporting..." : "Export"}
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
          onChange={(e) => {
            setStatusFilter(e.target.value as EntityStatus | "")
            resetPage()
          }}
          className={FILTER_W}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </Select>
        <Select
          value={protocolFilter}
          onChange={(e) => {
            setProtocolFilter(e.target.value as ChannelProtocol | "")
            resetPage()
          }}
          className={FILTER_W}
        >
          <option value="">All protocols</option>
          <option value="http">HTTP</option>
          <option value="rest">REST</option>
          <option value="kafka">Kafka</option>
        </Select>
      </FilterBar>

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
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
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/channels/${row.original.channel_id}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
