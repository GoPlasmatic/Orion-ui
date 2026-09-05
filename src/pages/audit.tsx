import { useState } from "react"
import { useAuditLogs } from "@/hooks/use-audit"
import { useTable, flexRender, createColumnHelper } from "@tanstack/react-table"
import { listTableFeatures } from "@/lib/table"
import type { AuditLog } from "@/api/types"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { FilterBar, FILTER_W } from "@/components/shared/filter-bar"
import { usePagination, PAGE_SIZE } from "@/lib/use-pagination"
import { formatDate } from "@/lib/utils"

const columnHelper = createColumnHelper<typeof listTableFeatures, AuditLog>()

const columns = columnHelper.columns([
  columnHelper.accessor("created_at", {
    header: "Time",
    cell: (info) => (
      <span className="text-sm">{formatDate(info.getValue())}</span>
    ),
  }),
  columnHelper.accessor("action", {
    header: "Action",
    cell: (info) => (
      <Badge variant="outline">{info.getValue()}</Badge>
    ),
  }),
  columnHelper.accessor("resource_type", {
    header: "Resource Type",
    cell: (info) => (
      <Badge variant="secondary" className="text-xs">{info.getValue()}</Badge>
    ),
  }),
  columnHelper.accessor("resource_id", {
    header: "Resource ID",
    cell: (info) => (
      <span className="font-mono text-xs">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor("principal", {
    header: "User",
    cell: (info) => (
      <span className="text-muted-foreground">{info.getValue() ?? "--"}</span>
    ),
  }),
])

/** `datetime-local` gives "YYYY-MM-DDTHH:mm"; the server wants RFC 3339. */
const toRfc3339 = (local: string) => (local ? new Date(local).toISOString() : undefined)

export function AuditPage() {
  const { offset, reset: resetPage, prev, next } = usePagination()
  const [actionFilter, setActionFilter] = useState("")
  const [resourceTypeFilter, setResourceTypeFilter] = useState("")
  const [principalFilter, setPrincipalFilter] = useState("")
  const [resourceIdFilter, setResourceIdFilter] = useState("")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")

  // Filtering is server-side since 1.0. It used to fetch the most recent 1000
  // entries and filter locally, which quietly hid anything older.
  const { data, isLoading } = useAuditLogs({
    limit: PAGE_SIZE,
    offset,
    action: actionFilter || undefined,
    resource_type: resourceTypeFilter || undefined,
    resource_id: resourceIdFilter || undefined,
    principal: principalFilter || undefined,
    start_time: toRfc3339(startTime),
    end_time: toRfc3339(endTime),
  })

  const table = useTable({
    features: listTableFeatures,
    data: data?.data ?? [],
    columns,
  })

  // Any control change re-anchors paging to the first page.
  const onFilter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    resetPage()
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Audit Log" description="Track administrative actions" />

      <FilterBar>
        <Select
          value={actionFilter}
          onChange={(e) => onFilter(setActionFilter)(e.target.value)}
          aria-label="Filter by action"
          className={FILTER_W}
        >
          {/* The server's own vocabulary (docs/operate/audit-logs.md). A status
              change is named for the status requested — there is no
              `status_draft`, because a transition *to* draft is refused
              before anything is written. */}
          <option value="">All actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="create_version">Create version</option>
          <option value="status_active">Activate</option>
          <option value="status_archived">Archive</option>
          <option value="update_rollout">Update rollout</option>
          <option value="import">Import</option>
          <option value="test">Test</option>
          <option value="trigger">Trigger (cron)</option>
          <option value="retry">Retry (occurrence)</option>
          <option value="reload">Reload</option>
          <option value="reset">Reset breaker</option>
          <option value="requeue">Requeue (DLQ)</option>
          <option value="purge">Purge (DLQ)</option>
          <option value="package_staged">Package staged</option>
          <option value="package_applied">Package applied</option>
        </Select>
        <Select
          value={resourceTypeFilter}
          onChange={(e) => onFilter(setResourceTypeFilter)(e.target.value)}
          aria-label="Filter by resource type"
          className={FILTER_W}
        >
          <option value="">All resources</option>
          <option value="channel">Channel</option>
          <option value="workflow">Workflow</option>
          <option value="connector">Connector</option>
          <option value="plugin">Plugin</option>
          <option value="cron_occurrence">Cron occurrence</option>
          <option value="engine">Engine</option>
          <option value="circuit_breaker">Circuit breaker</option>
          <option value="trace_dlq">Trace DLQ</option>
          <option value="package">Package</option>
          <option value="backup">Backup</option>
        </Select>
        <Input
          value={resourceIdFilter}
          onChange={(e) => onFilter(setResourceIdFilter)(e.target.value)}
          placeholder="Resource ID"
          className="w-44"
          aria-label="Filter by resource ID"
        />
        <Input
          value={principalFilter}
          onChange={(e) => onFilter(setPrincipalFilter)(e.target.value)}
          placeholder="Principal"
          className="w-40"
          aria-label="Filter by principal"
        />
        <Input
          type="datetime-local"
          value={startTime}
          onChange={(e) => onFilter(setStartTime)(e.target.value)}
          className="w-52"
          aria-label="From"
        />
        <Input
          type="datetime-local"
          value={endTime}
          onChange={(e) => onFilter(setEndTime)(e.target.value)}
          className="w-52"
          aria-label="To"
        />
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
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
                  No audit logs found
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
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
