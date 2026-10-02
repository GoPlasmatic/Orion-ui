import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { CalendarClock, Network, Pause, Play, RefreshCw } from "lucide-react"
import { useTraces } from "@/hooks/use-traces"
import { useTraceDlq } from "@/hooks/use-trace-dlq"
import { useAuditLogs } from "@/hooks/use-audit"
import { useEntityIndex } from "@/hooks/use-entity-index"
import {
  DEFAULT_TRAFFIC_WINDOW,
  TRAFFIC_WINDOWS,
  trafficWindowFromParam,
  trafficWindowLabel,
  useChannelTraffic,
  useMetrics,
  type TrafficWindow,
} from "@/hooks/use-metrics"
import { useSubsystemMetrics, type SubsystemMetrics } from "@/hooks/use-ops-metrics"
import { useAttentionItems, useIncidentAcks } from "@/hooks/use-attention"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { PageHeader } from "@/components/shared/page-header"
import { OutcomeBar } from "@/components/shared/outcome-bar"
import { GettingStarted } from "@/components/shared/getting-started"
import { MetricsStatePill } from "@/components/operations/metrics-state"
import { InstanceStrip } from "@/components/operations/instance-strip"
import { GoldenSignals } from "@/components/operations/golden-signals"
import { IncidentsPanel } from "@/components/operations/incidents-panel"
import { DomainsGrid, type DomainChannel } from "@/components/operations/domains-grid"
import { SubsystemsRow } from "@/components/operations/subsystems-row"
import { useUrlFilters } from "@/lib/use-url-filters"
import { isFirstRun } from "@/lib/onboarding"
import { buildDomains } from "@/lib/domains"
import { formatDate, formatDuration, formatRelative, formatSpan, serverTime, cn } from "@/lib/utils"
import { occurrenceStatusBadgeClass } from "@/lib/status"

/** Rows a summary table shows before deferring to its own page. */
const TABLE_ROWS = 8
/** Schedules due within this long make the "next runs" strip. */
const UPCOMING_MS = 24 * 60 * 60 * 1000

/** The one view setting the dashboard keeps in the URL. */
const WINDOW_KEY = ["window"] as const

/** What a pause holds still: every metric-derived figure, as last drawn. */
interface Frozen {
  traffic: TrafficWindow
  subsystems: SubsystemMetrics
}

/**
 * Operations: the signals and the incidents first, the inventory last.
 *
 * Above the fold — one line about the instance, the four golden signals over
 * the chosen window, incidents (grouped failures and live faults, which
 * resolve themselves when later runs succeed) beside the domain health grid,
 * and every subsystem's state in one row. Below it, the reference data: the
 * per-channel table, workflow cost and the next 24 h of schedules.
 */
export function OperationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // The window every windowed figure on this page shares, in the URL like the
  // map's so a link carries it. Incidents read a fixed window of their own
  // (`INCIDENT_WINDOW`) so the sidebar and this page agree on what is open.
  const { values: view, set: setView } = useUrlFilters(WINDOW_KEY)
  const windowSec = trafficWindowFromParam(view.window)
  const windowLabel = trafficWindowLabel(windowSec)

  const {
    incidents,
    isAcked,
    health,
    engine,
    breakers,
    hasCron,
    schedules,
    dlqExhausted,
    channelIdByName,
    now,
  } = useAttentionItems()
  const { acknowledge, unacknowledge } = useIncidentAcks()

  const liveTraffic = useChannelTraffic(windowSec)
  const liveSubsystems = useSubsystemMetrics(windowSec)
  const metrics = useMetrics()
  // Pause holds the figures still to read them; every reader of /metrics
  // shares one poll (the sidebar's included), so pausing is a freeze of what
  // this page draws rather than of the scrape.
  const [frozen, setFrozen] = useState<Frozen | null>(null)
  const traffic = frozen?.traffic ?? liveTraffic
  const subsystems = frozen?.subsystems ?? liveSubsystems
  const [refreshing, setRefreshing] = useState(false)

  const { graph: systemGraph, channels: channelList, workflows: workflowList } = useEntityIndex()
  const { data: anyTrace } = useTraces(
    { limit: 1, sort_by: "created_at", sort_order: "desc" },
    { refetchInterval: 30_000 },
  )
  const { data: lastChanges } = useAuditLogs({ limit: 1 }, { refetchInterval: 30_000 })
  const { data: dlq } = useTraceDlq({ limit: 1 }, { refetchInterval: 30_000 })

  // Nothing live yet: the checklist leads, everything else waits below it.
  const firstRun =
    !!engine && !!channelList && !!workflowList && isFirstRun({ activeChannels: engine.channels.length })
  const firstRunState = {
    workflows: workflowList?.total ?? workflowList?.data.length ?? 0,
    activeWorkflows: engine?.active_workflows ?? 0,
    channels: channelList?.total ?? channelList?.data.length ?? 0,
    activeChannels: engine?.channels.length ?? 0,
    traces: anyTrace?.data.length ?? 0,
  }

  // ---- Domains ----
  const activeChannels = useMemo(() => {
    const rows = (channelList?.data ?? []).filter((c) => c.status === "active")
    if (rows.length > 0) return rows.map((c) => ({ name: c.name, tags: c.tags, cron: c.protocol === "cron" }))
    // The registry has not answered; the engine's own list names what it serves.
    return (engine?.channels ?? []).map((name) => ({ name, tags: [] as string[], cron: false }))
  }, [channelList?.data, engine?.channels])
  const domainIndex = useMemo(() => buildDomains(activeChannels), [activeChannels])
  const domainChannels = useMemo(
    () => new Map<string, DomainChannel>(activeChannels.map((c) => [c.name, { name: c.name, cron: c.cron }])),
    [activeChannels],
  )
  // On a large system every name shares a product prefix ("soma-"); a label
  // without it reads, and the full name is a hover away.
  const prefix = domainIndex.prefix
  const label = (name: string) => (prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name)

  const quarantined = useMemo(
    () =>
      new Set(
        (engine?.load_issues?.channels ?? health?.channels?.quarantined ?? []).map((q) => q.channel),
      ),
    [engine?.load_issues?.channels, health?.channels?.quarantined],
  )
  const { incidentChannels, recovering } = useMemo(() => {
    const open = new Set<string>()
    const rec = new Set<string>()
    for (const i of incidents) {
      for (const c of i.channels) (i.state === "open" ? open : rec).add(c.name)
    }
    return { incidentChannels: open, recovering: rec }
  }, [incidents])

  // ---- Per-channel table ----
  const live = traffic.state === "live"
  const basis = live ? `last ${formatSpan(traffic.spanSec)}` : "since the engine started"
  /**
   * Busiest channels in the window, anything with errors first. A straight
   * top-8 by volume once let the KPI strip report a 10% error rate above a
   * table where every visible row read 0.0% — the one failing channel sat at
   * rank 9. A summary table that hides the exception is worse than none.
   */
  const topChannels = traffic.channels
    .filter((c) => c.windowed > 0)
    .sort(
      (a, b) =>
        Number((a.errorPct ?? 0) <= 0) - Number((b.errorPct ?? 0) <= 0) ||
        b.windowed - a.windowed ||
        a.channel.localeCompare(b.channel),
    )
    .slice(0, TABLE_ROWS)
  const promotedErrors = topChannels.some((c) => (c.errorPct ?? 0) > 0)

  // Coverage, as a statistic rather than an alert: most channels that never
  // "served a request" are reached inside the engine, where the exporter
  // cannot see them at all.
  const coverage = useMemo(() => {
    if ((channelList?.data.length ?? 0) === 0 || !traffic.available) return null
    let serving = 0
    let internal = 0
    let idle = 0
    for (const n of systemGraph.nodes) {
      if (n.unresolved || n.status !== "active") continue
      if ((traffic.byChannel.get(n.id)?.total ?? 0) > 0) serving++
      else if (n.callers.length > 0) internal++
      else idle++
    }
    return { serving, internal, idle }
  }, [channelList?.data.length, systemGraph, traffic.available, traffic.byChannel])

  const workflowNames = new Map((workflowList?.data ?? []).map((w) => [w.workflow_id, w.name]))

  // ---- Schedules due soon ----
  const upcoming = (schedules ?? [])
    .map((s) => ({ ...s, at: serverTime(s.next_fire_at) }))
    .filter((s): s is typeof s & { at: number } => s.at != null && s.at - now <= UPCOMING_MS)
    .sort((a, b) => a.at - b.at)

  const resourceName = (type: string, id: string) => {
    if (type === "channel") {
      const c = channelList?.data.find((x) => x.channel_id === id)
      if (c) return c.name
    }
    if (type === "workflow") return workflowNames.get(id) ?? id
    return id.length > 24 ? `${id.slice(0, 8)}…` : id
  }

  const handleRefresh = async () => {
    // Spin until the refetches settle so the button reports its own work.
    setRefreshing(true)
    setFrozen(null)
    try {
      await Promise.all(
        ["metrics", "engine", "health", "traces", "connectors", "channels", "cron", "trace-dlq", "audit-logs"].map(
          (key) => queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
    } finally {
      setRefreshing(false)
    }
  }

  const metricsShown = traffic.state === "live" || traffic.state === "warming"
  const incidentsLoading = !health && !engine

  return (
    <div className="space-y-6">
      <PageHeader title="Operations" description="The signals, the incidents, and where to act">
        <MetricsStatePill
          state={traffic.state}
          lastUpdated={traffic.lastUpdated}
          now={now}
          paused={!!frozen}
          stale={!frozen && liveTraffic.isError && liveTraffic.available}
        />
        <Select
          value={String(windowSec)}
          onChange={(e) => {
            setFrozen(null)
            setView({ window: e.target.value === String(DEFAULT_TRAFFIC_WINDOW) ? "" : e.target.value })
          }}
          className="w-28"
          aria-label="Traffic window"
          title="Every windowed figure on this page covers this long"
        >
          {TRAFFIC_WINDOWS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFrozen(frozen ? null : { traffic: liveTraffic, subsystems: liveSubsystems })}
          disabled={!frozen && !metricsShown}
          aria-pressed={!!frozen}
          title={frozen ? "Resume live figures" : "Hold the figures still to read them"}
        >
          {frozen ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          {frozen ? "Resume" : "Pause"}
        </Button>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </PageHeader>

      {firstRun && <GettingStarted state={firstRunState} />}

      <InstanceStrip
        engine={engine}
        instances={subsystems.instances}
        gitHash={subsystems.build.gitHash}
        nodeId={breakers?.instance_id ?? null}
        lastChange={lastChanges?.data[0] ?? null}
        resourceName={resourceName}
        now={now}
      />

      <GoldenSignals traffic={traffic} subsystems={subsystems} windowLabel={windowLabel} label={label} />

      <div className="grid gap-4 lg:grid-cols-5">
        <IncidentsPanel
          className="lg:col-span-3"
          incidents={incidents}
          isAcked={isAcked}
          onAcknowledge={acknowledge}
          onUndo={unacknowledge}
          label={label}
          now={now}
          loading={incidentsLoading}
        />
        <DomainsGrid
          className="lg:col-span-2"
          index={domainIndex}
          channels={domainChannels}
          traffic={traffic.byChannel}
          state={traffic.state}
          quarantined={quarantined}
          incidentChannels={incidentChannels}
          recovering={recovering}
          loading={!channelList && !engine}
        />
      </div>

      <SubsystemsRow
        subsystems={subsystems}
        hasCron={hasCron}
        cronEnabled={engine?.capabilities?.cron}
        schedules={schedules}
        label={label}
        breakers={breakers}
        dlqDepth={dlq?.total ?? null}
        dlqExhausted={dlqExhausted}
        windowLabel={windowLabel}
        now={now}
      />

      {/* Below the fold: reference data, not alerts. */}
      {metricsShown && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col">
            <CardHeader className="flex h-[3.25rem] shrink-0 flex-row items-center justify-between pb-2">
              <CardTitle>Channels</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{basis}</span>
                <Button variant="ghost" size="sm" onClick={() => navigate("/channels")}>
                  View all
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              {topChannels.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No channel traffic {live ? `in the ${basis}` : basis}.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Channel</TableHead>
                        <TableHead className="text-right">Req / min</TableHead>
                        <TableHead className="text-right">Error %</TableHead>
                        <TableHead className="text-right">p95</TableHead>
                        <TableHead className="hidden w-24 sm:table-cell">Outcomes</TableHead>
                        <TableHead className="w-px" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topChannels.map((c) => {
                        const id = channelIdByName.get(c.channel)
                        const mapTo = `/system-map?select=${encodeURIComponent(c.channel)}`
                        const err = c.errorPct ?? 0
                        return (
                          <TableRow key={c.channel} onActivate={() => navigate(id ? `/channels/${id}` : mapTo)}>
                            <TableCell className="min-w-32 max-w-0 truncate font-medium" title={c.channel}>
                              {label(c.channel)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {c.ratePerMin == null ? "—" : Math.round(c.ratePerMin)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <span className={err > 0 ? "text-destructive" : "text-muted-foreground"}>
                                {err.toFixed(1)}%
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {formatDuration(c.p95Ms)}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell" title={`${c.windowed.toLocaleString()} requests`}>
                              <OutcomeBar traffic={c} />
                            </TableCell>
                            <TableCell className="pl-0">
                              <Link
                                to={mapTo}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                                aria-label={`Open ${c.channel} in the System Map`}
                                title="Open in the System Map"
                              >
                                <Network className="h-3.5 w-3.5" />
                              </Link>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                {promotedErrors ? "Channels with errors first, then by volume. " : ""}
                {coverage
                  ? `${coverage.serving} serving · ${coverage.internal} internal (reached only by channel_call, unmetered) · ${coverage.idle} idle since the engine started.`
                  : "Channels reached only by channel_call carry no series and are not listed."}
              </p>
            </CardContent>
          </Card>

          {/* Workflow cost: a whole run (`orion_workflow_duration_seconds`)
              minus its task bodies is the engine's own overhead. Cumulative:
              the subtraction across two histograms is noise at short windows. */}
          <Card>
            <CardHeader className="flex h-[3.25rem] flex-row items-center justify-between pb-2">
              <CardTitle>Workflow cost</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">since the engine started</span>
                <Button variant="ghost" size="sm" onClick={() => navigate("/workflows")}>
                  View all
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {metrics.workflows.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  No workflow runs recorded yet. A workflow skipped by its condition or rollout gate is
                  not measured.
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Workflow</TableHead>
                          <TableHead className="text-right">Runs</TableHead>
                          <TableHead className="text-right">Mean</TableHead>
                          <TableHead className="text-right">p95</TableHead>
                          <TableHead className="text-right">Engine</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {metrics.workflows.slice(0, TABLE_ROWS).map((w) => (
                          <TableRow
                            key={w.workflow}
                            onActivate={
                              workflowNames.has(w.workflow) ? () => navigate(`/workflows/${w.workflow}`) : undefined
                            }
                          >
                            <TableCell className="max-w-48 truncate font-medium" title={w.workflow}>
                              {workflowNames.get(w.workflow) ?? w.workflow}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {w.runs.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatDuration(w.meanMs)}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {formatDuration(w.p95Ms)}
                            </TableCell>
                            <TableCell
                              className="text-right tabular-nums text-muted-foreground"
                              title={
                                w.taskMs == null
                                  ? undefined
                                  : `${formatDuration(w.taskMs)} in ${w.taskCount} task${w.taskCount === 1 ? "" : "s"}, ${formatDuration(w.overheadMs)} in the engine`
                              }
                            >
                              {formatDuration(w.overheadMs)}
                              {w.overheadPct != null && (
                                <span className="ml-1 text-xs">({w.overheadPct.toFixed(0)}%)</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    <span className="font-medium">Engine</span> is the run minus its task bodies —
                    condition evaluation, group gating, loop bookkeeping and audit writes.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Due soon. A nightly job that fails never enters the DLQ and may leave
          no trace, so its place on the front page is here and in incidents. */}
      {hasCron && (
        <Card>
          <CardHeader className="flex h-[3.25rem] flex-row items-center justify-between pb-2">
            <CardTitle>Scheduled in the next 24 h</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/schedules")}>
              View all
            </Button>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {(schedules ?? []).length === 0 ? "No active cron channel." : "Nothing is due in the next 24 hours."}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {upcoming.slice(0, 8).map((s) => (
                  <Link
                    key={s.channel_id}
                    to={`/schedules?channel_id=${encodeURIComponent(s.channel_id)}`}
                    className="flex max-w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors outline-none hover:border-border-strong hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60"
                    title={`${s.channel_name} · ${s.schedule} ${s.timezone} · next ${formatDate(s.next_fire_at as string)}`}
                  >
                    <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{label(s.channel_name)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(s.at, now)}</span>
                    {s.last_status && (
                      <Badge
                        variant="outline"
                        className={cn("text-xs", occurrenceStatusBadgeClass(s.last_status))}
                        title="Last run"
                      >
                        {s.last_status}
                      </Badge>
                    )}
                    {s.pending > 0 && (
                      <span className="shrink-0 text-xs text-warning" title="Occurrences waiting for a worker">
                        {s.pending} pending
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
