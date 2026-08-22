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
import type { ConnectorListItem, ConnectorType, CreateConnectorRequest } from "@/api/types"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { toast } from "sonner"
import { connectorsApi } from "@/api/connectors"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { usePagination, PAGE_SIZE } from "@/lib/use-pagination"
import { EmptyState } from "@/components/shared/empty-state"
import { FilterBar, FILTER_W } from "@/components/shared/filter-bar"
import { enabledBadgeClass, disabledBadgeClass } from "@/lib/status"
import { formatDate, downloadJson } from "@/lib/utils"
import { Download, Plug, Plus, RefreshCw, Upload } from "lucide-react"

const columnHelper = createColumnHelper<ConnectorListItem>()

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
        className={info.getValue() ? enabledBadgeClass : disabledBadgeClass}
      >
        {info.getValue() ? "Enabled" : "Disabled"}
      </Badge>
    ),
  }),
  // A connector can be enabled and still not be serving — an unresolvable
  // env:// reference, an unreachable host at load. Without this the failure is
  // invisible until a workflow using it errors.
  columnHelper.accessor("load_status", {
    header: "Load",
    cell: (info) => {
      const status = info.getValue()
      const row = info.row.original
      if (status === "loaded") {
        return <span className="text-xs text-muted-foreground">Loaded</span>
      }
      if (status === "disabled") {
        return <span className="text-xs text-muted-foreground">Disabled</span>
      }
      return (
        <Badge
          variant="destructive"
          title={[row.load_error_stage, row.load_error].filter(Boolean).join(": ")}
        >
          Failed
        </Badge>
      )
    },
  }),
  columnHelper.accessor("updated_at", {
    header: "Updated",
    cell: (info) => <span className="text-muted-foreground">{formatDate(info.getValue())}</span>,
  }),
]

export function ConnectorsPage() {
  const navigate = useNavigate()
  const { offset, reset: resetPage, prev, next } = usePagination()
  const [typeFilter, setTypeFilter] = useState<ConnectorType | "">("")
  const [showImport, setShowImport] = useState(false)
  const [exporting, setExporting] = useState(false)

  /**
   * Exports in the shape /import accepts, with secrets masked. Only connectors
   * authored with env:// or vault:// references round-trip — a literal
   * credential exports as "******" and is refused on import, so the bundle is
   * safe to commit but is not a backup of the secrets themselves.
   */
  const handleExport = async () => {
    setExporting(true)
    try {
      const connectors = await connectorsApi.export({})
      downloadJson(connectors, "orion-connectors")
      toast.success(
        `Exported ${connectors.length} connector${connectors.length !== 1 ? "s" : ""} — secrets masked`
      )
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : undefined })
    } finally {
      setExporting(false)
    }
  }
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
        <Button variant="outline" onClick={handleExport} disabled={exporting}>
          <Download className="h-4 w-4" />
          {exporting ? "Exporting..." : "Export"}
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
          onImport={(items, opts) =>
            importConnectors.mutateAsync({ items: items as CreateConnectorRequest[], ...opts })
          }
          onClose={() => setShowImport(false)}
        />
      )}

      <FilterBar>
        <Select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value as ConnectorType | "")
            resetPage()
          }}
          className={FILTER_W}
        >
          <option value="">All types</option>
          <option value="http">HTTP</option>
          <option value="kafka">Kafka</option>
          <option value="db">Database</option>
          <option value="cache">Cache</option>
          <option value="storage">Storage</option>
          <option value="es">Elasticsearch</option>
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
                    icon={Plug}
                    title="No connectors yet"
                    description="Connectors link workflows to external systems — HTTP services, databases, Kafka, caches, and storage. Create one or import existing definitions."
                    action={
                      <>
                        <Button variant="outline" onClick={() => setShowImport(true)}>
                          <Upload className="h-4 w-4" /> Import
                        </Button>
                        <Button onClick={() => navigate("/connectors/new")}>
                          <Plus className="h-4 w-4" /> Create Connector
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

      <PaginationFooter
        offset={offset}
        count={rows.length}
        total={data?.total}
        onPrev={prev}
        onNext={next}
      />
    </div>
  )
}
