import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"
import { useWorkflows } from "@/hooks/use-workflows"
import { useChannels } from "@/hooks/use-channels"
import { workflowsApi } from "@/api/workflows"
import { useTable, flexRender, createColumnHelper } from "@tanstack/react-table"
import { activatableRow, listTableFeatures, ROW_ACTIVATABLE } from "@/lib/table"
import { useUrlFilters, nextSort } from "@/lib/use-url-filters"
import { countLeafSteps } from "@/lib/workflow-steps"
import type { Channel, Workflow, EntityStatus, SortOrder } from "@/api/types"
import { Table, TableHeader, TableBody, TableRow, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { usePagination, PAGE_SIZE } from "@/lib/use-pagination"
import { StatusBadge } from "@/components/shared/status-badge"
import { WorkflowImportWizard } from "@/components/shared/workflow-import-wizard"
import { EmptyState } from "@/components/shared/empty-state"
import { FilterBar, FILTER_W } from "@/components/shared/filter-bar"
import { SortableHead } from "@/components/shared/sortable-head"
import { formatDate, formatWhen, downloadJson } from "@/lib/utils"
import { Download, GitBranch, Plus, Upload } from "lucide-react"

const columnHelper = createColumnHelper<typeof listTableFeatures, Workflow>()

const FILTER_KEYS = ["status", "tag", "sort", "order"] as const

/** Column id → the server's `sort_by` field. */
const SORT_FIELDS: Record<string, string> = {
  name: "name",
  status: "status",
  updated_at: "updated_at",
}

/**
 * Columns take the channel index: which channels run each workflow is
 * computable from the channel list, and it answers the question the list
 * never did — an active workflow bound to nothing is dead weight, and a draft
 * bound to an active channel is a surprise waiting for its activation.
 */
function buildColumns(runsOn: ReadonlyMap<string, Channel[]>) {
  return columnHelper.columns([
    columnHelper.accessor("name", {
      header: "Name",
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
    }),
    columnHelper.accessor("tags", {
      header: "Tags",
      cell: (info) => {
        const tags = info.getValue()
        if (!tags || tags.length === 0) return <span className="text-muted-foreground">—</span>
        return (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
            ))}
            {tags.length > 3 && (
              <Badge variant="outline" className="text-xs">+{tags.length - 3}</Badge>
            )}
          </div>
        )
      },
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => <StatusBadge status={info.getValue()} />,
    }),
    columnHelper.accessor("workflow_id", {
      id: "runs_on",
      header: "Runs on",
      cell: (info) => {
        const channels = runsOn.get(info.getValue()) ?? []
        const status = info.row.original.status
        if (channels.length === 0) {
          return status === "active" ? (
            <span className="text-xs text-warning" title="Active, but no channel runs it — nothing reaches this workflow">
              no channel
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )
        }
        const active = channels.filter((c) => c.status === "active").length
        return (
          <span
            className="text-xs text-muted-foreground"
            title={channels.map((c) => `${c.name} (${c.status})`).join(", ")}
          >
            {channels.length} channel{channels.length === 1 ? "" : "s"}
            {active !== channels.length ? ` · ${active} active` : ""}
          </span>
        )
      },
    }),
    columnHelper.accessor("version", {
      header: "Version",
      cell: (info) => <span className="text-muted-foreground">v{info.getValue()}</span>,
    }),
    columnHelper.accessor("tasks", {
      header: "Tasks",
      // Leaf count, not `tasks.length`: a task group is one array element holding
      // a whole span, so the raw length under-reports a grouped workflow.
      cell: (info) => <span className="text-muted-foreground">{countLeafSteps(info.getValue())}</span>,
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

export function WorkflowsPage() {
  const navigate = useNavigate()
  const { offset, reset: resetPage, prev, next } = usePagination()
  const { values: filters, set } = useUrlFilters(FILTER_KEYS)
  const statusFilter = filters.status as EntityStatus | ""
  const sortBy = SORT_FIELDS[filters.sort] ? filters.sort : ""
  const sortOrder = (filters.order === "asc" || filters.order === "desc" ? filters.order : "") as SortOrder | ""
  const [showImport, setShowImport] = useState(false)
  const [exporting, setExporting] = useState(false)

  const update = (patch: Partial<Record<(typeof FILTER_KEYS)[number], string>>) => {
    set(patch)
    resetPage()
  }

  const { data, isLoading } = useWorkflows({
    limit: PAGE_SIZE,
    offset,
    status: statusFilter || undefined,
    tag: filters.tag || undefined,
    sort_by: sortBy || undefined,
    sort_order: sortBy ? sortOrder || undefined : undefined,
  })
  const { data: channelList } = useChannels({ limit: 1000 })
  const runsOn = useMemo(() => {
    const m = new Map<string, Channel[]>()
    for (const c of channelList?.data ?? []) {
      if (!c.workflow_id) continue
      m.set(c.workflow_id, [...(m.get(c.workflow_id) ?? []), c])
    }
    return m
  }, [channelList?.data])
  const columns = useMemo(() => buildColumns(runsOn), [runsOn])

  // Server-side export honouring the active filters, downloaded as a JSON file
  // in the same array format the import wizard accepts.
  const handleExport = async () => {
    setExporting(true)
    try {
      const workflows = await workflowsApi.export({
        status: statusFilter || undefined,
        tag: filters.tag || undefined,
      })
      downloadJson(workflows, "orion-workflows")
      toast.success(`Exported ${workflows.length} workflow${workflows.length !== 1 ? "s" : ""}`)
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : undefined })
    } finally {
      setExporting(false)
    }
  }

  const table = useTable({
    features: listTableFeatures,
    data: data?.data ?? [],
    columns,
  })

  return (
    <div className="space-y-6">
      <PageHeader title="Workflows" description="Author, import, and manage workflow pipelines">
        <Button variant="outline" onClick={handleExport} disabled={exporting}>
          <Download className="h-4 w-4" /> {exporting ? "Exporting..." : "Export"}
        </Button>
        <Button variant="outline" onClick={() => setShowImport(true)}>
          <Upload className="h-4 w-4" /> Import
        </Button>
        <Button asChild>
          <Link to="/workflows/new">
            <Plus className="h-4 w-4" /> Create Workflow
          </Link>
        </Button>
      </PageHeader>

      <WorkflowImportWizard open={showImport} onClose={() => setShowImport(false)} />

      <FilterBar>
        <Select
          value={statusFilter}
          onChange={(e) => update({ status: e.target.value })}
          className={FILTER_W}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </Select>
        <Input
          placeholder="Filter by tag..."
          value={filters.tag}
          onChange={(e) => update({ tag: e.target.value })}
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
                    icon={GitBranch}
                    title="No workflows yet"
                    description="Workflows are task pipelines, often AI-generated and imported here for review, validation, dry-run, and safe rollout."
                    action={
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => setShowImport(true)}>
                          <Upload className="h-4 w-4" /> Import workflow
                        </Button>
                        <Button asChild>
                          <Link to="/workflows/new">
                            <Plus className="h-4 w-4" /> Create workflow
                          </Link>
                        </Button>
                      </div>
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={ROW_ACTIVATABLE}
                  {...activatableRow(() => navigate(`/workflows/${row.original.workflow_id}`))}
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
        count={data?.data.length ?? 0}
        total={data?.total}
        onPrev={prev}
        onNext={next}
      />
    </div>
  )
}
