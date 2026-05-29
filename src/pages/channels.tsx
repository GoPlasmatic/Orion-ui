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
import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { EmptyState } from "@/components/shared/empty-state"
import { formatDate } from "@/lib/utils"
import { ChevronLeft, ChevronRight, Plus, Radio, Upload } from "lucide-react"

const PAGE_SIZE = 20
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
  const [offset, setOffset] = useState(0)
  const [statusFilter, setStatusFilter] = useState<EntityStatus | "">("")
  const [protocolFilter, setProtocolFilter] = useState<ChannelProtocol | "">("")
  const [showImport, setShowImport] = useState(false)
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

  const total = data?.total ?? 0
  const hasNext = offset + PAGE_SIZE < total
  const hasPrev = offset > 0

  return (
    <div className="space-y-6">
      <PageHeader title="Channels" description="Manage service endpoints and routing">
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
          onImport={(items, dryRun) =>
            importChannels.mutateAsync({ items: items as CreateChannelRequest[], dryRun })
          }
          onClose={() => setShowImport(false)}
        />
      )}

      <div className="flex items-center gap-3">
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as EntityStatus | "")
            setOffset(0)
          }}
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
            setOffset(0)
          }}
        >
          <option value="">All protocols</option>
          <option value="http">HTTP</option>
          <option value="rest">REST</option>
          <option value="kafka">Kafka</option>
        </Select>
      </div>

      <div className="rounded-md border">
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

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total > 0 ? `${offset + 1}--${Math.min(offset + PAGE_SIZE, total)} of ${total}` : "No results"}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!hasPrev} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => setOffset(offset + PAGE_SIZE)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
