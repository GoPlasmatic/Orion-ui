import { describe, expect, it } from "vitest"
import type { ChannelConfig, EntityStatus } from "@/api/types"
import { cacheNamespaces, hitRatio, lintNamespace, lintNamespaces } from "@/lib/cache-namespaces"

const ch = (
  channel_id: string,
  name: string,
  status: EntityStatus,
  config: ChannelConfig = {}
) => ({ channel_id, name, status, config })

describe("lintNamespace", () => {
  it("accepts the server's alphabet up to 64 characters", () => {
    expect(lintNamespace("catalog")).toBeNull()
    expect(lintNamespace("tenant:42.v2_items-x")).toBeNull()
    expect(lintNamespace("a".repeat(64))).toBeNull()
  })

  it("refuses empty, too long, upper case, spaces and slashes", () => {
    expect(lintNamespace("")).toMatch(/empty/)
    expect(lintNamespace("a".repeat(65))).toMatch(/65 characters/)
    expect(lintNamespace("Catalog")).toMatch(/lower-case/)
    expect(lintNamespace("two words")).not.toBeNull()
    expect(lintNamespace("a/b")).not.toBeNull()
  })

  it("lints the list: count bounds and every bad entry", () => {
    expect(lintNamespaces(undefined)).toEqual([])
    expect(lintNamespaces(["a", "b"])).toEqual([])
    expect(lintNamespaces([])).toHaveLength(1)
    const nine = Array.from({ length: 9 }, (_, i) => `ns${i}`)
    expect(lintNamespaces(nine)[0]).toMatch(/at most 8/)
    expect(lintNamespaces(["ok", "BAD"])).toHaveLength(1)
  })
})

describe("cacheNamespaces", () => {
  const channels = [
    ch("1", "orders-get", "active", {
      cache: { enabled: true, connector: "redis", namespaces: ["orders", "tenant:1"] },
    }),
    ch("2", "orders-list", "active", { cache: { enabled: true, namespaces: ["orders"] } }),
    ch("3", "orders-draft", "draft", {
      cache: { enabled: true, connector: "redis-b", namespaces: ["orders"] },
    }),
    ch("4", "catalog", "active", { cache: { enabled: false, namespaces: ["catalog"] } }),
    ch("5", "plain", "active", { cache: { enabled: true } }),
    ch("6", "no-cache", "active"),
  ]

  it("collects every declared namespace with the channels sharing it", () => {
    const rows = cacheNamespaces(channels)
    expect(rows.map((r) => r.namespace)).toEqual(["orders", "tenant:1", "catalog"])
    const orders = rows[0]
    expect(orders.channels.map((c) => c.name)).toEqual(["orders-get", "orders-list", "orders-draft"])
    expect(orders.live).toBe(2)
    expect(orders.connectors).toEqual(["redis", "redis-b"])
  })

  it("does not count a channel with its cache switched off as live", () => {
    const catalog = cacheNamespaces(channels).find((r) => r.namespace === "catalog")!
    expect(catalog.live).toBe(0)
    expect(catalog.channels[0].cacheEnabled).toBe(false)
  })

  it("counts a channel the registry returns twice once, at its most live version", () => {
    const rows = cacheNamespaces([
      ch("1", "a", "archived", { cache: { enabled: true, namespaces: ["x", "x"] } }),
      ch("1", "a", "active", { cache: { enabled: true, namespaces: ["x"] } }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].channels).toHaveLength(1)
    expect(rows[0].channels[0].status).toBe("active")
  })
})

describe("hitRatio", () => {
  it("sums hits and misses over the sharing channels", () => {
    const by = new Map([
      ["a", { hits: 30, misses: 10 }],
      ["b", { hits: 0, misses: 10 }],
    ])
    expect(hitRatio(["a", "b", "c"], by)).toEqual({ pct: 60, hits: 30, misses: 20 })
    expect(hitRatio(["c"], by).pct).toBeNull()
  })
})
