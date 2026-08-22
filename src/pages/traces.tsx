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
import { PaginationFooter } from "@/components/shared/pagination"
import { usePagination, PAGE_SIZE } from "@/lib/use-pagination"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { TraceAnalytics } from "@/components/traces/trace-analytics"
import { EmptyState } from "@/components/shared/empty-state"
import { FilterBar, FILTER_W } from "@/components/shared/filter-bar"
import { formatDate, formatDuration } from "@/lib/utils"
import { traceStatusBadgeClass } from "@/lib/status"
import { ArrowUpDown, ArrowUp, ArrowDown, Activity } from "lucide-react"


const columnHelper = createColumnHelper<Trace>()

const columns = [
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => {
      const val = info.getValue()
      return (
        <Badge variant="outline" className={traceStatusBadgeClass(val)}>
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
  const { offset, reset: resetPage, prev, next } = usePagination()
  const [sortBy, setSortBy] = useState<TraceSortBy>("created_at")
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc")
  const [statusFilter, setStatusFilter] = useState("")
  const [channelFilter, setChannelFilter] = useState("")
  const [modeFilter, setModeFilter] = useState("")

  // This page shows a count, so it opts into the total explicitly — every other
  // trace read (analytics, the operations dashboard) leaves it off and does not
  // pay for the scan.
  const { data, isLoading } = useTraces({
    limit: PAGE_SIZE,
    offset,
    include_total: true,
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

  function handleSort(columnId: string) {
    const field = sortableColumns[columnId]
    if (!field) return
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc")
    } else {
      setSortBy(field)
      setSortOrder("desc")
    }
    resetPage()
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

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-6">
      <FilterBar>
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            resetPage()
          }}
          className={FILTER_W}
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
            resetPage()
          }}
          className="w-48"
        />
        <Select
          value={modeFilter}
          onChange={(e) => {
            setModeFilter(e.target.value)
            resetPage()
          }}
          className={FILTER_W}
        >
          <option value="">All modes</option>
          <option value="sync">Sync</option>
          <option value="async">Async</option>
        </Select>
      </FilterBar>

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
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
                <TableCell colSpan={columns.length} className="p-0">
                  <EmptyState
                    icon={Activity}
                    title="No traces found"
                    description="Traces are captured as requests flow through channels. Adjust the filters above, or send a request from the Data Console to generate one."
                    action={
                      <Button variant="outline" onClick={() => navigate("/console")}>
                        Open Data Console
                      </Button>
                    }
                  />
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

      <PaginationFooter
        offset={offset}
        count={data?.data.length ?? 0}
        total={data?.total}
        onPrev={prev}
        onNext={next}
      />
        </TabsContent>

        <TabsContent value="analytics">
          <TraceAnalytics />
        </TabsContent>
      </Tabs>
    </div>
  )
}
