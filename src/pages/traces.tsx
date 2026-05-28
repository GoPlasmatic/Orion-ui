import { useState } from "react"
import { useNavigate } from "react-router"
import { useTraces } from "@/hooks/use-traces"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table"
import type { Trace, TraceSortBy, SortOrder } from "@/api/types"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/shared/page-header"
import { formatDate, formatDuration } from "@/lib/utils"
import { ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"

const PAGE_SIZE = 20

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  running: "outline",
  pending: "secondary",
  failed: "destructive",
}

const statusColor: Record<string, string> = {
  completed: "bg-emerald-500",
  running: "",
  pending: "",
  failed: "",
}

const columnHelper = createColumnHelper<Trace>()

const columns = [
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => {
      const val = info.getValue()
      return (
        <Badge
          variant={statusVariant[val] ?? "outline"}
          className={statusColor[val] ?? ""}
        >
          {val}
        </Badge>
      )
    },
  }),
  columnHelper.accessor("channel", {
    header: "Channel",
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor("mode", {
    header: "Mode",
    cell: (info) => <Badge variant="outline">{info.getValue()}</Badge>,
  }),
  columnHelper.accessor("created_at", {
    header: "Created",
    cell: (info) => (
      <span className="text-muted-foreground">{formatDate(info.getValue())}</span>
    ),
  }),
  columnHelper.accessor("duration_ms", {
    id: "duration",
    header: "Duration",
    cell: (info) => (
      <span className="text-muted-foreground">{formatDuration(info.getValue())}</span>
    ),
  }),
]

const sortableColumns: Record<string, TraceSortBy> = {
  status: "status",
  channel: "channel",
  mode: "mode",
  created_at: "created_at",
}

export function TracesPage() {
  const navigate = useNavigate()
  const [offset, setOffset] = useState(0)
  const [sortBy, setSortBy] = useState<TraceSortBy>("created_at")
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc")
  const [statusFilter, setStatusFilter] = useState("")
  const [channelFilter, setChannelFilter] = useState("")
  const [modeFilter, setModeFilter] = useState("")

  const { data, isLoading } = useTraces({
    limit: PAGE_SIZE,
    offset,
    sort_by: sortBy,
    sort_order: sortOrder,
    status: statusFilter || undefined,
    channel: channelFilter || undefined,
    mode: modeFilter || undefined,
  })

  const table = useReactTable({
    data: data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const total = data?.total ?? 0
  const hasNext = offset + PAGE_SIZE < total
  const hasPrev = offset > 0

  function handleSort(columnId: string) {
    const field = sortableColumns[columnId]
    if (!field) return
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc")
    } else {
      setSortBy(field)
      setSortOrder("desc")
    }
    setOffset(0)
  }

  function SortIcon({ columnId }: { columnId: string }) {
    const field = sortableColumns[columnId]
    if (!field) return null
    if (sortBy !== field) return <ArrowUpDown className="ml-1 h-3 w-3 inline opacity-40" />
    return sortOrder === "asc"
      ? <ArrowUp className="ml-1 h-3 w-3 inline" />
      : <ArrowDown className="ml-1 h-3 w-3 inline" />
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Traces" description="Execution history and monitoring" />

      <div className="flex items-center gap-3">
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            setOffset(0)
          }}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </Select>
        <Input
          placeholder="Filter by channel..."
          value={channelFilter}
          onChange={(e) => {
            setChannelFilter(e.target.value)
            setOffset(0)
          }}
          className="w-48"
        />
        <Select
          value={modeFilter}
          onChange={(e) => {
            setModeFilter(e.target.value)
            setOffset(0)
          }}
        >
          <option value="">All modes</option>
          <option value="sync">Sync</option>
          <option value="async">Async</option>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isSortable = !!sortableColumns[header.column.id]
                  return (
                    <TableHead
                      key={header.id}
                      className={isSortable ? "cursor-pointer select-none" : ""}
                      onClick={isSortable ? () => handleSort(header.column.id) : undefined}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <SortIcon columnId={header.column.id} />
                    </TableHead>
                  )
                })}
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
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
                  No traces found
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/traces/${row.original.id}`)}
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
