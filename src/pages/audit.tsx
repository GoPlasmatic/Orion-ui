import { useState, type ReactNode } from "react"
import { Link } from "react-router"
import { toast } from "sonner"
import { useAuditLogs } from "@/hooks/use-audit"
import { auditApi } from "@/api/audit"
import { useTable, flexRender, createColumnHelper } from "@tanstack/react-table"
import { listTableFeatures } from "@/lib/table"
import { useUrlFilters } from "@/lib/use-url-filters"
import type { AuditLog } from "@/api/types"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { FilterBar, FILTER_W } from "@/components/shared/filter-bar"
import { JsonViewer } from "@/components/shared/json-viewer"
import { usePagination, PAGE_SIZE } from "@/lib/use-pagination"
import { formatDate, formatRelative, parseJson, toRfc3339, downloadJson, downloadText } from "@/lib/utils"
import { useTimeZone } from "@/lib/use-time-zone"
import { auditResourceRoute } from "@/lib/audit-routes"
import { ChevronDown, ChevronRight, Download } from "lucide-react"

const columnHelper = createColumnHelper<typeof listTableFeatures, AuditLog>()

/** Every filter in the URL: an audit search is the thing most worth pasting into an incident thread. */
const FILTER_KEYS = ["action", "resource_type", "resource_id", "principal", "start", "end"] as const

/** The server clamps `limit` to 1000; an export takes the most recent thousand under the filter. */
const EXPORT_LIMIT = 1000

/**
 * `details.change_context` — the value a multi-request promotion sent as
 * `X-Orion-Change-Context`, which is what groups its audit rows. The server
 * has no filter on it yet, so it is shown, not searchable.
 */
function changeContextOf(entry: AuditLog): string | null {
  const parsed = parseJson(entry.details)
  if (!parsed || typeof parsed !== "object") return null
  const ctx = (parsed as { change_context?: unknown }).change_context
  return typeof ctx === "string" && ctx ? ctx : null
}

const columns = columnHelper.columns([
  // The chevron is drawn by the page, which owns the expanded set; the column
  // exists so the header row has a slot for it.
  columnHelper.display({
    id: "expand",
    header: "",
    cell: () => null,
  }),
  columnHelper.accessor("created_at", {
    header: "Time",
    cell: (info) => (
      <span className="text-sm" title={formatDate(info.getValue())}>
        {formatRelative(info.getValue()) ?? formatDate(info.getValue())}
      </span>
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
    cell: (info) => {
      const id = info.getValue()
      const route = auditResourceRoute(info.row.original.resource_type, id)
      if (!route) return <span className="font-mono text-xs">{id}</span>
      return (
        <Link
          to={route}
          className="font-mono text-xs text-primary underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {id}
        </Link>
      )
    },
  }),
  columnHelper.accessor("principal", {
    header: "User",
    cell: (info) => (
      <span className="text-muted-foreground">{info.getValue() ?? "—"}</span>
    ),
  }),
  columnHelper.accessor("details", {
    id: "context",
    header: "Context",
    cell: (info) => {
      const ctx = changeContextOf(info.row.original)
      if (!ctx) return <span className="text-muted-foreground">—</span>
      return (
        <span
          className="inline-block max-w-40 truncate font-mono text-xs text-muted-foreground"
          title={`change_context: ${ctx} — the rows of one promotion share it`}
        >
          {ctx}
        </span>
      )
    },
  }),
])

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function AuditPage() {
  const { offset, reset: resetPage, prev, next } = usePagination()
  const { values: filters, set } = useUrlFilters(FILTER_KEYS)
  // Rows whose `details` are open. The column is what the server recorded
  // about the change — the request that made it, the change context — and it
  // was never rendered.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [exporting, setExporting] = useState(false)
  const { label: zoneLabel } = useTimeZone()

  const query = {
    action: filters.action || undefined,
    resource_type: filters.resource_type || undefined,
    resource_id: filters.resource_id || undefined,
    principal: filters.principal || undefined,
    start_time: toRfc3339(filters.start),
    end_time: toRfc3339(filters.end),
  }

  // Filtering is server-side since 1.0. It used to fetch the most recent 1000
  // entries and filter locally, which quietly hid anything older.
  const { data, isLoading } = useAuditLogs({ limit: PAGE_SIZE, offset, ...query })

  const table = useTable({
    features: listTableFeatures,
    data: data?.data ?? [],
    columns,
  })

  // Any control change re-anchors paging to the first page.
  const update = (patch: Partial<Record<(typeof FILTER_KEYS)[number], string>>) => {
    set(patch)
    resetPage()
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const nextSet = new Set(prev)
      if (nextSet.has(id)) nextSet.delete(id)
      else nextSet.add(id)
      return nextSet
    })

  /** The current filter, newest first, as a file — the thousand most recent rows. */
  const handleExport = async (format: "json" | "csv") => {
    setExporting(true)
    try {
      const page = await auditApi.list({ ...query, limit: EXPORT_LIMIT, offset: 0 })
      const rows = page.data
      if (format === "json") {
        downloadJson(rows, "orion-audit")
      } else {
        const header = ["id", "created_at", "principal", "action", "resource_type", "resource_id", "change_context", "details"]
        const lines = rows.map((r) =>
          [r.id, r.created_at, r.principal, r.action, r.resource_type, r.resource_id, changeContextOf(r) ?? "", r.details ?? ""]
            .map(csvCell)
            .join(","),
        )
        downloadText([header.join(","), ...lines].join("\n"), "orion-audit", "csv", "text/csv")
      }
      toast.success(
        `Exported ${rows.length} audit ${rows.length === 1 ? "row" : "rows"}${
          rows.length === EXPORT_LIMIT ? " — the most recent thousand under this filter" : ""
        }`,
      )
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : undefined })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Audit Log" description="Track administrative actions">
        <Button variant="outline" onClick={() => handleExport("csv")} disabled={exporting}>
          <Download className="h-4 w-4" />
          {exporting ? "Exporting..." : "Export CSV"}
        </Button>
        <Button variant="outline" onClick={() => handleExport("json")} disabled={exporting}>
          <Download className="h-4 w-4" />
          Export JSON
        </Button>
      </PageHeader>

      <FilterBar>
        <Select
          value={filters.action}
          onChange={(e) => update({ action: e.target.value })}
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
          value={filters.resource_type}
          onChange={(e) => update({ resource_type: e.target.value })}
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
          value={filters.resource_id}
          onChange={(e) => update({ resource_id: e.target.value })}
          placeholder="Resource ID"
          className="w-44"
          aria-label="Filter by resource ID"
        />
        <Input
          value={filters.principal}
          onChange={(e) => update({ principal: e.target.value })}
          placeholder="Principal"
          className="w-40"
          aria-label="Filter by principal"
        />
        <Input
          type="datetime-local"
          value={filters.start}
          onChange={(e) => update({ start: e.target.value })}
          className="w-52"
          aria-label="From"
        />
        <Input
          type="datetime-local"
          value={filters.end}
          onChange={(e) => update({ end: e.target.value })}
          className="w-52"
          aria-label="To"
        />
        <span className="self-center text-xs text-muted-foreground" title="Change on the Engine page, under Display">
          times in {zoneLabel}
        </span>
      </FilterBar>

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className={header.column.id === "expand" ? "w-8" : undefined}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
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
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
                  No audit logs found
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => {
                const entry = row.original
                const hasDetails = !!entry.details
                const isOpen = hasDetails && expanded.has(entry.id)
                return (
                  <TableRowGroup key={row.id}>
                    <TableRow
                      className={hasDetails ? "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60" : undefined}
                      tabIndex={hasDetails ? 0 : undefined}
                      aria-expanded={hasDetails ? isOpen : undefined}
                      onClick={hasDetails ? () => toggle(entry.id) : undefined}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return
                        if (hasDetails && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault()
                          toggle(entry.id)
                        }
                      }}
                    >
                      {row.getAllCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {cell.column.id === "expand" ? (
                            hasDetails ? (
                              <span className="text-muted-foreground" aria-hidden>
                                {isOpen ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                              </span>
                            ) : null
                          ) : (
                            flexRender(cell.column.columnDef.cell, cell.getContext())
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                    {isOpen && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={columns.length} className="bg-muted/30 py-3">
                          <JsonViewer data={parseJson(entry.details)} label="Details" maxHeight="16rem" />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableRowGroup>
                )
              })
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

/** A row and its expanded detail row share one key without an extra wrapper element. */
function TableRowGroup({ children }: { children: ReactNode }) {
  return <>{children}</>
}
