import { describe, expect, it } from "vitest"
import type { CronScheduleStatus } from "@/api/types"
import type { SubsystemMetrics } from "@/hooks/use-ops-metrics"
import {
  breakerTile,
  cacheTile,
  cronTile,
  dbPoolTile,
  dlqTile,
  noFigure,
  rateLimitTile,
  tracePipelineTile,
} from "@/components/operations/subsystem-tiles"

const NOW = Date.parse("2026-10-02T12:00:00Z")
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19)

const schedule = (over: Partial<CronScheduleStatus>): CronScheduleStatus => ({
  channel_id: "c",
  channel_name: "soma-clock-pair",
  schedule: "0 * * * * *",
  timezone: "UTC",
  next_fire_at: iso(NOW + 53_000),
  last_status: "completed",
  pending: 0,
  ...over,
})

describe("cronTile", () => {
  it("is off without a scheduler", () => {
    expect(cronTile({ hasCron: false, cronEnabled: undefined, schedules: [], oldestPendingSec: null, now: NOW }).value).toBe("off")
    expect(cronTile({ hasCron: true, cronEnabled: false, schedules: [], oldestPendingSec: null, now: NOW }).tone).toBe("muted")
  })

  it("names the next run and counts on-time schedules", () => {
    const t = cronTile({
      hasCron: true,
      cronEnabled: true,
      schedules: [schedule({}), schedule({ channel_name: "soma-clock-reap", next_fire_at: iso(NOW + 120_000) })],
      oldestPendingSec: null,
      now: NOW,
      label: (n) => n.replace("soma-", ""),
    })
    expect(t.value).toBe("2 on time · 0 queued")
    expect(t.sub).toBe("next: clock-pair in 53s")
    expect(t.tone).toBe("plain")
  })

  it("agrees with the incident list on what a backlog is", () => {
    const queued = cronTile({
      hasCron: true,
      cronEnabled: true,
      schedules: [schedule({ pending: 2 })],
      oldestPendingSec: 10,
      now: NOW,
    })
    expect(queued.value).toBe("1 on time · 2 queued")
    expect(queued.tone).toBe("plain")
    const backlog = cronTile({
      hasCron: true,
      cronEnabled: true,
      schedules: [schedule({ pending: 2 })],
      oldestPendingSec: 600,
      now: NOW,
    })
    expect(backlog.value).toBe("1 on time · 2 backlog")
    expect(backlog.tone).toBe("warning")
  })

  it("warns when a last run failed or was skipped", () => {
    const t = cronTile({
      hasCron: true,
      cronEnabled: true,
      schedules: [schedule({ last_status: "skipped_misfire" }), schedule({ channel_name: "b" })],
      oldestPendingSec: null,
      now: NOW,
    })
    expect(t.value).toBe("1 on time · 0 queued")
    expect(t.tone).toBe("warning")
    expect(t.title).toContain("soma-clock-pair")
  })
})

describe("metric-backed tiles", () => {
  const cache: SubsystemMetrics["cache"] = {
    seen: true,
    hits: 71,
    misses: 29,
    coalesced: 3,
    hitPct: 71,
    invalidations: 0,
    byChannel: new Map([
      ["a", { hits: 1, misses: 1 }],
      ["b", { hits: 1, misses: 0 }],
    ]),
  }

  it("say why there is no figure, in the shared words", () => {
    expect(noFigure("loading")).toEqual({ value: "—", sub: "loading metrics", tone: "muted", title: undefined })
    expect(cacheTile(cache, "off", false).sub).toBe("metrics off")
    expect(rateLimitTile({ rejections: null, keyUnavailable: null, byScope: new Map() }, "warming", "5 min").sub).toBe(
      "rates after the next sample",
    )
  })

  it("cache: hit share, or that nothing is cached", () => {
    expect(cacheTile(cache, "live", true)).toMatchObject({ value: "hit 71%", sub: "2 channels · 3 coalesced" })
    expect(cacheTile({ ...cache, seen: false }, "live", true).value).toBe("no cached channels")
  })

  it("rate limits: rejections and the busiest scope", () => {
    const t = rateLimitTile({ rejections: 4, keyUnavailable: 0, byScope: new Map([["ip", 4]]) }, "live", "5 min")
    expect(t).toMatchObject({ value: "4 rejected", sub: "mostly ip · last 5 min", tone: "warning" })
  })

  it("trace pipeline: drops by policy are not loss", () => {
    const t = tracePipelineTile(
      {
        queueDepth: 0,
        queueBytes: 0,
        workersActive: 4,
        workersTotal: 4,
        persistenceQueueDepth: 0,
        rejected: 0,
        dropped: new Map([
          ["sampled_out", 120],
          ["queue_full", 2],
        ]),
        dlqDepth: 0,
      },
      "live",
      "5 min",
    )
    expect(t).toMatchObject({ value: "queue 0 · 2 dropped", sub: "workers 4/4", tone: "warning" })
  })

  it("db pool: busy over size", () => {
    expect(dbPoolTile({ size: 6, idle: 6, busy: 0 }, "live")).toMatchObject({ value: "0/6 busy", tone: "plain" })
    expect(dbPoolTile({ size: 6, idle: 0, busy: 6 }, "live").tone).toBe("warning")
  })
})

describe("non-metric tiles", () => {
  it("breakers: disabled, closed or open", () => {
    expect(breakerTile(undefined, null, false).value).toBe("…")
    expect(breakerTile({ enabled: false, scope: "node", instance_id: "n", breakers: {} }, null, false).value).toBe("disabled")
    const open = breakerTile(
      { enabled: true, scope: "node", instance_id: "n", breakers: { "a:cache": "open", "b:cache": "closed" } },
      2,
      true,
    )
    expect(open).toMatchObject({ value: "1 open", sub: "2 tracked · 2 trips · this node", tone: "warning" })
  })

  it("dlq: empty, waiting, exhausted", () => {
    expect(dlqTile(0, 0)).toMatchObject({ value: "empty", tone: "plain" })
    expect(dlqTile(3, 1)).toMatchObject({ value: "3 waiting", sub: "1 exhausted", tone: "destructive" })
    expect(dlqTile(null, null).value).toBe("…")
  })
})
