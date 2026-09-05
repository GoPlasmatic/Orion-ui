import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import {
  useCircuitBreakers,
  useConnectors,
  useReloadConnectors,
  useImportConnectors,
} from "@/hooks/use-connectors"
import { ImportDialog } from "@/components/shared/import-dialog"
import { useTable, flexRender, createColumnHelper } from "@tanstack/react-table"
import { activatableRow, listTableFeatures, ROW_ACTIVATABLE } from "@/lib/table"
import { useUrlFilters, nextSort } from "@/lib/use-url-filters"
import type { ConnectorListItem, ConnectorType, CreateConnectorRequest, SortOrder } from "@/api/types"
import { Table, TableHeader, TableBody, TableRow, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { connectorsApi } from "@/api/connectors"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { usePagination, PAGE_SIZE } from "@/lib/use-pagination"
import { EmptyState } from "@/components/shared/empty-state"
import { FilterBar, FILTER_W } from "@/components/shared/filter-bar"
import { SortableHead } from "@/components/shared/sortable-head"
import { enabledBadgeClass, disabledBadgeClass, breakerStateBadgeClass } from "@/lib/status"
import { formatDate, formatWhen, downloadJson } from "@/lib/utils"
import { Download, Plug, Plus, RefreshCw, Upload } from "lucide-react"

const columnHelper = createColumnHelper<typeof listTableFeatures, ConnectorListItem>()

const FILTER_KEYS = ["type", "tag", "sort", "order"] as const

/** Column id → the server's `sort_by` field. */
const SORT_FIELDS: Record<string, string> = {
  name: "name",
  connector_type: "connector_type",
  updated_at: "updated_at",
}

/** The most alarming breaker state among a connector's keys. */
const BREAKER_RANK: Record<string, number> = { open: 2, half_open: 1, closed: 0 }

/**
 * Columns take the breaker map: a connector whose breaker is open on this node
 * is the one an operator is looking for, and the list showed load state only.
 */
function buildColumns(breakerByConnector: ReadonlyMap<string, string>) {
  return columnHelper.columns([
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
    columnHelper.accessor("name", {
      id: "breaker",
      header: "Breaker",
      cell: (info) => {
        const state = breakerByConnector.get(info.getValue())
        if (!state) return <span className="text-muted-foreground">—</span>
        return (
          <Badge
            variant="outline"
            className={breakerStateBadgeClass(state)}
            title="Circuit breaker state on this node — the worst of its channels' keys"
          >
            {state.replace("_", "-")}
          </Badge>
        )
      },
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

/** Every connector, for a type filter the endpoint does not take. */
const ALL_CONNECTORS = 1000

export function ConnectorsPage() {
  const navigate = useNavigate()
  const { offset, reset: resetPage, prev, next } = usePagination()
  const { values: filters, set } = useUrlFilters(FILTER_KEYS)
  const typeFilter = filters.type as ConnectorType | ""
  const sortBy = SORT_FIELDS[filters.sort] ? filters.sort : ""
  const sortOrder = (filters.order === "asc" || filters.order === "desc" ? filters.order : "") as SortOrder | ""
  const [showImport, setShowImport] = useState(false)
  const [exporting, setExporting] = useState(false)

  const update = (patch: Partial<Record<(typeof FILTER_KEYS)[number], string>>) => {
    set(patch)
    resetPage()
  }

  /**
   * Exports in the shape /import accepts, with secrets masked. Only connectors
   * authored with env:// or vault:// references round-trip — a literal
   * credential exports as "******" and is refused on import, so the bundle is
   * safe to commit but is not a backup of the secrets themselves.
   */
  const handleExport = async () => {
    setExporting(true)
    try {
      const connectors = await connectorsApi.export({ tag: filters.tag || undefined })
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
  const { data: breakers } = useCircuitBreakers()

  // The list endpoint has no type filter. With one set, fetch everything and
  // page in the browser, so "DB" does not show three rows of a page of twenty
  // and still offer a full next page.
  const { data, isLoading } = useConnectors({
    limit: typeFilter ? ALL_CONNECTORS : PAGE_SIZE,
    offset: typeFilter ? 0 : offset,
    tag: filters.tag || undefined,
    sort_by: sortBy || undefined,
    sort_order: sortBy ? sortOrder || undefined : undefined,
  })
  const filtered = useMemo(
    () => (data?.data ?? []).filter((c) => !typeFilter || c.connector_type === typeFilter),
    [data?.data, typeFilter],
  )
  const rows = typeFilter ? filtered.slice(offset, offset + PAGE_SIZE) : filtered
  const total = typeFilter ? filtered.length : data?.total

  const breakerByConnector = useMemo(() => {
    const m = new Map<string, string>()
    if (!breakers?.enabled) return m
    for (const [key, state] of Object.entries(breakers.breakers ?? {})) {
      const sep = key.indexOf(":")
      const connector = sep === -1 ? key : key.slice(sep + 1)
      const current = m.get(connector)
      if (current === undefined || (BREAKER_RANK[state] ?? 0) > (BREAKER_RANK[current] ?? 0)) {
        m.set(connector, state)
      }
    }
    return m
  }, [breakers])
  const columns = useMemo(() => buildColumns(breakerByConnector), [breakerByConnector])

  const table = useTable({
    features: listTableFeatures,
    data: rows,
    columns,
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
          onChange={(e) => update({ type: e.target.value })}
          className={FILTER_W}
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          <option value="http">HTTP</option>
          <option value="kafka">Kafka</option>
          <option value="db">Database</option>
          <option value="cache">Cache</option>
          <option value="storage">Storage</option>
          <option value="es">Elasticsearch</option>
          <option value="smtp">SMTP</option>
        </Select>
        <Input
          value={filters.tag}
          onChange={(e) => update({ tag: e.target.value })}
          placeholder="Filter by tag..."
          className={FILTER_W}
          aria-label="Filter by tag"
        />
      </FilterBar>

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const field = SORT_FIELDS[header.column.id]
                  return (
                    <SortableHead
                      key={header.id}
                      field={field}
                      sort={sortBy}
                      order={sortOrder}
                      onSort={field ? () => update(nextSort({ sort: sortBy, order: sortOrder }, field, field === "updated_at")) : undefined}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </SortableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: PAGE_SIZE }).map((_, i) => (
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
                    title={typeFilter ? "No connectors of this type" : "No connectors yet"}
                    description="Connectors link workflows to external systems — HTTP services, databases, Kafka, caches, storage and mail. Create one or import existing definitions."
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
                  className={ROW_ACTIVATABLE}
                  {...activatableRow(() => navigate(`/connectors/${row.original.id}`))}
                >
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
        count={rows.length}
        total={total}
        onPrev={prev}
        onNext={next}
      />
    </div>
  )
}
