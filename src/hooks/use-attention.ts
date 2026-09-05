import { useMemo } from "react"
import { useHealth } from "@/hooks/use-health"
import { useCircuitBreakers, useConnectors } from "@/hooks/use-connectors"
import { useChannels } from "@/hooks/use-channels"
import { useTraces } from "@/hooks/use-traces"
import { useTraceDlq } from "@/hooks/use-trace-dlq"
import { useCronOccurrences, useCronStatus } from "@/hooks/use-cron"
import {
  DEFAULT_TRAFFIC_WINDOW,
  trafficWindowLabel,
  useChannelTraffic,
  useMetrics,
} from "@/hooks/use-metrics"
import { useNow } from "@/lib/use-now"
import { isComponentFault } from "@/lib/status"
import { componentRoute, hasComponentRoute } from "@/lib/health"
import { formatDate, formatRelative, serverTime } from "@/lib/utils"

/**
 * "Needs attention", as data: the one list the dashboard renders and the
 * sidebar counts. Only things a person should go and do something about, in
 * severity order, each with the page where the action is.
 */
export type AttentionKind =
  | "quarantine"
  | "connector"
  | "plugin"
  | "erroring"
  | "occurrence"
  | "component"
  | "task"
  | "breaker"
  | "trace"

export interface AttentionItem {
  key: string
  /** 0 is worst. Sorted on, so the list order is stable across polls. */
  severity: number
  tone: "destructive" | "warning"
  kind: AttentionKind
  label: string
  detail: string
  /** Where to act. */
  to: string
  /** The channel this is about, for a second "Map" action. */
  channel?: string
}

/** Failure share at which a channel is worth naming. */
const ERRORING_PCT = 1
/** A failed trace older than this is history, not an alert. */
const FAILED_TRACE_WINDOW_MS = 60 * 60 * 1000
/** A failed scheduled run is worth an alert for a day; the ledger keeps the rest. */
const FAILED_OCCURRENCE_WINDOW_MS = 24 * 60 * 60 * 1000

const pct = (v: number) => `${v.toFixed(v >= 10 ? 0 : 1)}%`

export function useAttentionItems(windowSec = DEFAULT_TRAFFIC_WINDOW) {
  const now = useNow(10_000)
  const { data: health } = useHealth()
  const { data: breakers } = useCircuitBreakers({ refetchInterval: 15_000 })
  const traffic = useChannelTraffic(windowSec)
  // Cumulative figures, for the fallback before a second sample exists and
  // for the "since start" context on a windowed alert. Same poll.
  const metrics = useMetrics()
  const { data: channelList } = useChannels({ limit: 1000 })
  const { data: connectorList } = useConnectors({ limit: 1000 })
  const { data: failedTraces } = useTraces(
    { limit: 5, status: "failed", sort_by: "created_at", sort_order: "desc" },
    { refetchInterval: 15_000 },
  )
  // A pre-1.6 server has no scheduler; the component key is how it says so.
  const hasCron = health?.components?.cron !== undefined
  // Hour-aligned, so the query key does not change every render.
  const since = new Date(
    Math.floor(now / 3_600_000) * 3_600_000 - FAILED_OCCURRENCE_WINDOW_MS,
  ).toISOString()
  const { data: failedOccurrences } = useCronOccurrences(
    { status: "failed", limit: 5, since },
    { enabled: hasCron, refetchInterval: 30_000 },
  )

  const channelIdByName = useMemo(
    () => new Map((channelList?.data ?? []).map((c) => [c.name, c.channel_id])),
    [channelList?.data],
  )
  const connectorIdByName = useMemo(
    () => new Map((connectorList?.data ?? []).map((c) => [c.name, c.id])),
    [connectorList?.data],
  )

  const windowLabel = trafficWindowLabel(windowSec)

  const items = useMemo<AttentionItem[]>(() => {
    const channelPath = (name: string) => {
      const id = channelIdByName.get(name)
      return id ? `/channels/${id}` : "/channels"
    }

    const quarantined = health?.channels?.quarantined ?? []
    const failedConnectors = health?.connectors?.failed_to_load ?? []
    const failedPlugins = health?.plugins?.failed_to_load ?? []
    const degraded = Object.entries(health?.components ?? {}).filter(([, state]) =>
      isComponentFault(state),
    )
    const tasks = (health?.background_tasks ?? []).filter(
      (t) => t.restarts > 0 || t.state !== "running",
    )
    const openBreakers = breakers?.enabled
      ? Object.entries(breakers.breakers ?? {}).filter(([, state]) => state !== "closed")
      : []

    /**
     * Channels failing *now*, from the window; before a second sample exists
     * the cumulative counters stand in, and the detail says so. Either way the
     * counters are the witness, not the trace table: a channel can answer 500
     * on every request and record no trace at all.
     */
    const cumulative = new Map(metrics.channels.map((c) => [c.channel, c]))
    const erroring = traffic.hasRate
      ? traffic.channels
          .filter((c) => c.failed > 0 && c.errorPct != null && c.errorPct >= ERRORING_PCT)
          .map((c) => {
            const cum = cumulative.get(c.channel)
            const sinceStart =
              cum && cum.errorPct > 0 ? ` · ${pct(cum.errorPct)} since the engine started` : ""
            return {
              channel: c.channel,
              share: c.errorPct ?? 0,
              detail: `${pct(c.errorPct ?? 0)} of ${(c.ok + c.failed).toLocaleString()} requests failed in the last ${windowLabel}${sinceStart}`,
            }
          })
      : metrics.channels
          .filter((c) => c.failed > 0 && c.errorPct >= ERRORING_PCT)
          .map((c) => ({
            channel: c.channel,
            share: c.errorPct,
            detail: `${pct(c.errorPct)} of processed requests failed since the engine started (${c.failed.toLocaleString()}) · a second sample will narrow this to the last ${windowLabel}`,
          }))
    erroring.sort((a, b) => b.share - a.share || a.channel.localeCompare(b.channel))

    const failed = (failedTraces?.data ?? []).filter((t) => {
      const at = serverTime(t.created_at)
      return at != null && now - at <= FAILED_TRACE_WINDOW_MS
    })

    const list: AttentionItem[] = [
      ...quarantined.map(({ channel, reason }) => ({
        key: `quarantine-${channel}`,
        severity: 0,
        tone: "destructive" as const,
        kind: "quarantine" as const,
        label: `Quarantined: ${channel}`,
        detail: reason || "Refused at load — the route is not being served",
        to: channelPath(channel),
        channel,
      })),
      ...failedConnectors.map((connector) => {
        const id = connectorIdByName.get(connector)
        return {
          key: `conn-${connector}`,
          severity: 1,
          tone: "destructive" as const,
          kind: "connector" as const,
          label: `Connector failed to load: ${connector}`,
          detail: "Every task using it is failing",
          to: id ? `/connectors/${id}?test=1` : "/connectors",
        }
      }),
      ...failedPlugins.map((issue) => ({
        key: `plugin-${issue.plugin}-${issue.version}`,
        severity: 1,
        tone: "destructive" as const,
        kind: "plugin" as const,
        label: `Plugin not loaded: ${issue.plugin} v${issue.version}`,
        detail: `${issue.stage}: ${issue.reason}`,
        to: `/plugins/${encodeURIComponent(issue.plugin)}`,
      })),
      ...erroring.map((c) => ({
        key: `err-${c.channel}`,
        severity: 2,
        tone: "destructive" as const,
        kind: "erroring" as const,
        label: `Erroring: ${c.channel}`,
        detail: c.detail,
        to: `/traces?channel=${encodeURIComponent(c.channel)}&status=failed`,
        channel: c.channel,
      })),
      ...(failedOccurrences?.data ?? []).map((o) => ({
        key: `occ-${o.id}`,
        severity: 3,
        tone: "destructive" as const,
        kind: "occurrence" as const,
        label: `Scheduled run failed: ${o.channel_name}`,
        detail: `due ${formatRelative(o.scheduled_for, now) ?? formatDate(o.scheduled_for)} · attempt ${o.attempt} · retry from the occurrence`,
        to: `/schedules/occurrences/${o.id}`,
      })),
      ...degraded.map(([component, state]) => ({
        key: `comp-${component}`,
        severity: 4,
        tone: "warning" as const,
        kind: "component" as const,
        label: `${component} is ${state}`,
        detail:
          component === "cron"
            ? "Declared schedules are not running — every liveness signal is green"
            : component === "engine_reload"
              ? "The last reload failed; this node serves the previous generation"
              : component === "config_propagation"
                ? "A change committed here has not reached the peers"
                : "Reported by /health",
        to: hasComponentRoute(component)
          ? componentRoute(component)
          : `/engine#component-${component}`,
      })),
      ...tasks.map((t) => ({
        key: `task-${t.name}`,
        severity: 5,
        tone: (t.state !== "running" && t.required ? "destructive" : "warning") as
          | "destructive"
          | "warning",
        kind: "task" as const,
        label:
          t.state === "running"
            ? `Background task restarted ${t.restarts}×: ${t.name}`
            : `Background task ${t.state}: ${t.name}`,
        detail:
          t.state === "running"
            ? "Up now, and has been failing"
            : t.required
              ? "A required task stopped for good — /readyz fails"
              : "Not required; the rest of the node keeps serving",
        to: "/engine#component-background_tasks",
      })),
      ...openBreakers.map(([key, state]) => ({
        key: `brk-${key}`,
        severity: 6,
        tone: "warning" as const,
        kind: "breaker" as const,
        label: `Circuit breaker ${state}`,
        detail: `${key} · this replica only`,
        to: `/circuit-breakers?key=${encodeURIComponent(key)}`,
      })),
      ...failed.map((t) => ({
        key: `fail-${t.id}`,
        severity: 7,
        tone: "destructive" as const,
        kind: "trace" as const,
        label: `Failed: ${t.channel}`,
        detail: [formatRelative(t.created_at, now), t.error_message ?? formatDate(t.created_at)]
          .filter(Boolean)
          .join(" · "),
        to: `/traces/${t.id}`,
        channel: t.channel,
      })),
    ]
    return list.sort((a, b) => a.severity - b.severity || a.label.localeCompare(b.label))
  }, [
    health,
    breakers,
    traffic,
    metrics.channels,
    failedTraces?.data,
    failedOccurrences?.data,
    channelIdByName,
    connectorIdByName,
    windowLabel,
    now,
  ])

  return { items, traffic, metrics, health, breakers, hasCron, channelIdByName, windowLabel, now }
}

/** The live counts the sidebar draws beside its items. */
export function useNavCounts() {
  const { items, breakers, hasCron } = useAttentionItems()
  const { data: exhausted } = useTraceDlq({ limit: 1, exhausted: true }, { refetchInterval: 30_000 })
  const { data: schedules } = useCronStatus({ enabled: hasCron })
  const openBreakers = breakers?.enabled
    ? Object.values(breakers.breakers ?? {}).filter((s) => s !== "closed").length
    : 0
  const pending = (schedules ?? []).reduce((sum, s) => sum + (s.pending ?? 0), 0)
  return {
    alerts: items.length,
    dlq: exhausted?.total ?? 0,
    breakers: openBreakers,
    schedules: pending,
  }
}
