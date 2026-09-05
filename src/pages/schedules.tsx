import { useMemo, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { useCronStatus, useCronOccurrences, useRetryOccurrence } from "@/hooks/use-cron"
import { useTriggerChannel } from "@/hooks/use-channels"
import { useHealth } from "@/hooks/use-health"
import { useCronMetrics } from "@/hooks/use-metrics"
import type { CronOccurrenceStatus } from "@/api/types"
import { CRON_OCCURRENCE_STATUSES } from "@/api/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { SortableHead } from "@/components/shared/sortable-head"
import { nextSort } from "@/lib/use-url-filters"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { PaginationFooter } from "@/components/shared/pagination"
import { EmptyState } from "@/components/shared/empty-state"
import { FilterBar, FILTER_W } from "@/components/shared/filter-bar"
import { OccurrencesTable } from "@/components/shared/occurrences-table"
import { usePagination, PAGE_SIZE } from "@/lib/use-pagination"
import { occurrenceStatusBadgeClass, statusChartColor } from "@/lib/status"
import { occurrenceStatusLabel } from "@/lib/cron"
import { formatDate, serverTime, toRfc3339, cn } from "@/lib/utils"
import { useTimeZone } from "@/lib/use-time-zone"
import { CalendarClock, Play, Plus, History } from "lucide-react"


function relative(iso: string | null | undefined): string {
  const at = serverTime(iso)
  if (at == null) return "—"
  const diff = at - Date.now()
  const abs = Math.abs(diff)
  const unit =
    abs < 60_000
      ? `${Math.round(abs / 1000)}s`
      : abs < 3_600_000
        ? `${Math.round(abs / 60_000)}m`
        : abs < 86_400_000
          ? `${(abs / 3_600_000).toFixed(1)}h`
          : `${(abs / 86_400_000).toFixed(1)}d`
  return diff >= 0 ? `in ${unit}` : `${unit} ago`
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-2xl font-bold tabular-nums", tone)}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

/**
 * Cron channels (Orion 1.6): what is scheduled, when it next fires, and the
 * occurrence ledger — the durable record of every instant a schedule was due,
 * kept whether or not a trace survived. Occurrences are filtered by
 * `channel_id` rather than name because an occurrence outlives the name it was
 * materialised under.
 */
export function SchedulesPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { offset, reset: resetPage, prev, next } = usePagination()
  // Seeded from the URL so a channel page or the map can land here filtered.
  const [channelFilter, setChannelFilter] = useState(() => params.get("channel_id") ?? "")
  const [statusFilter, setStatusFilter] = useState<CronOccurrenceStatus | "">("")
  const [since, setSince] = useState("")
  const [until, setUntil] = useState("")

  const { data: status, isLoading: statusLoading, error: statusError } = useCronStatus()
  const { data: health } = useHealth()
  const metrics = useCronMetrics()
  const trigger = useTriggerChannel()
  const retry = useRetryOccurrence()
  const { label: zoneLabel } = useTimeZone()

  const { data: occurrences, isLoading: occurrencesLoading } = useCronOccurrences(
    {
      limit: PAGE_SIZE,
      offset,
      channel_id: channelFilter || undefined,
      status: statusFilter || undefined,
      since: toRfc3339(since),
      until: toRfc3339(until),
    },
    { refetchInterval: 10_000 },
  )

  function updateChannelFilter(value: string) {
    setChannelFilter(value)
    const nextParams = new URLSearchParams(params)
    if (value) nextParams.set("channel_id", value)
    else nextParams.delete("channel_id")
    setParams(nextParams, { replace: true })
    resetPage()
  }

  const schedules = useMemo(() => status ?? [], [status])
  // The status table sorts in the browser — one row per active cron channel
  // is a small list — by next fire by default, so what is due soonest leads.
  const [tableSort, setTableSort] = useState({ sort: "next", order: "asc" })
  const sortedSchedules = useMemo(() => {
    const dir = tableSort.order === "desc" ? -1 : 1
    // Rows without an instant sort last whichever way the column runs.
    const instant = (value: string | null | undefined) => {
      const t = serverTime(value)
      return t == null ? (dir === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY) : t
    }
    return [...schedules].sort((a, b) => {
      switch (tableSort.sort) {
        case "channel":
          return dir * a.channel_name.localeCompare(b.channel_name)
        case "pending":
          return dir * (a.pending - b.pending)
        case "last":
          return (
            dir *
            (instant(a.last_completed_at ?? a.last_scheduled_for) -
              instant(b.last_completed_at ?? b.last_scheduled_for))
          )
        default:
          return dir * (instant(a.next_fire_at) - instant(b.next_fire_at))
      }
    })
  }, [schedules, tableSort])
  const sortOn = (field: string, newestFirst = false) =>
    setTableSort((current) => {
      const next = nextSort(current, field, newestFirst)
      return next.sort ? next : { sort: "next", order: "asc" }
    })
  const cronComponent = health?.components?.cron
  const cronDetail = health?.cron

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedules"
        description="Cron channels — what is scheduled, when it next fires, and every occurrence that was due"
      >
        <Button onClick={() => navigate("/channels/new?protocol=cron")}>
          <Plus className="h-4 w-4" />
          Create Cron Channel
        </Button>
      </PageHeader>

      {cronComponent === "degraded" && (
        <Callout variant="warning">
          <p className="font-medium">The scheduler is degraded on this node.</p>
          <p className="text-xs">
            {cronDetail?.reconcile_age_secs != null
              ? `The reconciler last completed a pass ${Math.round(cronDetail.reconcile_age_secs)}s ago — long enough that occurrences are being missed.`
              : "Either the reconciler is not completing passes, or the scheduler is off (cron.enabled = false) while active cron channels are stored — every liveness signal is green and the declared schedules are simply not running."}{" "}
            <Link to="/engine" className="underline underline-offset-2">
              Health report
            </Link>
          </p>
        </Callout>
      )}

      {metrics.available && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Pending occurrences"
            value={metrics.pending == null ? "—" : metrics.pending.toLocaleString()}
            hint="A number that only grows means work is produced faster than it runs"
            tone={metrics.pending != null && metrics.pending > 0 ? "text-warning" : undefined}
          />
          <Kpi
            label="Schedule lag p95"
            value={metrics.lagP95Sec == null ? "—" : `${metrics.lagP95Sec.toFixed(1)}s`}
            hint="How late an occurrence began — the scheduler's core signal"
          />
          <Kpi
            label="Lease renewals lost"
            value={metrics.leaseRenewalFailures.toLocaleString()}
            hint="Attempts cancelled mid-run; whether their side effects landed is unknowable"
            tone={metrics.leaseRenewalFailures > 0 ? "text-destructive" : undefined}
          />
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Occurrences since start</p>
              {metrics.byStatus.length === 0 ? (
                <p className="mt-1 text-2xl font-bold">0</p>
              ) : (
                <ul className="mt-1.5 space-y-0.5 text-xs">
                  {metrics.byStatus.map((s) => (
                    <li key={s.status} className="flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: statusChartColor(s.status) }}
                      />
                      <span className="text-muted-foreground">{occurrenceStatusLabel(s.status)}</span>
                      <span className="ml-auto font-mono tabular-nums">{s.value.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex h-[3.25rem] flex-row items-center justify-between pb-2">
          <CardTitle>Active schedules</CardTitle>
          <span className="text-xs text-muted-foreground">
            {schedules.length} channel{schedules.length === 1 ? "" : "s"}
          </span>
        </CardHeader>
        <CardContent>
          {statusError ? (
            <Callout variant="destructive">
              {statusError instanceof Error ? statusError.message : "Failed to load schedules"}
            </Callout>
          ) : statusLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : schedules.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No active schedules"
              description="A cron channel binds a six-field expression and a fixed payload to a workflow, in transport_config — versioned, content-hashed and promoted like any other definition. Activate one and it appears here within a poll interval."
              action={
                <Button onClick={() => navigate("/channels/new?protocol=cron")}>
                  <Plus className="h-4 w-4" /> Create Cron Channel
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead field="channel" sort={tableSort.sort} order={tableSort.order} onSort={() => sortOn("channel")}>
                    Channel
                  </SortableHead>
                  <TableHead>Schedule</TableHead>
                  <SortableHead field="next" sort={tableSort.sort} order={tableSort.order} onSort={() => sortOn("next")}>
                    Next fire
                  </SortableHead>
                  <SortableHead field="last" sort={tableSort.sort} order={tableSort.order} onSort={() => sortOn("last", true)}>
                    Last run
                  </SortableHead>
                  <SortableHead field="pending" sort={tableSort.sort} order={tableSort.order} onSort={() => sortOn("pending", true)} className="text-right">
                    Pending
                  </SortableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSchedules.map((s) => (
                  <TableRow key={s.channel_id}>
                    <TableCell>
                      <Link to={`/channels/${s.channel_id}`} className="font-medium hover:underline">
                        {s.channel_name}
                      </Link>
                      {s.paused_at && (
                        <Badge variant="outline" className="ml-2 text-[10px]" title={`Left the active set ${formatDate(s.paused_at)}`}>
                          paused
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{s.schedule}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{s.timezone}</span>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {s.next_fire_at ? (
                        <span title={formatDate(s.next_fire_at)}>{relative(s.next_fire_at)}</span>
                      ) : (
                        <span className="text-muted-foreground" title="The reconciler has not seen the channel yet — it appears within one poll interval of activation">
                          pending
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.last_status ? (
                        <span className="flex items-center gap-2">
                          <Badge variant="outline" className={occurrenceStatusBadgeClass(s.last_status)}>
                            {s.last_status}
                          </Badge>
                          <span className="text-xs text-muted-foreground" title={s.last_scheduled_for ? formatDate(s.last_scheduled_for) : undefined}>
                            {relative(s.last_completed_at ?? s.last_scheduled_for)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">never</span>
                      )}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", s.pending > 0 && "text-warning")}>
                      {s.pending}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => updateChannelFilter(s.channel_id)}
                          title="Show this channel's occurrences"
                        >
                          <History /> History
                        </Button>
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={trigger.isPending}
                          onClick={() => trigger.mutate(s.channel_id)}
                          title="Run now, through the same claim and singleton path a scheduled occurrence takes"
                        >
                          <Play /> Trigger now
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Occurrences</h2>
          <p className="text-xs text-muted-foreground">
            The ledger, newest first. A retry is another attempt at the same occurrence; re-running
            finished work is a trigger, which mints a new one.
          </p>
        </div>
        <FilterBar>
          <Select
            value={channelFilter}
            onChange={(e) => updateChannelFilter(e.target.value)}
            className={FILTER_W}
            aria-label="Filter by channel"
          >
            <option value="">All channels</option>
            {schedules.map((s) => (
              <option key={s.channel_id} value={s.channel_id}>
                {s.channel_name}
              </option>
            ))}
            {channelFilter && !schedules.some((s) => s.channel_id === channelFilter) && (
              <option value={channelFilter}>{channelFilter}</option>
            )}
          </Select>
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as CronOccurrenceStatus | "")
              resetPage()
            }}
            className={FILTER_W}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {CRON_OCCURRENCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {occurrenceStatusLabel(s)}
              </option>
            ))}
          </Select>
          <Input
            type="datetime-local"
            value={since}
            onChange={(e) => {
              setSince(e.target.value)
              resetPage()
            }}
            className="w-52"
            aria-label="Scheduled since"
          />
          <Input
            type="datetime-local"
            value={until}
            onChange={(e) => {
              setUntil(e.target.value)
              resetPage()
            }}
            className="w-52"
            aria-label="Scheduled until"
          />
          <span className="self-center text-xs text-muted-foreground" title="Change on the Engine page, under Display">
            times in {zoneLabel}
          </span>
        </FilterBar>

        <OccurrencesTable
          rows={occurrences?.data ?? []}
          isLoading={occurrencesLoading}
          onRetry={(id) => retry.mutate(id)}
          retryPending={retry.isPending}
        />

        <PaginationFooter
          offset={offset}
          count={occurrences?.data.length ?? 0}
          total={occurrences?.total}
          onPrev={prev}
          onNext={next}
        />
      </div>
    </div>
  )
}
