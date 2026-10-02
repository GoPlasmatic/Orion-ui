import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import {
  useCircuitBreakers,
  useConnectors,
  useReloadConnectors,
  useImportConnectors,
} from "@/hooks/use-connectors"
import { useExport } from "@/hooks/use-export"
import { useEntityIndex } from "@/hooks/use-entity-index"
import { DEFAULT_TRAFFIC_WINDOW } from "@/hooks/use-metrics"
import { useConnectorTraffic, type ConnectorTrafficWindow } from "@/hooks/use-ops-metrics"
import { ImportDialog } from "@/components/shared/import-dialog"
import { useTable, createColumnHelper } from "@tanstack/react-table"
import { listTableFeatures } from "@/lib/table"
import { useListState } from "@/lib/use-list-state"
import { breakerRows } from "@/lib/breakers"
import type { ConnectorListItem, ConnectorType, CreateConnectorRequest } from "@/api/types"
import { CONNECTOR_TYPES } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { connectorsApi } from "@/api/connectors"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { PAGE_SIZE } from "@/lib/use-pagination"
import { EmptyState, NoMatches } from "@/components/shared/empty-state"
import { EntityTable } from "@/components/shared/entity-table"
import { FilterBar, FilterTextInput, FILTER_W } from "@/components/shared/filter-bar"
import { enabledBadgeClass, disabledBadgeClass, breakerStateBadgeClass } from "@/lib/status"
import { cn, formatDate, formatWhen, downloadJson, plural } from "@/lib/utils"
import { compactNumber, errorLevel, formatMs, formatPct, healthText } from "@/lib/traffic-encoding"
import { METRICS_STATE_TEXT, metricsShort } from "@/lib/metrics-state"
import { Download, Plug, Plus, RefreshCw, Upload } from "lucide-react"

const columnHelper = createColumnHelper<typeof listTableFeatures, ConnectorListItem>()

const FILTER_KEYS = ["type", "tag"] as const

/** What the type dropdown accepts; anything else in the URL reads as unset. */
const FILTER_VALUES = { type: CONNECTOR_TYPES }

/** Column id → the server's `sort_by` field. */
const SORT_FIELDS: Record<string, string> = {
  name: "name",
  connector_type: "connector_type",
  updated_at: "updated_at",
}

/** The most alarming breaker state among a connector's keys. */
const BREAKER_RANK: Record<string, number> = { open: 2, half_open: 1, closed: 0 }

/** One traffic figure in a list cell, or why there is none (metrics off, warming, idle). */
function TrafficFigure({
  traffic,
  connector,
  pick,
}: {
  traffic: ConnectorTrafficWindow
  connector: string
  pick: "rate" | "error" | "p95"
}) {
  if (traffic.state === "off" || traffic.state === "error" || traffic.state === "loading") {
    return (
      <span className="text-xs text-muted-foreground" title={METRICS_STATE_TEXT[traffic.state].sentence}>
        {traffic.state === "loading" ? "…" : "—"}
      </span>
    )
  }
  const t = traffic.byConnector.get(connector)
  if (!t || t.total === 0) {
    return <span className="text-xs text-muted-foreground" title="No call through this connector since the server started">idle</span>
  }
  if (pick === "rate") {
    if (t.ratePerMin == null) {
      return (
        <span className="text-xs text-muted-foreground" title={METRICS_STATE_TEXT.warming.sentence}>
          {metricsShort("warming")}
        </span>
      )
    }
    return <span className="font-mono text-xs tabular-nums">{compactNumber(t.ratePerMin)}/min</span>
  }
  if (pick === "error") {
    return (
      <span
        className={cn("font-mono text-xs tabular-nums", t.errorPct ? healthText[errorLevel(t.errorPct)] : "text-muted-foreground")}
        title={t.windowed != null && t.windowed > 0 ? "Over the window" : "Since the server started"}
      >
        {formatPct(t.errorPct)}
      </span>
    )
  }
  return <span className="font-mono text-xs tabular-nums">{formatMs(t.p95Ms)}</span>
}

/**
 * Columns take the breaker map: a connector whose breaker is open on this node
 * is the one an operator is looking for, and the list showed load state only.
 * They also take who depends on each connector and its live traffic: "Enabled ·
 * Loaded" read the same for a database 145 channels use as for an integration
 * one disabled channel names.
 */
function buildColumns(
  breakerByConnector: ReadonlyMap<string, string>,
  dependants: ReadonlyMap<string, string[]>,
  traffic: ConnectorTrafficWindow,
) {
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
    columnHelper.accessor("name", {
      id: "dependants",
      header: "Dependants",
      cell: (info) => {
        const users = dependants.get(info.getValue()) ?? []
        if (users.length === 0) return <span className="text-xs text-muted-foreground">none</span>
        return (
          <span
            className="text-sm tabular-nums"
            title={`${users.slice(0, 12).join(", ")}${users.length > 12 ? `, +${users.length - 12} more` : ""}`}
          >
            {plural(users.length, "channel")}
          </span>
        )
      },
    }),
    columnHelper.display({
      id: "rate",
      header: "Rate",
      cell: (info) => <TrafficFigure traffic={traffic} connector={info.row.original.name} pick="rate" />,
    }),
    columnHelper.display({
      id: "errors",
      header: "Error %",
      cell: (info) => <TrafficFigure traffic={traffic} connector={info.row.original.name} pick="error" />,
    }),
    columnHelper.display({
      id: "p95",
      header: "p95",
      cell: (info) => <TrafficFigure traffic={traffic} connector={info.row.original.name} pick="p95" />,
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
        <span className="whitespace-nowrap text-muted-foreground" title={formatDate(info.getValue())}>
          {formatWhen(info.getValue())}
        </span>
      ),
    }),
  ])
}

export function ConnectorsPage() {
  const navigate = useNavigate()
  const { filters, update, clear, hasFilters, sortQuery, sort, offset, prev, next } = useListState(
    FILTER_KEYS,
    SORT_FIELDS,
    { values: FILTER_VALUES },
  )
  const typeFilter = filters.type as ConnectorType | ""
  const [showImport, setShowImport] = useState(false)

  /**
   * Exports in the shape /import accepts, with secrets masked. Only connectors
   * authored with env:// or vault:// references round-trip — a literal
   * credential exports as "******" and is refused on import, so the bundle is
   * safe to commit but is not a backup of the secrets themselves.
   */
  const exportAll = useExport(async () => {
    const connectors = await connectorsApi.export({ tag: filters.tag || undefined })
    downloadJson(connectors, "orion-connectors")
    return `Exported ${plural(connectors.length, "connector")} — secrets masked`
  })
  const reloadConnectors = useReloadConnectors()
  const importConnectors = useImportConnectors()
  const { data: breakers } = useCircuitBreakers()

  const { data, isLoading } = useConnectors({
    limit: PAGE_SIZE,
    offset,
    tag: filters.tag || undefined,
    connector_type: typeFilter || undefined,
    ...sortQuery,
  })

  const breakerByConnector = useMemo(() => {
    const m = new Map<string, string>()
    for (const { connector, state } of breakerRows(breakers)) {
      const current = m.get(connector)
      if (current === undefined || (BREAKER_RANK[state] ?? 0) > (BREAKER_RANK[current] ?? 0)) {
        m.set(connector, state)
      }
    }
    return m
  }, [breakers])
  // Dependants come from the system graph (channel config and workflow task
  // references, the same derivation the map draws), keyed by connector name.
  const { graph } = useEntityIndex()
  const dependants = useMemo(
    () => new Map(graph.connectors.map((c) => [c.name, c.users])),
    [graph.connectors],
  )
  const traffic = useConnectorTraffic(DEFAULT_TRAFFIC_WINDOW)
  const columns = useMemo(
    () => buildColumns(breakerByConnector, dependants, traffic),
    [breakerByConnector, dependants, traffic],
  )

  const table = useTable({
    features: listTableFeatures,
    data: data?.data ?? [],
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
        <Button variant="outline" onClick={exportAll.run} disabled={exportAll.pending}>
          <Download className="h-4 w-4" />
          {exportAll.pending ? "Exporting..." : "Export"}
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
        <FilterTextInput
          value={filters.tag}
          onChange={(tag) => update({ tag })}
          placeholder="Exact tag..."
          ariaLabel="Filter by tag"
          title="Matches one whole tag, not part of one"
        />
      </FilterBar>

      <EntityTable
        table={table}
        isLoading={isLoading}
        sort={sort}
        onOpen={(connector) => navigate(`/connectors/${connector.id}`)}
        empty={
          hasFilters ? (
            <NoMatches noun="connectors" onClear={clear} />
          ) : (
            <EmptyState
              icon={Plug}
              title="No connectors yet"
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
          )
        }
      />

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
