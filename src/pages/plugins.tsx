import { useMemo } from "react"
import { Link, useNavigate } from "react-router"
import { usePlugins } from "@/hooks/use-plugins"
import { useHealth } from "@/hooks/use-health"
import { useRegistry } from "@/hooks/use-registry"
import type { Plugin } from "@/api/types"
import { useTable, createColumnHelper } from "@tanstack/react-table"
import { listTableFeatures } from "@/lib/table"
import { useListState } from "@/lib/use-list-state"
import { hasTag, matchesText, sortRows } from "@/lib/deployed-list"
import { dependents } from "@/lib/deployment-diff"
import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { NoMatches } from "@/components/shared/empty-state"
import { EntityTable } from "@/components/shared/entity-table"
import { ErrorState } from "@/components/shared/error-state"
import { NothingDeployedState } from "@/components/shared/deployed-state"
import { FilterBar, FilterTextInput } from "@/components/shared/filter-bar"
import { PAGE_SIZE } from "@/lib/use-pagination"
import { pluginHealthBadgeClass } from "@/lib/status"
import { plural } from "@/lib/utils"
import { Blocks } from "lucide-react"

const columnHelper = createColumnHelper<typeof listTableFeatures, Plugin>()

const FUNCTIONS_SHOWN = 3

const FILTER_KEYS = ["tag", "q"] as const

/** Column id → the sort key the URL carries. */
const SORT_FIELDS: Record<string, string> = { plugin_id: "plugin_id", revision: "revision" }

function sortValue(p: Plugin, field: string) {
  if (field === "plugin_id") return p.plugin_id
  if (field === "revision") return p.revision
  return null
}

/** This node's load of a plugin, keyed as `/health` names it: by component digest, or `id@version`. */
const loadFor = (loads: ReadonlyMap<string, NodeLoad>, p: Plugin) =>
  (p.component_digest ? loads.get(p.component_digest) : undefined) ?? loads.get(`${p.plugin_id}@${p.revision}`)

/** What this node did with a plugin version: loaded it, failed, or has no reason to. */
type NodeLoad = { state: "loaded" | "failed"; detail?: string }

/**
 * Columns take this node's load map. Load state is per replica — a plugin
 * active in the database may have failed to compile here — and the row is
 * where that belongs, not only in a banner counting failures.
 */
function buildColumns(loads: ReadonlyMap<string, NodeLoad>, usedBy: ReadonlyMap<string, number>) {
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
    columnHelper.display({
      id: "used_by",
      header: "Required by",
      cell: (info) => {
        const n = usedBy.get(info.row.original.plugin_id) ?? 0
        return n === 0 ? (
          <span className="text-xs text-muted-foreground">nothing</span>
        ) : (
          <span className="text-xs text-muted-foreground">{plural(n, "workflow")}</span>
        )
      },
    }),
    columnHelper.accessor("digest", {
      id: "node",
      header: "This node",
      cell: (info) => {
        const load = loadFor(loads, info.row.original)
        if (!load) {
          return (
            <span className="text-xs text-muted-foreground" title="Not reported by this node's health detail">
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
    columnHelper.accessor("revision", {
      header: "Revision",
      cell: (info) => <span className="font-mono text-xs text-muted-foreground">r{info.getValue()}</span>,
    }),
  ])
}

/**
 * WebAssembly plugins: custom task functions in a sandbox, deployed as
 * manifest members beside the workflows that require them.
 */
export function PluginsPage() {
  const navigate = useNavigate()
  const { filters, update, clear, hasFilters, sort, sortBy, sortOrder, offset, prev, next } = useListState(
    FILTER_KEYS,
    SORT_FIELDS,
  )
  const { data: health } = useHealth()
  const { data: plugins, isLoading, error, empty, refetch } = usePlugins()
  const registry = useRegistry()
  const usedBy = useMemo(
    () => new Map(plugins.map((p) => [p.plugin_id, dependents(registry.members, { kind: "plugin", id: p.plugin_id }).length])),
    [plugins, registry.members],
  )
  const search = filters.q.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      sortRows(
        plugins.filter((p) => matchesText(search, p.plugin_id, ...p.functions) && hasTag(p.tags, filters.tag)),
        sortBy,
        sortOrder,
        sortValue,
      ),
    [plugins, search, filters.tag, sortBy, sortOrder],
  )
  const rows = filtered.slice(offset, offset + PAGE_SIZE)

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
  const columns = useMemo(() => buildColumns(loads, usedBy), [loads, usedBy])
  const table = useTable({ features: listTableFeatures, data: rows, columns })

  const sandbox = health?.components?.plugins
  const failedLoads = health?.plugins?.failed_to_load ?? []

  return (
    <div className="space-y-6">
      <PageHeader title="Plugins" description="Custom task functions as sandboxed WebAssembly components, as the head deploys them" />

      {sandbox === "disabled" && (
        <Callout variant="info">
          The plugin sandbox is off on this node (<code className="font-mono">plugins.enabled =
          false</code>). A deployed plugin is a load issue here, and the workflows that require it
          are quarantined rather than run. Every node in a cluster must agree.
        </Callout>
      )}
      {sandbox === "degraded" && (
        <Callout variant="warning">
          {failedLoads.length > 0
            ? `${plural(failedLoads.length, "deployed plugin")} did not load on this node — the workflows naming ${failedLoads.length === 1 ? "its" : "their"} functions are quarantined.`
            : "A deployed plugin did not load on this node; the workflows naming its functions are quarantined."}{" "}
          <Link to="/engine" className="underline underline-offset-2">
            See the health report
          </Link>
        </Callout>
      )}

      <FilterBar>
        <FilterTextInput
          value={filters.q}
          onChange={(q) => update({ q })}
          placeholder="Id or function contains…"
          ariaLabel="Search plugins"
          className="w-full sm:w-56"
        />
        <FilterTextInput
          value={filters.tag}
          onChange={(tag) => update({ tag })}
          placeholder="Exact tag..."
          ariaLabel="Filter by tag"
          title="Matches one whole tag, not part of one"
        />
      </FilterBar>

      {error && plugins.length === 0 ? (
        <ErrorState title="Failed to load plugins" error={error} onRetry={() => refetch()} />
      ) : (
        <EntityTable
          table={table}
          isLoading={isLoading && plugins.length === 0}
          sort={sort}
          onOpen={(plugin) => navigate(`/plugins/${encodeURIComponent(plugin.plugin_id)}`)}
          empty={
            hasFilters ? (
              <NoMatches noun="plugins" onClear={clear} />
            ) : (
              <NothingDeployedState
                icon={Blocks}
                noun="plugins"
                headEmpty={empty}
                what="A plugin adds task functions a workflow can name — pure JSON → JSON transformations in a WebAssembly sandbox with no clock, network, connections or secrets."
              />
            )
          }
        />
      )}

      <PaginationFooter offset={offset} count={rows.length} total={filtered.length} onPrev={prev} onNext={next} />
    </div>
  )
}
