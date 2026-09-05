import { useState } from "react"
import { useNavigate } from "react-router"
import { useTraces } from "@/hooks/use-traces"
import { useTable, createColumnHelper } from "@tanstack/react-table"
import { listTableFeatures } from "@/lib/table"
import { useListState } from "@/lib/use-list-state"
import type { Trace, TraceMode, TraceSortBy, SortOrder } from "@/api/types"
import { TRACE_MODES } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { PAGE_SIZE } from "@/lib/use-pagination"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { TraceAnalytics } from "@/components/traces/trace-analytics"
import { EmptyState } from "@/components/shared/empty-state"
import { EntityTable } from "@/components/shared/entity-table"
import { FilterBar, FILTER_W } from "@/components/shared/filter-bar"
import { formatDate, formatDuration, formatRelative } from "@/lib/utils"
import { traceStatusBadgeClass } from "@/lib/status"
import { Activity, Pause, Play } from "lucide-react"

/** Poll cadence while the list is live — one trace row is cheap. */
const LIVE_INTERVAL_MS = 5_000

const columnHelper = createColumnHelper<typeof listTableFeatures, Trace>()

const columns = columnHelper.columns([
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => {
      const val = info.getValue()
      return (
        <Badge variant="outline" className={traceStatusBadgeClass(val)}>
          {val}
        </Badge>
      )
    },
  }),
  columnHelper.accessor("channel", {
    header: "Channel",
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor("mode", {
    header: "Mode",
    cell: (info) => <Badge variant="outline">{info.getValue()}</Badge>,
  }),
  // The row carries the failure reason; making the operator open every failed
  // trace to read it was the single most repeated click in an incident.
  columnHelper.accessor("error_message", {
    header: "Error",
    cell: (info) => {
      const message = info.getValue()
      if (!message) return <span className="text-muted-foreground">—</span>
      return (
        <span className="block max-w-xs truncate text-sm text-destructive" title={message}>
          {message}
        </span>
      )
    },
  }),
  columnHelper.accessor("created_at", {
    header: "Created",
    cell: (info) => (
      <span className="text-muted-foreground" title={formatDate(info.getValue())}>
        {formatRelative(info.getValue()) ?? formatDate(info.getValue())}
      </span>
    ),
  }),
  columnHelper.accessor("duration_ms", {
    id: "duration",
    header: "Duration",
    cell: (info) => (
      <span className="text-muted-foreground">{formatDuration(info.getValue())}</span>
    ),
  }),
])

/** `?channel=` and `?status=` are what the map and the dashboard hand over. */
const FILTER_KEYS = ["status", "channel", "mode"] as const

/** Column id → the server's `sort_by` field. */
const SORT_FIELDS: Record<string, TraceSortBy> = {
  status: "status",
  channel: "channel",
  mode: "mode",
  created_at: "created_at",
}

/** The server's own order when none is asked for: newest first. */
const DEFAULT_SORT: TraceSortBy = "created_at"
const DEFAULT_ORDER: SortOrder = "desc"

export function TracesPage() {
  const navigate = useNavigate()
  const { filters, update, sortBy, sortOrder, sort, offset, prev, next } = useListState(
    FILTER_KEYS,
    SORT_FIELDS,
    [DEFAULT_SORT],
  )
  // Off by default: a list that reorders itself under the pointer is the wrong
  // default for reading, and the right one for watching an incident unfold.
  const [live, setLive] = useState(false)

  // This page shows a count, so it opts into the total explicitly — every other
  // trace read (analytics, the operations dashboard) leaves it off and does not
  // pay for the scan.
  const { data, isLoading } = useTraces(
    {
      limit: PAGE_SIZE,
      offset,
      include_total: true,
      sort_by: (sortBy || DEFAULT_SORT) as TraceSortBy,
      sort_order: sortBy ? sortOrder || DEFAULT_ORDER : DEFAULT_ORDER,
      status: filters.status || undefined,
      channel: filters.channel || undefined,
      mode: (filters.mode || undefined) as TraceMode | undefined,
    },
    { refetchInterval: live ? LIVE_INTERVAL_MS : undefined },
  )

  const table = useTable({
    features: listTableFeatures,
    data: data?.data ?? [],
    columns,
  })

  return (
    <div className="space-y-6">
      <PageHeader title="Traces" description="Execution history and monitoring">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLive((v) => !v)}
          aria-pressed={live}
          title={live ? "Stop refreshing the list" : `Refresh the list every ${LIVE_INTERVAL_MS / 1000} s`}
        >
          {live ? (
            <span className="relative flex h-3.5 w-3.5 items-center justify-center">
              <span className="absolute h-2 w-2 animate-ping rounded-full bg-success/60" />
              <Pause className="relative h-3.5 w-3.5" />
            </span>
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {live ? "Pause" : "Live"}
        </Button>
      </PageHeader>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-6">
          <FilterBar>
            <Select
              value={filters.status}
              onChange={(e) => update({ status: e.target.value })}
              className={FILTER_W}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </Select>
            <Input
              placeholder="Filter by channel..."
              value={filters.channel}
              onChange={(e) => update({ channel: e.target.value })}
              className="w-48"
              aria-label="Filter by channel"
            />
            {/* `kafka` (1.4) and `cron` (1.6) are open-string additions: a consumed
                record and a scheduled occurrence each write a trace row too. */}
            <Select
              value={filters.mode}
              onChange={(e) => update({ mode: e.target.value })}
              className={FILTER_W}
              aria-label="Filter by mode"
            >
              <option value="">All modes</option>
              {TRACE_MODES.map((m) => (
                <option key={m} value={m}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </option>
              ))}
            </Select>
          </FilterBar>

          <EntityTable
            table={table}
            isLoading={isLoading}
            // The header shows the server's default order as the sort in force
            // when none is asked for, so the newest-first list reads as sorted.
            sort={{ ...sort, sortBy: sortBy || DEFAULT_SORT, sortOrder: sortBy ? sortOrder : DEFAULT_ORDER }}
            // The visible page travels along, so the detail can step to the
            // previous and next trace without a time-range API.
            onOpen={(trace) =>
              navigate(`/traces/${trace.id}`, {
                state: { siblings: (data?.data ?? []).map((t) => t.id) },
              })
            }
            empty={
              <EmptyState
                icon={Activity}
                title="No traces found"
                description="Traces are captured as requests flow through channels. Adjust the filters above, or send a request from the Data Console to generate one."
                action={
                  <Button variant="outline" onClick={() => navigate("/console")}>
                    Open Data Console
                  </Button>
                }
              />
            }
          />

          <PaginationFooter
            offset={offset}
            count={data?.data.length ?? 0}
            total={data?.total}
            onPrev={prev}
            onNext={next}
          />
        </TabsContent>

        <TabsContent value="analytics">
          <TraceAnalytics />
        </TabsContent>
      </Tabs>
    </div>
  )
}
