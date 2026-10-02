import { describe, expect, it } from "vitest"
import type { CronOccurrenceSummary, Trace } from "@/api/types"
import {
  RESOLVED_TTL_MS,
  buildIncidents,
  errorSignature,
  groupFailures,
  isAcked,
  needsAttention,
  parseAcks,
  pruneAcks,
  type RecoveryEvidence,
} from "@/lib/incidents"

// The admin plane writes zoneless UTC instants.
const T0 = Date.parse("2026-10-02T11:13:00Z")
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19)
const MIN = 60_000

let seq = 0
function trace(channel: string, at: number, error: string | null, extra: Partial<Trace> = {}): Trace {
  seq++
  return {
    id: `t-${seq}`,
    channel,
    channel_id: `id-${channel}`,
    status: "failed",
    mode: "cron",
    error_message: error,
    duration_ms: 12,
    created_at: iso(at),
    started_at: iso(at),
    completed_at: iso(at),
    updated_at: iso(at),
    ...extra,
  }
}

const redis = (task: string, tail: string) =>
  `FUNCTION_ERROR: Task ${task} error: Function execution error: Redis ${tail}`

/** QA, 2026-10-02: one Redis outage at boot, four failures on three cron channels. */
const QA_TRACES: Trace[] = [
  trace("soma-clock-count", T0, redis("probe", "MGET failed for 2 keys")),
  trace("soma-clock-pair", T0 + 1_000, redis("pair", "SETEX failed for key 'soma:clock:pair:lock'")),
  trace("soma-clock-reap", T0 + 2_000, redis("reap", "MGET failed for 3 keys")),
  trace("soma-clock-reap", T0 + 3_000, redis("sweep", "INCRBY failed: connection reset by peer")),
]

const noEvidence: RecoveryEvidence = {
  window: null,
  lastCompletedTrace: new Map(),
  lastCompletedRun: new Map(),
}

describe("errorSignature", () => {
  it("normalises the task, the command word, numbers and quoted keys", () => {
    const a = errorSignature(redis("probe", "MGET failed for 2 keys"))
    const b = errorSignature(redis("pair", "SETEX failed for key 'soma:clock:pair:lock'"))
    expect(a.code).toBe("FUNCTION_ERROR")
    expect(a.phrase).toBe("Task {} error · Function execution error")
    expect(a.head).toBe("Redis {A} failed")
    expect(a.tokens).toEqual(["MGET"])
    expect(b.tokens).toEqual(["SETEX"])
    expect(a.signature).toBe(b.signature)
  })

  it("keeps unrelated failures apart", () => {
    const redisSig = errorSignature(redis("probe", "MGET failed for 2 keys")).signature
    const timeout = errorSignature("TIMEOUT_ERROR: Task probe error: timeout after 30000ms").signature
    const http = errorSignature("IO_ERROR: HTTP POST https://peer/api/x failed with status 503").signature
    expect(new Set([redisSig, timeout, http]).size).toBe(3)
  })

  it("folds ids and uuids", () => {
    const a = errorSignature("row 7f3c2a10-1b2c-4d5e-8f90-0a1b2c3d4e5f not found")
    const b = errorSignature("row 0a1b2c3d-1b2c-4d5e-8f90-7f3c2a101234 not found")
    expect(a.signature).toBe(b.signature)
  })

  it("names an empty error", () => {
    expect(errorSignature(null).signature).toBe("∅")
  })
})

describe("groupFailures — the QA Redis outage", () => {
  const now = T0 + 39 * MIN
  const groups = groupFailures({ traces: QA_TRACES, now })

  it("is one group of four failures on three channels", () => {
    expect(groups).toHaveLength(1)
    const [g] = groups
    expect(g.title).toBe("Redis MGET/SETEX/INCRBY failed")
    expect(g.failures).toBe(4)
    expect(g.channels.map((c) => [c.name, c.failures])).toEqual([
      ["soma-clock-reap", 2],
      ["soma-clock-count", 1],
      ["soma-clock-pair", 1],
    ])
    expect(g.first).toBe(T0)
    expect(g.last).toBe(T0 + 3_000)
    expect(g.code).toBe("FUNCTION_ERROR")
  })

  it("drops failures older than the lookback", () => {
    expect(groupFailures({ traces: QA_TRACES, now: T0 + 25 * 60 * MIN })).toHaveLength(0)
  })

  it("counts a failed occurrence and its cron trace once", () => {
    const occ: CronOccurrenceSummary = {
      id: "occ-1",
      channel_id: "id-soma-clock-count",
      channel_name: "soma-clock-count",
      trigger: "cron",
      scheduled_for: iso(T0),
      status: "failed",
      attempt: 1,
      started_at: iso(T0),
      completed_at: iso(T0 + 500),
      created_at: iso(T0),
    }
    const skipped: CronOccurrenceSummary = { ...occ, id: "occ-2", status: "skipped_misfire", started_at: null }
    const out = groupFailures({ traces: QA_TRACES, occurrences: [occ, skipped], now })
    const redisGroup = out.find((g) => g.title.startsWith("Redis"))
    expect(redisGroup?.failures).toBe(4)
    expect(redisGroup?.latestOccurrenceId).toBe("occ-1")
    const misfire = out.find((g) => g.occurrenceStatus === "skipped_misfire")
    expect(misfire?.title).toBe("Scheduled runs skipped — misfire")
  })
})

describe("buildIncidents — resolution", () => {
  const groups = groupFailures({ traces: QA_TRACES, now: T0 + 39 * MIN })

  it("stays open with no evidence of a later success", () => {
    const [inc] = buildIncidents({ now: T0 + 39 * MIN, groups, evidence: noEvidence, live: {} })
    expect(inc.state).toBe("open")
    expect(inc.kind).toBe("failures")
    expect(inc.links.map((l) => l.label)).toEqual(["Traces", "Schedules", "Map"])
  })

  it("resolves once every channel has a newer success", () => {
    const now = T0 + 39 * MIN
    const evidence: RecoveryEvidence = {
      // Clean traffic in a window that began after the outage…
      window: {
        start: now - 5 * MIN,
        label: "5 min",
        byChannel: new Map([
          ["soma-clock-count", { ok: 120, failed: 0 }],
          ["soma-clock-pair", { ok: 118, failed: 0 }],
        ]),
      },
      // …and a newer completed trace for the third.
      lastCompletedTrace: new Map([["soma-clock-reap", T0 + 60_000]]),
      lastCompletedRun: new Map(),
    }
    const [inc] = buildIncidents({ now, groups, evidence, live: {} })
    expect(inc.state).toBe("resolved")
    expect(inc.closesAt).toBe(T0 + 3_000 + RESOLVED_TTL_MS)
    expect(inc.recoveredBecause).toMatch(/All 3 channels have succeeded since/)
    expect(needsAttention([inc], {})).toHaveLength(0)
  })

  it("does not resolve while one channel has no proof", () => {
    const evidence: RecoveryEvidence = {
      ...noEvidence,
      lastCompletedTrace: new Map([
        ["soma-clock-count", T0 + MIN],
        ["soma-clock-pair", T0 + MIN],
      ]),
    }
    const [inc] = buildIncidents({ now: T0 + 10 * MIN, groups, evidence, live: {} })
    expect(inc.state).toBe("open")
  })

  it("a completed scheduled run is proof for a cron channel", () => {
    const after = T0 + MIN
    const evidence: RecoveryEvidence = {
      ...noEvidence,
      lastCompletedRun: new Map(
        ["soma-clock-count", "soma-clock-pair", "soma-clock-reap"].map((c) => [c, after] as [string, number]),
      ),
    }
    const [inc] = buildIncidents({ now: T0 + 10 * MIN, groups, evidence, live: {} })
    expect(inc.state).toBe("resolved")
  })

  it("failures inside a window that began after the last failure keep it open", () => {
    const now = T0 + 39 * MIN
    const evidence: RecoveryEvidence = {
      window: {
        start: now - 5 * MIN,
        label: "5 min",
        byChannel: new Map([["soma-clock-count", { ok: 10, failed: 3 }]]),
      },
      lastCompletedTrace: new Map(
        ["soma-clock-count", "soma-clock-pair", "soma-clock-reap"].map((c) => [c, now - MIN] as [string, number]),
      ),
      lastCompletedRun: new Map(),
    }
    const [inc] = buildIncidents({ now, groups, evidence, live: {} })
    expect(inc.state).toBe("open")
    expect(inc.severity).toBe(2)
  })

  it("drops a resolved incident an hour after its last failure", () => {
    const evidence: RecoveryEvidence = {
      ...noEvidence,
      lastCompletedTrace: new Map(
        ["soma-clock-count", "soma-clock-pair", "soma-clock-reap"].map((c) => [c, T0 + MIN] as [string, number]),
      ),
    }
    const now = T0 + 3_000 + RESOLVED_TTL_MS + 1
    const late = groupFailures({ traces: QA_TRACES, now })
    expect(buildIncidents({ now, groups: late, evidence, live: {} })).toHaveLength(0)
  })

  it("folds a failing channel into its failure group, and orders by severity", () => {
    const now = T0 + 39 * MIN
    const out = buildIncidents({
      now,
      groups,
      evidence: noEvidence,
      live: {
        traffic: {
          label: "5 min",
          channels: [
            { channel: "soma-clock-pair", ok: 50, failed: 5, errorPct: 9.1 },
            { channel: "soma-user-login", ok: 90, failed: 10, errorPct: 10 },
          ],
        },
        quarantined: [{ channel: "soma-gate-start", channel_id: "c-1", reason: "unresolved env://X" }],
        breakers: [
          { key: "soma-a:cache", channel: "soma-a", connector: "cache", state: "open" },
          { key: "soma-b:cache", channel: "soma-b", connector: "cache", state: "open" },
        ],
        dlqExhausted: 2,
      },
    })
    expect(out.map((i) => i.key)).toEqual([
      "quarantine:soma-gate-start",
      // Severity 2 both: a live signal is "now", so it leads the older group.
      "failing:soma-user-login",
      expect.stringMatching(/^fail:/),
      "dlq:exhausted",
      "breaker:cache",
    ])
    expect(out[0].to).toBe("/channels/c-1")
    expect(out[2].severity).toBe(2)
    expect(out[4].title).toBe("Circuit breaker open: cache")
  })
})

describe("acknowledgement", () => {
  const now = T0 + 39 * MIN
  const [inc] = buildIncidents({
    now,
    groups: groupFailures({ traces: QA_TRACES, now }),
    evidence: noEvidence,
    live: { dlqExhausted: 1 },
  })

  it("an ack after the last failure hides it from the count", () => {
    const acks = { [inc.key]: now }
    expect(isAcked(inc, acks)).toBe(true)
    expect(needsAttention([inc], acks)).toHaveLength(0)
  })

  it("a failure after the ack re-opens it", () => {
    const acks = { [inc.key]: T0 + 1_000 }
    expect(isAcked(inc, acks)).toBe(false)
  })

  it("a live signal's ack holds while the signal does", () => {
    expect(isAcked({ key: "dlq:exhausted", lastSeen: null }, { "dlq:exhausted": T0 })).toBe(true)
  })

  it("parses defensively and forgets old acks", () => {
    expect(parseAcks("not json")).toEqual({})
    expect(parseAcks('{"a": 1, "b": "x"}')).toEqual({ a: 1 })
    expect(pruneAcks({ old: now - 8 * 24 * 60 * MIN, fresh: now }, now)).toEqual({ fresh: now })
  })
})
