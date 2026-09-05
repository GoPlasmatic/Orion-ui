import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import { usePlugins, useImportPlugins } from "@/hooks/use-plugins"
import { useHealth } from "@/hooks/use-health"
import { useExport } from "@/hooks/use-export"
import { pluginsApi } from "@/api/plugins"
import type { CreatePluginRequest, EntityStatus, Plugin } from "@/api/types"
import { useTable, createColumnHelper } from "@tanstack/react-table"
import { listTableFeatures } from "@/lib/table"
import { useListState } from "@/lib/use-list-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { ImportDialog } from "@/components/shared/import-dialog"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { StatusBadge } from "@/components/shared/status-badge"
import { EmptyState } from "@/components/shared/empty-state"
import { EntityTable } from "@/components/shared/entity-table"
import { ErrorState } from "@/components/shared/error-state"
import { FilterBar, FILTER_W } from "@/components/shared/filter-bar"
import { PAGE_SIZE } from "@/lib/use-pagination"
import { pluginHealthBadgeClass } from "@/lib/status"
import { formatDate, formatWhen, downloadJson } from "@/lib/utils"
import { Blocks, Download, Plus, Upload } from "lucide-react"

const columnHelper = createColumnHelper<typeof listTableFeatures, Plugin>()

const FUNCTIONS_SHOWN = 3

const FILTER_KEYS = ["status", "tag"] as const

/** Column id → the server's `sort_by` field. */
const SORT_FIELDS: Record<string, string> = {
  plugin_id: "plugin_id",
  status: "status",
  updated_at: "updated_at",
}

/** What this node did with a plugin version: loaded it, failed, or has no reason to. */
type NodeLoad = { state: "loaded" | "failed"; detail?: string }

/**
 * Columns take this node's load map. Load state is per replica — a plugin
 * active in the database may have failed to compile here — and the row is
 * where that belongs, not only in a banner counting failures.
 */
function buildColumns(loads: ReadonlyMap<string, NodeLoad>) {
  return columnHelper.columns([
    columnHelper.accessor("plugin_id", {
      header: "Plugin",
      cell: (info) => (
        <div className="min-w-0">
          <p className="font-mono text-sm font-medium">{info.getValue()}</p>
          <p className="text-xs text-muted-foreground">{info.row.original.plugin_version}</p>
        </div>
      ),
    }),
    columnHelper.accessor("functions", {
      header: "Functions",
      cell: (info) => {
        const fns = info.getValue()
        return (
          <div className="flex flex-wrap gap-1">
            {fns.slice(0, FUNCTIONS_SHOWN).map((fn) => (
              <Badge key={fn} variant="outline" className="font-mono text-[11px]">
                {fn}
              </Badge>
            ))}
            {fns.length > FUNCTIONS_SHOWN && (
              <span className="text-xs text-muted-foreground">+{fns.length - FUNCTIONS_SHOWN}</span>
            )}
          </div>
        )
      },
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => <StatusBadge status={info.getValue()} />,
    }),
    columnHelper.accessor("digest", {
      id: "node",
      header: "This node",
      cell: (info) => {
        const row = info.row.original
        const load = loads.get(row.digest) ?? loads.get(`${row.plugin_id}@${row.version}`)
        if (!load) {
          return (
            <span
              className="text-xs text-muted-foreground"
              title={row.status === "active" ? "Not reported by this node's health detail" : "Only an active version is loaded"}
            >
              —
            </span>
          )
        }
        return (
          <Badge variant="outline" className={pluginHealthBadgeClass(load.state)} title={load.detail}>
            {load.state === "loaded" ? "loaded" : "failed to load"}
          </Badge>
        )
      },
    }),
    columnHelper.accessor("version", {
      header: "Version",
      cell: (info) => <span className="text-muted-foreground">v{info.getValue()}</span>,
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

/**
 * WebAssembly plugins (Orion 1.6): custom task functions in a sandbox. A
 * plugin is a versioned entity beside channels and workflows, and the page is
 * shaped like theirs — list, filters, import/export, upload.
 */
export function PluginsPage() {
  const navigate = useNavigate()
  const { filters, update, sortQuery, sort, offset, prev, next } = useListState(FILTER_KEYS, SORT_FIELDS)
  const statusFilter = filters.status as EntityStatus | ""
  const [showImport, setShowImport] = useState(false)
  const { data: health } = useHealth()
  const importPlugins = useImportPlugins()

  const query = { status: statusFilter || undefined, tag: filters.tag || undefined }
  const { data, isLoading, error, refetch } = usePlugins({ limit: PAGE_SIZE, offset, ...query, ...sortQuery })

  const loads = useMemo(() => {
    const m = new Map<string, NodeLoad>()
    for (const p of health?.plugins?.loaded ?? []) {
      const entry: NodeLoad = {
        state: "loaded",
        detail: p.compile_ms != null ? `Compiled in ${Math.round(p.compile_ms)} ms` : undefined,
      }
      m.set(p.digest, entry)
      m.set(`${p.plugin}@${p.version}`, entry)
    }
    for (const p of health?.plugins?.failed_to_load ?? []) {
      const entry: NodeLoad = { state: "failed", detail: `${p.stage}: ${p.reason}` }
      m.set(p.digest, entry)
      m.set(`${p.plugin}@${p.version}`, entry)
    }
    return m
  }, [health?.plugins])
  const columns = useMemo(() => buildColumns(loads), [loads])

  const table = useTable({
    features: listTableFeatures,
    data: data?.data ?? [],
    columns,
  })

  // With the artifacts inlined the bundle is self-contained — what a promotion
  // to another instance needs. Without them each item names a digest only the
  // exporting instance holds.
  const exportAll = useExport(async () => {
    const plugins = await pluginsApi.export({ ...query, include_artifacts: true })
    downloadJson(plugins, "orion-plugins")
    return {
      message: `Exported ${plugins.length} plugin${plugins.length !== 1 ? "s" : ""}`,
      description: "Components inlined as base64",
    }
  })

  const sandbox = health?.components?.plugins
  const failedLoads = health?.plugins?.failed_to_load ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plugins"
        description="Custom task functions as sandboxed WebAssembly components"
      >
        <Button variant="outline" onClick={exportAll.run} disabled={exportAll.pending}>
          <Download className="h-4 w-4" />
          {exportAll.pending ? "Exporting..." : "Export"}
        </Button>
        <Button variant="outline" onClick={() => setShowImport(true)}>
          <Upload className="h-4 w-4" />
          Import
        </Button>
        <Button onClick={() => navigate("/plugins/new")}>
          <Plus className="h-4 w-4" />
          Upload Plugin
        </Button>
      </PageHeader>

      {showImport && (
        <ImportDialog
          title="Import Plugins"
          onImport={(items, opts) =>
            importPlugins.mutateAsync({ items: items as CreatePluginRequest[], ...opts })
          }
          onClose={() => setShowImport(false)}
        />
      )}

      {sandbox === "disabled" && (
        <Callout variant="info">
          The plugin sandbox is off on this node (<code className="font-mono">plugins.enabled =
          false</code>). Uploads answer 400, and a stored active plugin quarantines the workflows
          that call its functions rather than running them. Every node in a cluster must agree.
        </Callout>
      )}
      {sandbox === "degraded" && (
        <Callout variant="warning">
          {failedLoads.length > 0
            ? `${failedLoads.length} active plugin version${failedLoads.length === 1 ? "" : "s"} did not load on this node — the workflows naming ${failedLoads.length === 1 ? "its" : "their"} functions are quarantined.`
            : "An active plugin did not load on this node; the workflows naming its functions are quarantined."}{" "}
          <Link to="/engine" className="underline underline-offset-2">
            See the health report
          </Link>
        </Callout>
      )}

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
          value={filters.tag}
          onChange={(e) => update({ tag: e.target.value })}
          placeholder="Filter by tag..."
          className={FILTER_W}
          aria-label="Filter by tag"
        />
      </FilterBar>

      {error ? (
        <ErrorState title="Failed to load plugins" error={error} onRetry={() => refetch()} />
      ) : (
        <EntityTable
          table={table}
          isLoading={isLoading}
          sort={sort}
          onOpen={(plugin) => navigate(`/plugins/${encodeURIComponent(plugin.plugin_id)}`)}
          empty={
            <EmptyState
              icon={Blocks}
              title="No plugins yet"
              description="A plugin adds task functions a workflow can name — pure JSON → JSON transformations that run in a WebAssembly sandbox with no clock, network, connectors or secrets. Upload a manifest and its component to start."
              action={
                <>
                  <Button variant="outline" onClick={() => setShowImport(true)}>
                    <Upload className="h-4 w-4" /> Import
                  </Button>
                  <Button onClick={() => navigate("/plugins/new")}>
                    <Plus className="h-4 w-4" /> Upload Plugin
                  </Button>
                </>
              }
            />
          }
        />
      )}

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
