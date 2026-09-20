import { describe, it, expect } from "vitest"
import type { Channel, ChannelConfig } from "@/api/types"
import {
  concurrencySlots,
  cronTransport,
  describeSchedule,
  isRetryable,
  lintCronExpression,
  lintSlots,
  slotUsage,
  stripCronRefusedConfig,
  CRON_REFUSED_CONFIG_KEYS,
} from "@/lib/cron"

const channel = (over: Partial<Channel>): Pick<Channel, "protocol" | "transport_config"> => ({
  protocol: "rest",
  transport_config: {},
  ...over,
})

describe("cron channels (Orion 1.6)", () => {
  it("reads the schedule only off a cron channel with one", () => {
    expect(cronTransport(undefined)).toBeNull()
    expect(cronTransport(channel({ protocol: "kafka", transport_config: { brokers: [] } }))).toBeNull()
    // The protocol says cron but the bag is not a schedule: a malformed row,
    // reported as none rather than as a schedule with no expression.
    expect(cronTransport(channel({ protocol: "cron", transport_config: {} }))).toBeNull()
    const tc = cronTransport(
      channel({
        protocol: "cron",
        transport_config: { schedule: "0 15 2 * * *", timezone: "Asia/Kolkata" },
      }),
    )
    expect(tc?.schedule).toBe("0 15 2 * * *")
    expect(describeSchedule(tc!)).toBe("0 15 2 * * * · Asia/Kolkata")
    expect(describeSchedule({ schedule: "0 * * * * *" })).toBe("0 * * * * * · UTC")
  })

  it("refuses five- and seven-field expressions the way the server does", () => {
    expect(lintCronExpression("0 15 2 * * *")).toBeNull()
    expect(lintCronExpression("  0   15 2 * *   * ")).toBeNull()
    // Five fields would silently mean something else entirely.
    expect(lintCronExpression("15 2 * * *")).toMatch(/Five fields/)
    expect(lintCronExpression("0 15 2 * * * 2027")).toMatch(/Seven fields/)
    expect(lintCronExpression("")).toMatch(/required/)
    expect(lintCronExpression("0 15")).toMatch(/2 fields/)
  })

  it("drops exactly the caller-shaped config a cron channel is refused", () => {
    const config: ChannelConfig = {
      auth: { mode: "api_key", keys: ["k"] },
      rate_limit: { requests_per_second: 5 },
      principal_rate_limit: { requests_per_second: 1, key_logic: { var: "auth.sub" } },
      backpressure: { max_concurrent_per_node: 2 },
      timeout_ms: 1000,
      origin_allow_list: ["*"],
      request: { body_mode: "payload" },
      response: { mode: "shaped" },
      validation_logic: { "!!": [{ var: "data" }] },
      cache: { enabled: true },
      deduplication: { header: "x" },
      tracing: { mode: "async" },
      oauth2_login: {
        authorize_url: "https://a",
        token_url: "https://t",
        client_id: "c",
        client_secret: "env://S",
        redirect_uri: "https://r",
        callback_path: "/cb",
        state_secret: "env://X",
      },
    }
    const kept = stripCronRefusedConfig(config)
    for (const key of CRON_REFUSED_CONFIG_KEYS) expect(kept[key]).toBeUndefined()
    expect(kept).toEqual({
      backpressure: { max_concurrent_per_node: 2 },
      timeout_ms: 1000,
      validation_logic: { "!!": [{ var: "data" }] },
      tracing: { mode: "async" },
    })
    // Pure: the input is untouched.
    expect(config.auth).toBeDefined()
  })

  it("knows which occurrences a retry is accepted for", () => {
    expect(isRetryable("failed")).toBe(true)
    expect(isRetryable("skipped_misfire")).toBe(true)
    expect(isRetryable("skipped_singleton")).toBe(true)
    // Re-running finished work is a trigger, not a retry.
    expect(isRetryable("completed")).toBe(false)
    expect(isRetryable("running")).toBe(false)
    expect(isRetryable(null)).toBe(false)
  })
})

/**
 * `concurrency.slots` (Orion 1.9): `forbid` admits up to N runs of a key,
 * where it admitted exactly one before. A `forbid` channel that never set it
 * still means one, which is what it always meant.
 */
describe("concurrency slots (Orion 1.9)", () => {
  it("reads a forbid channel's bound, defaulting to one", () => {
    expect(concurrencySlots({ concurrency: { policy: "forbid" } })).toBe(1)
    expect(concurrencySlots({ concurrency: { policy: "forbid", slots: 4 } })).toBe(4)
    // `allow` takes no lock at all, so it has no bound to report — not zero.
    expect(concurrencySlots({ concurrency: { policy: "allow", slots: 4 } })).toBeNull()
    expect(concurrencySlots({})).toBeNull()
    expect(concurrencySlots(undefined)).toBeNull()
  })

  it("bounds slots the way the server does", () => {
    expect(lintSlots(undefined)).toBeNull()
    expect(lintSlots(1)).toBeNull()
    expect(lintSlots(64)).toBeNull()
    expect(lintSlots(0)).toMatch(/1–64/)
    expect(lintSlots(65)).toMatch(/1–64/)
    expect(lintSlots(2.5)).toMatch(/whole number/)
  })

  it("reads a status row's lock, and tolerates holding more than the bound", () => {
    expect(slotUsage({ concurrency_policy: "allow" })).toBeNull()
    // A pre-1.9 server sends no policy: nothing to report, rather than a
    // fabricated "0/1".
    expect(slotUsage({})).toBeNull()
    expect(slotUsage({ concurrency_policy: "forbid", slots: 4, slots_held: 2 })).toEqual({
      held: 2,
      slots: 4,
      over: false,
    })
    // `slots_held` counts leases across every channel sharing the key, so it
    // can legitimately exceed this channel's own bound.
    expect(slotUsage({ concurrency_policy: "forbid", slots: 1, slots_held: 3 })).toEqual({
      held: 3,
      slots: 1,
      over: true,
    })
    // Under `forbid` an omitted bound is one, as the server reads it.
    expect(slotUsage({ concurrency_policy: "forbid" })).toEqual({
      held: 0,
      slots: 1,
      over: false,
    })
  })
})
