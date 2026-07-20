import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"
import { useWorkflows } from "@/hooks/use-workflows"
import { workflowsApi } from "@/api/workflows"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table"
import type { Workflow, EntityStatus } from "@/api/types"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { WorkflowImportWizard } from "@/components/shared/workflow-import-wizard"
import { EmptyState } from "@/components/shared/empty-state"
import { formatDate } from "@/lib/utils"
import { ChevronLeft, ChevronRight, Download, GitBranch, Plus, Upload } from "lucide-react"

const PAGE_SIZE = 20
const columnHelper = createColumnHelper<Workflow>()

const columns = [
  columnHelper.accessor("name", {
    header: "Name",
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor("tags", {
    header: "Tags",
    cell: (info) => {
      const tags = info.getValue()
      if (!tags || tags.length === 0) return <span className="text-muted-foreground">--</span>
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
  columnHelper.accessor("version", {
    header: "Version",
    cell: (info) => <span className="text-muted-foreground">v{info.getValue()}</span>,
  }),
  columnHelper.accessor("tasks", {
    header: "Tasks",
    cell: (info) => <span className="text-muted-foreground">{info.getValue()?.length ?? 0}</span>,
  }),
  columnHelper.accessor("updated_at", {
    header: "Updated",
    cell: (info) => (
      <span className="text-muted-foreground">{formatDate(info.getValue())}</span>
    ),
  }),
]

export function WorkflowsPage() {
  const navigate = useNavigate()
  const [offset, setOffset] = useState(0)
  const [statusFilter, setStatusFilter] = useState<EntityStatus | "">("")
  const [tagFilter, setTagFilter] = useState("")
  const [showImport, setShowImport] = useState(false)
  const [exporting, setExporting] = useState(false)

  const { data, isLoading } = useWorkflows({
    limit: PAGE_SIZE,
    offset,
    status: statusFilter || undefined,
    tag: tagFilter || undefined,
  })

  // Server-side export honouring the active filters, downloaded as a JSON file
  // in the same array format the import wizard accepts.
  const handleExport = async () => {
    setExporting(true)
    try {
      const workflows = await workflowsApi.export({
        status: statusFilter || undefined,
        tag: tagFilter || undefined,
      })
      const blob = new Blob([JSON.stringify(workflows, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `orion-workflows-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${workflows.length} workflow${workflows.length !== 1 ? "s" : ""}`)
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : undefined })
    } finally {
      setExporting(false)
    }
  }

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
      <div className="flex items-start justify-between">
        <PageHeader title="Workflows" description="Author, import, and manage workflow pipelines" />
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            <Download className="h-4 w-4" /> {exporting ? "Exporting..." : "Export"}
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4" /> Import
          </Button>
          <Button asChild>
            <Link to="/workflows/new">
              <Plus className="h-4 w-4" /> New Workflow
            </Link>
          </Button>
        </div>
      </div>

      <WorkflowImportWizard open={showImport} onClose={() => setShowImport(false)} />

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
        <Input
          placeholder="Filter by tag..."
          value={tagFilter}
          onChange={(e) => {
            setTagFilter(e.target.value)
            setOffset(0)
          }}
          className="w-48"
        />
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
                            <Plus className="h-4 w-4" /> New workflow
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
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/workflows/${row.original.workflow_id}`)}
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
