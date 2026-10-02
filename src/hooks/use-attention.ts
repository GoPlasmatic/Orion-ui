import { useCallback, useMemo, useSyncExternalStore } from "react"
import { useQueries } from "@tanstack/react-query"
import { tracesApi } from "@/api/traces"
import type { ListTracesParams } from "@/api/types"
import { useHealth } from "@/hooks/use-health"
import { useEngineStatus } from "@/hooks/use-engine"
import { useCircuitBreakers, useConnectors } from "@/hooks/use-connectors"
import { useChannels } from "@/hooks/use-channels"
import { useTraces } from "@/hooks/use-traces"
import { useTraceDlq } from "@/hooks/use-trace-dlq"
import { useCronOccurrences, useCronStatus } from "@/hooks/use-cron"
import { DEFAULT_TRAFFIC_WINDOW, useChannelTraffic } from "@/hooks/use-metrics"
import { useNow } from "@/lib/use-now"
import { isComponentFault } from "@/lib/status"
import { openBreakers } from "@/lib/breakers"
import { REGISTRY_LIMIT } from "@/lib/use-pagination"
import { formatSpan, serverTime } from "@/lib/utils"
import { readStorageJson, writeStorageJson } from "@/lib/storage"
import {
  ACK_STORAGE_KEY,
  FAILURE_LOOKBACK_MS,
  buildIncidents,
  groupFailures,
  isAcked,
  needsAttention,
  pruneAcks,
  sanitizeAcks,
  type AckMap,
  type Incident,
  type RecoveryEvidence,
} from "@/lib/incidents"

/**
 * "Needs attention", as incidents (`lib/incidents.ts`): one list the dashboard
 * renders and the sidebar counts — open and not acknowledged, never resolved.
 */

export interface AttentionOptions {
  /** The sidebar's use: slower polls. A shared key polls at the fastest interval asked for. */
  background?: boolean
}

/** Incidents read a fixed window, not the page's, so the sidebar and the dashboard agree. */
export const INCIDENT_WINDOW = DEFAULT_TRAFFIC_WINDOW
/** Failed traces read per poll — enough to group an outage, not every failure ever. */
const FAILED_TRACE_PAGE = 50
/** Occurrences read per status. */
const OCCURRENCE_PAGE = 20
/** Channels whose newest completed trace is fetched as recovery evidence. */
const EVIDENCE_CHANNELS = 20
const SKIP_STATUSES = ["skipped_misfire", "skipped_singleton"] as const

// ---------------------------------------------------------------------------
// Acknowledgement, per browser
// ---------------------------------------------------------------------------

/** One in-memory copy, written through to storage, so every reader sees an ack at once (and private mode keeps it for the session). */
let ackMemory: AckMap | null = null
const ackListeners = new Set<() => void>()

const loadAcks = () => sanitizeAcks(readStorageJson<unknown>(ACK_STORAGE_KEY, {}))

function readAcks(): AckMap {
  if (ackMemory === null) ackMemory = pruneAcks(loadAcks(), Date.now())
  return ackMemory
}

function writeAcks(next: AckMap) {
  ackMemory = next
  writeStorageJson(ACK_STORAGE_KEY, next)
  for (const l of ackListeners) l()
}

function subscribeAcks(listener: () => void) {
  ackListeners.add(listener)
  // Another tab acknowledged something.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== ACK_STORAGE_KEY) return
    ackMemory = loadAcks()
    listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    ackListeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function useIncidentAcks() {
  const acks = useSyncExternalStore(subscribeAcks, readAcks, readAcks)
  const acknowledge = useCallback((key: string) => {
    writeAcks(pruneAcks({ ...readAcks(), [key]: Date.now() }, Date.now()))
  }, [])
  const unacknowledge = useCallback((key: string) => {
    const next = { ...readAcks() }
    delete next[key]
    writeAcks(next)
  }, [])
  return { acks, acknowledge, unacknowledge }
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export function useAttentionItems({ background = false }: AttentionOptions = {}) {
  const poll = background ? 60_000 : 15_000
  const slowPoll = background ? 60_000 : 30_000
  const now = useNow(background ? 60_000 : 10_000)
  const { data: health } = useHealth()
  const { data: engine } = useEngineStatus()
  const { data: breakers } = useCircuitBreakers({ refetchInterval: poll })
  const traffic = useChannelTraffic(INCIDENT_WINDOW)
  const { data: channelList } = useChannels({ limit: REGISTRY_LIMIT })
  const { data: connectorList } = useConnectors({ limit: REGISTRY_LIMIT })
  const { data: failedTraces } = useTraces(
    { limit: FAILED_TRACE_PAGE, status: "failed", sort_by: "created_at", sort_order: "desc" },
    { refetchInterval: poll },
  )
  const { data: dlqExhausted } = useTraceDlq({ limit: 1, exhausted: true }, { refetchInterval: slowPoll })
  // A pre-1.6 server has no scheduler; the component key is how it says so.
  const hasCron = health?.components?.cron !== undefined
  const { data: schedules } = useCronStatus({ enabled: hasCron, refetchInterval: slowPoll })
  // Hour-aligned, so the query key does not change every render.
  const since = new Date(Math.floor(now / 3_600_000) * 3_600_000 - FAILURE_LOOKBACK_MS).toISOString()
  const { data: failedOcc } = useCronOccurrences(
    { status: "failed", limit: OCCURRENCE_PAGE, since },
    { enabled: hasCron, refetchInterval: slowPoll },
  )
  const { data: misfireOcc } = useCronOccurrences(
    { status: SKIP_STATUSES[0], limit: OCCURRENCE_PAGE, since },
    { enabled: hasCron, refetchInterval: slowPoll },
  )
  const { data: singletonOcc } = useCronOccurrences(
    { status: SKIP_STATUSES[1], limit: OCCURRENCE_PAGE, since },
    { enabled: hasCron, refetchInterval: slowPoll },
  )

  const channelIdByName = useMemo(
    () => new Map((channelList?.data ?? []).map((c) => [c.name, c.channel_id])),
    [channelList?.data],
  )
  const connectorIdByName = useMemo(
    () => new Map((connectorList?.data ?? []).map((c) => [c.name, c.id])),
    [connectorList?.data],
  )

  const groups = useMemo(
    () =>
      groupFailures({
        traces: failedTraces?.data ?? [],
        occurrences: [
          ...(failedOcc?.data ?? []),
          ...(misfireOcc?.data ?? []),
          ...(singletonOcc?.data ?? []),
        ],
        now,
      }),
    [failedTraces?.data, failedOcc?.data, misfireOcc?.data, singletonOcc?.data, now],
  )

  // Recovery evidence: each failing channel's newest completed trace, under
  // the `useTraces` key shape so invalidating ["traces"] refreshes it.
  const evidenceChannels = useMemo(
    () => [...new Set(groups.flatMap((g) => g.channels.map((c) => c.name)))].slice(0, EVIDENCE_CHANNELS),
    [groups],
  )
  const completed = useQueries({
    queries: evidenceChannels.map((channel) => {
      const params: ListTracesParams = {
        channel,
        status: "completed",
        limit: 1,
        sort_by: "created_at",
        sort_order: "desc",
      }
      return {
        queryKey: ["traces", params],
        queryFn: () => tracesApi.list(params),
        refetchInterval: slowPoll,
      }
    }),
  })
  const completedAt = completed.map((q) => q.data?.data[0]?.created_at ?? null)
  const completedKey = completedAt.join("|")
  const lastCompletedTrace = useMemo(() => {
    const out = new Map<string, number>()
    const stamps = completedKey.split("|")
    evidenceChannels.forEach((channel, i) => {
      const at = serverTime(stamps[i] || null)
      if (at != null) out.set(channel, at)
    })
    return out
  }, [evidenceChannels, completedKey])

  const { acks } = useIncidentAcks()

  const incidents = useMemo<Incident[]>(() => {
    const lastCompletedRun = new Map<string, number>()
    for (const s of schedules ?? []) {
      if (s.last_status !== "completed") continue
      const at = serverTime(s.last_completed_at) ?? serverTime(s.last_scheduled_for)
      if (at != null) lastCompletedRun.set(s.channel_name, at)
    }
    const live = traffic.hasRate && traffic.lastUpdated != null
    const evidence: RecoveryEvidence = {
      window: live
        ? {
            start: (traffic.lastUpdated as number) - traffic.spanSec * 1000,
            label: formatSpan(traffic.spanSec),
            byChannel: traffic.byChannel,
          }
        : null,
      lastCompletedTrace,
      lastCompletedRun,
    }

    // Prefer the engine's load issues (admin plane); /health's stand in before 1.9.
    const issues = engine?.load_issues
    const quarantined = issues?.channels ?? health?.channels?.quarantined ?? []
    const failedConnectors = issues?.connectors ?? health?.connectors?.failed_to_load ?? []
    const failedPlugins = issues?.plugins ?? health?.plugins?.failed_to_load ?? []
    const failedModels = issues?.models ?? health?.models?.failed_to_load ?? []
    const tasks = health?.background_tasks ?? []
    // A component already itemised below is not news twice.
    const itemised: Record<string, boolean> = {
      channels: quarantined.length > 0,
      connectors: failedConnectors.length > 0,
      plugins: failedPlugins.length > 0,
      models: failedModels.length > 0,
      background_tasks: tasks.some((t) => t.restarts > 0 || t.state !== "running"),
    }
    const components = Object.entries(health?.components ?? {}).filter(
      ([name, state]) => isComponentFault(state) && !itemised[name],
    )
    const pending = (schedules ?? []).reduce((n, s) => n + (s.pending ?? 0), 0)

    return buildIncidents({
      now,
      groups,
      evidence,
      channelIdByName,
      connectorIdByName,
      live: {
        quarantined,
        connectors: failedConnectors,
        plugins: failedPlugins,
        models: failedModels,
        traffic: live
          ? {
              label: formatSpan(traffic.spanSec),
              channels: traffic.channels.map((c) => ({
                channel: c.channel,
                ok: c.ok,
                failed: c.failed,
                errorPct: c.errorPct,
              })),
            }
          : null,
        components,
        tasks,
        breakers: openBreakers(breakers),
        dlqExhausted: dlqExhausted?.total ?? 0,
        cronBacklog: hasCron
          ? { pending, oldestSec: health?.cron?.oldest_pending_age_secs ?? null }
          : null,
      },
    })
  }, [
    now,
    groups,
    traffic,
    lastCompletedTrace,
    schedules,
    engine?.load_issues,
    health,
    breakers,
    dlqExhausted?.total,
    hasCron,
    channelIdByName,
    connectorIdByName,
  ])

  const open = useMemo(() => needsAttention(incidents, acks), [incidents, acks])

  return {
    incidents,
    /** Open and not acknowledged — the sidebar's count. */
    open,
    acks,
    isAcked: (i: Incident) => isAcked(i, acks),
    health,
    engine,
    breakers,
    hasCron,
    schedules,
    dlqExhausted: dlqExhausted?.total ?? null,
    channelIdByName,
    now,
  }
}

/** The live counts the sidebar draws beside its items. */
export function useNavCounts() {
  const { open, breakers, schedules } = useAttentionItems({ background: true })
  const { data: exhausted } = useTraceDlq({ limit: 1, exhausted: true }, { refetchInterval: 60_000 })
  const pending = (schedules ?? []).reduce((sum, s) => sum + (s.pending ?? 0), 0)
  return {
    alerts: open.length,
    dlq: exhausted?.total ?? 0,
    breakers: openBreakers(breakers).length,
    schedules: pending,
  }
}
