import { describe, expect, it } from "vitest"
import type { FunctionSchema } from "@/api/types"
import {
  functionIndex,
  isRetryRisk,
  isWrite,
  resolveDependsOn,
  stepEffect,
  takesConnector,
} from "@/lib/function-effects"

// The catalogue rows that matter here, as `GET admin/functions` serves them on 1.12.
const fn = (name: string, category: string, retry_safety: FunctionSchema["retry_safety"], extra: Partial<FunctionSchema> = {}): FunctionSchema => ({
  name,
  description: "",
  category,
  source: "orion",
  retry_safety,
  ...extra,
})
const CATALOGUE: FunctionSchema[] = [
  fn("db_read", "connector", { kind: "read" }),
  fn("db_write", "connector", { kind: "depends_on", input: "sql" }),
  fn("data_write", "connector", { kind: "depends_on", input: "op" }),
  fn("http_call", "connector", { kind: "depends_on", input: "method" }),
  fn("cache_incr", "connector", { kind: "unsafe_write" }),
  fn("cache_delete", "connector", { kind: "idempotent_write" }),
  fn("channel_call", "control", { kind: "depends_on", input: "channel" }),
  fn("model_infer", "compute", { kind: "pure" }),
  fn("validation", "utility", { kind: "pure" }, { aliases: ["validate"] }),
  fn("tb.pairing.pair", "plugin", { kind: "pure" }, { source: "plugin", plugin: { id: "tb.pairing", version: 2, digest: "sha256:x", abi: "1.0.0" } }),
]
const index = functionIndex(CATALOGUE)
const task = (name: string, input: Record<string, unknown> = {}) => ({ function: { name, input } })

describe("stepEffect", () => {
  it("names the connector and the verb", () => {
    const e = stepEffect(task("db_read", { connector: "soma-db" }), index)
    expect(e).toMatchObject({ op: "read", resource: { kind: "connector", name: "soma-db" }, retry: "read" })
  })

  it("agrees with itself on cache_delete and cache_incr", () => {
    expect(stepEffect(task("cache_delete", { connector: "c" }), index)).toMatchObject({ op: "delete", retry: "idempotent_write" })
    expect(stepEffect(task("cache_incr", { connector: "soma-cache" }), index)).toMatchObject({ op: "incr", retry: "unsafe_write" })
  })

  it("reads a GET as a read, so a retry guard does not call it a write", () => {
    const get = stepEffect(task("http_call", { connector: "api", method: "GET" }), index)
    expect(get).toMatchObject({ op: "get", retry: "read" })
    expect(isRetryRisk(get)).toBe(false)
    expect(isWrite(get)).toBe(false)
    expect(isRetryRisk(stepEffect(task("http_call", { connector: "api", method: "POST" }), index))).toBe(true)
  })

  it("leaves a computed deciding input unknown, naming the input", () => {
    const e = stepEffect(task("data_write", { connector: "db", op: { var: "op" } }), index)
    expect(e).toMatchObject({ retry: "unknown", decidedBy: "op" })
    expect(isRetryRisk(e)).toBe(true)
  })

  it("takes plugins from the catalogue, not from a dotted name", () => {
    expect(stepEffect(task("tb.pairing.pair"), index).resource).toEqual({ kind: "plugin", name: "tb.pairing", dynamic: false, version: 2 })
    expect(stepEffect(task("some.dotted.builtin"), index).resource).toBeNull()
  })

  it("marks computed channel and model targets as dynamic", () => {
    expect(stepEffect(task("channel_call", { channel: { var: "x" } }), index).resource).toEqual({ kind: "channel", name: null, dynamic: true })
    expect(stepEffect(task("model_infer", { model: "ranker" }), index)).toMatchObject({ op: "infer", resource: { kind: "model", name: "ranker" } })
  })

  it("resolves aliases and reads a filter as a gate", () => {
    expect(stepEffect(task("validate"), index).retry).toBe("pure")
    expect(stepEffect(task("filter"), index)).toMatchObject({ gate: true, op: "gate" })
  })

  it("still finds connectors before the catalogue loads", () => {
    expect(takesConnector("cache_incr")).toBe(true)
    expect(stepEffect(task("db_write", { connector: "soma-db" })).resource?.name).toBe("soma-db")
  })
})

describe("resolveDependsOn", () => {
  it("reads SQL by its statement", () => {
    expect(resolveDependsOn("sql", "select * from t")).toBe("read")
    expect(resolveDependsOn("sql", "INSERT INTO t VALUES (1)")).toBe("unsafe_write")
    expect(resolveDependsOn("sql", "insert into t values (1) on conflict do nothing")).toBe("idempotent_write")
    expect(resolveDependsOn("sql", "-- note\nUPDATE t SET a = 1")).toBe("idempotent_write")
    expect(resolveDependsOn("sql", "WITH x AS (select 1) INSERT INTO t SELECT * FROM x")).toBe("unsafe_write")
  })
  it("reads an op", () => {
    expect(resolveDependsOn("op", "upsert")).toBe("idempotent_write")
    expect(resolveDependsOn("op", "insert")).toBe("unsafe_write")
    expect(resolveDependsOn("op", "frobnicate")).toBe("unknown")
  })
})

describe("functionIndex", () => {
  it("is built once per catalogue", () => {
    expect(functionIndex(CATALOGUE)).toBe(index)
    expect(index.get("validate")?.name).toBe("validation")
  })
})
