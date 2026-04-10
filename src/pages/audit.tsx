import { useState } from "react"
import { useAuditLogs } from "@/hooks/use-audit"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table"
import type { AuditLog } from "@/api/types"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { PageHeader } from "@/components/shared/page-header"
import { formatDate } from "@/lib/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"

const PAGE_SIZE = 20
const columnHelper = createColumnHelper<AuditLog>()

const columns = [
  columnHelper.accessor("timestamp", {
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
  columnHelper.accessor("user", {
    header: "User",
    cell: (info) => (
      <span className="text-muted-foreground">{info.getValue() ?? "--"}</span>
    ),
  }),
]

export function AuditPage() {
  const [offset, setOffset] = useState(0)
  const [actionFilter, setActionFilter] = useState("")
  const [resourceTypeFilter, setResourceTypeFilter] = useState("")

  const { data, isLoading } = useAuditLogs({
    limit: PAGE_SIZE,
    offset,
    action: actionFilter || undefined,
    resource_type: resourceTypeFilter || undefined,
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
      <PageHeader title="Audit Log" description="Track administrative actions" />

      <div className="flex items-center gap-3">
        <Select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value)
            setOffset(0)
          }}
        >
          <option value="">All actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="status_change">Status Change</option>
        </Select>
        <Select
          value={resourceTypeFilter}
          onChange={(e) => {
            setResourceTypeFilter(e.target.value)
            setOffset(0)
          }}
        >
          <option value="">All resources</option>
          <option value="channel">Channel</option>
          <option value="workflow">Workflow</option>
          <option value="connector">Connector</option>
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
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
                  No audit logs found
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
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
