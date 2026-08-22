/**
 * Contract test: every request the API layer can issue must exist in the
 * vendored server OpenAPI spec (contracts/openapi.json) with the same method,
 * and may only send query parameters the spec declares for that operation.
 *
 * This is the guard against silent client/server drift — it fails on a renamed
 * route (admin/backup vs admin/backups), a removed endpoint, or a query param
 * the server ignores (the old audit action/resource_type filters).
 *
 * The data-plane catch-all (`/api/v1/data/{channel}`) is intentionally not in
 * the spec, so dataApi is checked for prefix shape only.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

interface SpecOperation {
  parameters?: Array<{ name: string; in: string }>
}

const spec = JSON.parse(
  readFileSync(resolve(process.cwd(), "contracts/openapi.json"), "utf8")
) as { paths: Record<string, Record<string, SpecOperation>> }

const specPaths = Object.keys(spec.paths)

interface CapturedCall {
  method: string
  path: string
}

const calls: CapturedCall[] = []

// A response stub loose enough for every `.then((r) => ...)` chain in the API
// layer: `r.data` works for both `{ data: T }` envelopes and array payloads,
// and `r.pagination` covers the audit normalizer.
const RESPONSE_STUB = { data: [], pagination: { total: 0, limit: 0, offset: 0 } }

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>()
  const record = (method: string) => (path: string) => {
    calls.push({ method, path })
    return Promise.resolve(RESPONSE_STUB)
  }
  return {
    ...actual,
    api: {
      get: record("get"),
      post: record("post"),
      put: record("put"),
      patch: record("patch"),
      delete: record("delete"),
      send: (method: string, path: string) => {
        calls.push({ method: method.toLowerCase(), path })
        return Promise.resolve(RESPONSE_STUB)
      },
    },
  }
})

const { workflowsApi } = await import("@/api/workflows")
const { channelsApi } = await import("@/api/channels")
const { connectorsApi } = await import("@/api/connectors")
const { engineApi } = await import("@/api/engine")
const { auditApi } = await import("@/api/audit")
const { backupApi } = await import("@/api/backup")
const { functionsApi } = await import("@/api/functions")
const { tracesApi } = await import("@/api/traces")
const { dataApi } = await import("@/api/data")
const { traceDlqApi } = await import("@/api/trace-dlq")
const { packagesApi } = await import("@/api/packages")

/** Resolve a client path ("admin/workflows/x?y=1" or "/health") to spec-path + query. */
function normalize(rawPath: string): { url: string; query: string | undefined } {
  const [pathPart, query] = rawPath.split("?")
  const url = pathPart.startsWith("/") ? pathPart : `/api/v1/${pathPart}`
  return { url, query }
}

/** Match a concrete URL against spec templates; prefer the most-literal match. */
function findSpecPath(url: string): string | undefined {
  const segs = url.split("/").filter(Boolean)
  const matches = specPaths.filter((p) => {
    const ps = p.split("/").filter(Boolean)
    return (
      ps.length === segs.length &&
      ps.every((s, i) => (s.startsWith("{") && s.endsWith("}")) || s === segs[i])
    )
  })
  matches.sort(
    (a, b) =>
      b.split("/").filter((s) => !s.startsWith("{")).length -
      a.split("/").filter((s) => !s.startsWith("{")).length
  )
  return matches[0]
}

function assertInSpec({ method, path }: CapturedCall, label: string) {
  const { url, query } = normalize(path)

  const specPath = findSpecPath(url)
  expect(specPath, `${label}: ${url} has no matching path in the OpenAPI spec`).toBeDefined()

  const op = spec.paths[specPath!][method]
  expect(
    op,
    `${label}: ${method.toUpperCase()} is not documented for ${specPath} in the OpenAPI spec`
  ).toBeDefined()

  if (query) {
    const declared = (op.parameters ?? [])
      .filter((p) => p.in === "query")
      .map((p) => p.name)
    for (const key of new URLSearchParams(query).keys()) {
      expect(
        declared,
        `${label}: query param "${key}" is not declared for ${method.toUpperCase()} ${specPath} — the server will silently ignore it`
      ).toContain(key)
    }
  }
}

/**
 * One invocation per API function, exercising every optional query param the
 * UI can send. The completeness check below fails if a module gains a function
 * that is missing here.
 */
const INVOCATIONS: Record<string, Record<string, () => unknown>> = {
  workflowsApi: {
    list: () => workflowsApi.list({ limit: 10, offset: 0, status: "active", tag: "t" }),
    get: () => workflowsApi.get("wf-1"),
    create: () => workflowsApi.create({ name: "wf", tasks: [] }),
    update: () => workflowsApi.update("wf-1", { name: "wf" }),
    delete: () => workflowsApi.delete("wf-1"),
    changeStatus: () => workflowsApi.changeStatus("wf-1", { status: "active" }, { reload: "defer" }),
    changeStatusDryRun: () => workflowsApi.changeStatusDryRun("wf-1", { status: "active" }),
    setRollout: () =>
      workflowsApi.setRollout("wf-1", { rollout_percentage: 50 }, { reload: "defer" }),
    listVersions: () => workflowsApi.listVersions("wf-1", { limit: 10, offset: 0 }),
    createVersion: () => workflowsApi.createVersion("wf-1"),
    test: () => workflowsApi.test("wf-1", { data: {} }),
    validate: () => workflowsApi.validate({ name: "wf", tasks: [] }),
    dependencies: () => workflowsApi.dependencies("wf-1"),
    import: () => workflowsApi.import([], { dryRun: true, onConflict: "new_version" }),
    export: () => workflowsApi.export({ status: "active", tag: "t" }),
  },
  channelsApi: {
    list: () =>
      channelsApi.list({
        limit: 10,
        offset: 0,
        status: "active",
        channel_type: "sync",
        protocol: "rest",
        tag: "t",
        sort_by: "name",
        sort_order: "asc",
      }),
    get: () => channelsApi.get("ch-1"),
    create: () => channelsApi.create({ name: "ch", channel_type: "sync", protocol: "rest" }),
    update: () => channelsApi.update("ch-1", { name: "ch" }),
    delete: () => channelsApi.delete("ch-1"),
    validate: () => channelsApi.validate({ name: "ch", channel_type: "sync", protocol: "rest" }),
    changeStatus: () => channelsApi.changeStatus("ch-1", { status: "active" }, { reload: "defer" }),
    changeStatusDryRun: () => channelsApi.changeStatusDryRun("ch-1", { status: "active" }),
    listVersions: () => channelsApi.listVersions("ch-1", { limit: 10, offset: 0 }),
    createVersion: () => channelsApi.createVersion("ch-1"),
    import: () => channelsApi.import([], { dryRun: true, onConflict: "skip" }),
    export: () =>
      channelsApi.export({
        status: "active",
        channel_type: "sync",
        protocol: "rest",
        tag: "t",
        limit: 10,
        offset: 0,
        sort_by: "name",
        sort_order: "asc",
      }),
  },
  connectorsApi: {
    list: () =>
      connectorsApi.list({ limit: 10, offset: 0, tag: "t", sort_by: "name", sort_order: "asc" }),
    get: () => connectorsApi.get("conn-1"),
    create: () => connectorsApi.create({ name: "c", connector_type: "http", config: {} }),
    update: () => connectorsApi.update("conn-1", { enabled: false }),
    delete: () => connectorsApi.delete("conn-1"),
    validate: () => connectorsApi.validate({ name: "c", connector_type: "http", config: {} }),
    test: () => connectorsApi.test("conn-1"),
    import: () => connectorsApi.import([], { dryRun: true, onConflict: "fail" }),
    export: () =>
      connectorsApi.export({ tag: "t", limit: 10, offset: 0, sort_by: "name", sort_order: "asc" }),
    getCircuitBreakers: () => connectorsApi.getCircuitBreakers(),
    resetCircuitBreaker: () => connectorsApi.resetCircuitBreaker("ch-1:conn-1"),
  },
  engineApi: {
    status: () => engineApi.status(),
    reload: () => engineApi.reload(),
    health: () => engineApi.health(),
  },
  auditApi: {
    list: () =>
      auditApi.list({
        limit: 50,
        offset: 0,
        action: "create",
        resource_type: "workflow",
        resource_id: "wf-1",
        principal: "admin",
        start_time: "2026-07-01T00:00:00Z",
        end_time: "2026-08-01T00:00:00Z",
      }),
  },
  backupApi: {
    create: () => backupApi.create(),
    list: () => backupApi.list(),
  },
  functionsApi: {
    list: () => functionsApi.list(),
  },
  tracesApi: {
    list: () =>
      tracesApi.list({
        limit: 10,
        offset: 0,
        include_total: true,
        status: "completed",
        channel: "ch",
        mode: "sync",
        sort_by: "created_at",
        sort_order: "desc",
      }),
    get: () => tracesApi.get("trace-1", "tok"),
  },
  traceDlqApi: {
    list: () => traceDlqApi.list({ limit: 10, offset: 0, channel: "ch", exhausted: true }),
    get: () => traceDlqApi.get("dlq-1"),
    requeue: () => traceDlqApi.requeue("dlq-1"),
    purge: () => traceDlqApi.purge({ older_than_hours: 24 }),
  },
  packagesApi: {
    list: () => packagesApi.list({ limit: 10, offset: 0 }),
    get: () => packagesApi.get("payments"),
  },
}

const MODULES: Record<string, object> = {
  workflowsApi,
  channelsApi,
  connectorsApi,
  engineApi,
  auditApi,
  backupApi,
  functionsApi,
  tracesApi,
  traceDlqApi,
  packagesApi,
}

describe("API layer ↔ OpenAPI contract", () => {
  beforeEach(() => {
    calls.length = 0
  })

  for (const [moduleName, fns] of Object.entries(INVOCATIONS)) {
    describe(moduleName, () => {
      for (const [fnName, invoke] of Object.entries(fns)) {
        it(`${fnName} hits a documented endpoint`, async () => {
          await invoke()
          expect(calls, `${moduleName}.${fnName} should issue exactly one request`).toHaveLength(1)
          assertInSpec(calls[0], `${moduleName}.${fnName}`)
        })
      }
    })
  }

  it("covers every function of every API module", () => {
    for (const [moduleName, mod] of Object.entries(MODULES)) {
      const covered = Object.keys(INVOCATIONS[moduleName] ?? {})
      for (const key of Object.keys(mod)) {
        expect(
          covered,
          `${moduleName}.${key} has no contract-test invocation — add one to INVOCATIONS`
        ).toContain(key)
      }
    }
  })

  // The dynamic data-plane handler is a catch-all and deliberately absent from
  // the spec; pin the path shapes the UI constructs instead.
  describe("dataApi (catch-all, not in spec)", () => {
    it("sync send posts to /api/v1/data/{channel}", async () => {
      await dataApi.processSync("orders", { data: {} })
      expect(calls[0]).toEqual({ method: "post", path: "data/orders" })
    })

    it("async send posts to /api/v1/data/{channel}/async", async () => {
      await dataApi.processAsync("orders", { data: {} })
      expect(calls[0]).toEqual({ method: "post", path: "data/orders/async" })
    })

    it("REST send targets the data prefix with the given method", async () => {
      await dataApi.processRest("GET", "/orders/42")
      expect(calls[0]).toEqual({ method: "get", path: "data/orders/42" })
    })
  })
})
