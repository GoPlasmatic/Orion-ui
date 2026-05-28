import { useState } from "react"
import { useNavigate } from "react-router"
import { useConnectors, useReloadConnectors, useImportConnectors } from "@/hooks/use-connectors"
import { ImportDialog } from "@/components/shared/import-dialog"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table"
import type { Connector, ConnectorType, CreateConnectorRequest } from "@/api/types"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { PageHeader } from "@/components/shared/page-header"
import { formatDate } from "@/lib/utils"
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Upload } from "lucide-react"

const PAGE_SIZE = 20
const columnHelper = createColumnHelper<Connector>()

const columns = [
  columnHelper.accessor("name", {
    header: "Name",
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor("connector_type", {
    header: "Type",
    cell: (info) => (
      <Badge variant="outline" className="uppercase">{info.getValue()}</Badge>
    ),
  }),
  columnHelper.accessor("enabled", {
    header: "Status",
    cell: (info) => (
      <Badge
        variant="outline"
        className={
          info.getValue()
            ? "border-emerald-200 text-emerald-700"
            : "border-muted-foreground/30 text-muted-foreground"
        }
      >
        {info.getValue() ? "Enabled" : "Disabled"}
      </Badge>
    ),
  }),
  columnHelper.accessor("updated_at", {
    header: "Updated",
    cell: (info) => <span className="text-muted-foreground">{formatDate(info.getValue())}</span>,
  }),
]

export function ConnectorsPage() {
  const navigate = useNavigate()
  const [offset, setOffset] = useState(0)
  const [typeFilter, setTypeFilter] = useState<ConnectorType | "">("")
  const [showImport, setShowImport] = useState(false)
  const reloadConnectors = useReloadConnectors()
  const importConnectors = useImportConnectors()

  const { data, isLoading } = useConnectors({
    limit: PAGE_SIZE,
    offset,
  })

  // The list endpoint filters only by limit/offset, so type filtering is client-side.
  const rows = (data?.data ?? []).filter(
    (c) => !typeFilter || c.connector_type === typeFilter
  )

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const total = data?.total ?? 0
  const hasNext = offset + PAGE_SIZE < total
  const hasPrev = offset > 0

  return (
    <div className="space-y-6">
      <PageHeader title="Connectors" description="Manage external system connections">
        <Button
          variant="outline"
          onClick={() => reloadConnectors.mutate()}
          disabled={reloadConnectors.isPending}
        >
          <RefreshCw className={`h-4 w-4 ${reloadConnectors.isPending ? "animate-spin" : ""}`} />
          Reload All
        </Button>
        <Button variant="outline" onClick={() => setShowImport(true)}>
          <Upload className="h-4 w-4" />
          Import
        </Button>
        <Button onClick={() => navigate("/connectors/new")}>
          <Plus className="h-4 w-4" />
          Create Connector
        </Button>
      </PageHeader>

      {showImport && (
        <ImportDialog
          title="Import Connectors"
          onImport={(items, dryRun) =>
            importConnectors.mutateAsync({ items: items as CreateConnectorRequest[], dryRun })
          }
          onClose={() => setShowImport(false)}
        />
      )}

      <div className="flex items-center gap-3">
        <Select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value as ConnectorType | "")
            setOffset(0)
          }}
        >
          <option value="">All types</option>
          <option value="http">HTTP</option>
          <option value="kafka">Kafka</option>
          <option value="db">Database</option>
          <option value="cache">Cache</option>
          <option value="storage">Storage</option>
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
                  No connectors found
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/connectors/${row.original.id}`)}
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
