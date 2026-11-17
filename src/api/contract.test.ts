/**
 * Contract test: every request the API layer can issue must exist in the
 * vendored server OpenAPI spec (contracts/openapi.json) with the same method,
 * and may only send query parameters the spec declares for that operation.
 *
 * This is the guard against silent client/server drift — it fails on a renamed
 * route (admin/backup vs admin/backups), a removed endpoint, or a query param
 * the server ignores (the old audit action/resource_type filters).
 *
 * The data-plane catch-all (`/api/v2/data/{channel}`) is intentionally not in
 * the spec, so dataApi is checked for prefix shape only.
 *
 * It also holds each function to its endpoint's **envelope**: an endpoint
 * answering a `Data_*` schema must be unwrapped, and one answering a bare
 * object (the resources new in 2.0) or a `Page_*` must not be.
 *
 * The 2.0 port (PLAN-2.0.md) moves the API layer over module by module. Calls
 * that still speak 1.12 are listed in `PENDING_V2`, and each of those is held
 * to *still failing* — so porting one without removing it from the list fails
 * too, and the list only shrinks.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

interface SpecOperation {
  parameters?: Array<{ name: string; in: string }>
  responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
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
const { cronApi } = await import("@/api/cron")
const { cacheApi } = await import("@/api/cache")
const { modelsApi } = await import("@/api/models")
const { runtimeApi } = await import("@/api/runtime")
const { deploymentsApi } = await import("@/api/deployments")
const { definitionsApi } = await import("@/api/definitions")

/** Resolve a client path ("admin/workflows/x?y=1" or "/health") to spec-path + query. */
function normalize(rawPath: string): { url: string; query: string | undefined } {
  const [pathPart, query] = rawPath.split("?")
  const url = pathPart.startsWith("/") ? pathPart : `/api/v2/${pathPart}`
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

/** Why a call does not match the spec, or null when it does. */
function specMismatch({ method, path }: CapturedCall, label: string): string | null {
  const { url, query } = normalize(path)

  const specPath = findSpecPath(url)
  if (!specPath) return `${label}: ${url} has no matching path in the OpenAPI spec`

  const op = spec.paths[specPath][method]
  if (!op) return `${label}: ${method.toUpperCase()} is not documented for ${specPath} in the OpenAPI spec`

  if (query) {
    const declared = (op.parameters ?? []).filter((p) => p.in === "query").map((p) => p.name)
    for (const key of new URLSearchParams(query).keys()) {
      if (!declared.includes(key)) {
        return `${label}: query param "${key}" is not declared for ${method.toUpperCase()} ${specPath} — the server will silently ignore it`
      }
    }
  }
  return null
}

/** The envelope an operation's success answer comes in: `data` (`Data_*`), `page` (`Page_*`) or `bare`. */
function responseEnvelope({ method, path }: CapturedCall): "data" | "page" | "bare" | undefined {
  const specPath = findSpecPath(normalize(path).url)
  const op = specPath ? spec.paths[specPath][method] : undefined
  const ok = Object.entries(op?.responses ?? {}).find(([code]) => code.startsWith("2"))?.[1]
  const ref = ok?.content?.["application/json"]?.schema?.$ref
  if (!ref) return undefined
  const name = ref.split("/").pop()!
  return name.startsWith("Data_") ? "data" : name.startsWith("Page_") ? "page" : "bare"
}

/**
 * One invocation per API function, exercising every optional query param the
 * UI can send. The completeness check below fails if a module gains a function
 * that is missing here.
 */
const INVOCATIONS: Record<string, Record<string, () => unknown>> = {
  runtimeApi: {
    capabilities: () => runtimeApi.capabilities(),
  },
  deploymentsApi: {
    list: () => deploymentsApi.list({ limit: 20, cursor: "c" }),
    get: () => deploymentsApi.get(3),
    convergence: () => deploymentsApi.convergence(3, "observed"),
    plan: () => deploymentsApi.plan(3, { schema_version: 2, providers: [], members: [] }),
    rollback: () =>
      deploymentsApi.rollback({ idempotency_key: "k", base_revision: 4, rollback_to: 2, reason: "r" }),
  },
  definitionsApi: {
    get: () => definitionsApi.get("sha256:00"),
    test: () => definitionsApi.test({ definition: { name: "w", tasks: [] }, data: {} }),
  },
  channelsApi: {
    trigger: () => channelsApi.trigger("ch-1"),
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
    health: () => engineApi.health(),
  },
  auditApi: {
    list: () =>
      auditApi.list({
        limit: 50,
        cursor: "c",
        include_total: true,
        action: "v2_deployment_apply",
        resource_type: "deployment",
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
        cursor: "c",
        include_total: true,
        status: "completed",
        channel: "ch",
        mode: "sync",
      }),
    get: () => tracesApi.get("trace-1", "tok"),
  },
  traceDlqApi: {
    list: () => traceDlqApi.list({ limit: 10, cursor: "c", include_total: true, channel: "ch", exhausted: true }),
    get: () => traceDlqApi.get("dlq-1"),
    requeue: () => traceDlqApi.requeue("dlq-1"),
    purge: () => traceDlqApi.purge({ older_than_hours: 24 }),
  },
  packagesApi: {
    list: () => packagesApi.list({ limit: 10, offset: 0 }),
    // 1.9: one row per package, its current receipt, carrying the inventory.
    // Not a module function — an extra invocation, so the query param the
    // `current` flag turns into is checked against the spec like any other.
    "list?current": () => packagesApi.list({ limit: 10, offset: 0, current: true }),
    get: () => packagesApi.get("payments"),
  },
  cacheApi: {
    invalidateNamespace: () => cacheApi.invalidateNamespace("posts"),
  },
  cronApi: {
    listOccurrences: () =>
      cronApi.listOccurrences({
        limit: 10,
        cursor: "c",
        include_total: true,
        channel_id: "ch-1",
        status: "failed",
        since: "2026-09-01T00:00:00Z",
        until: "2026-09-05T00:00:00Z",
      }),
    getOccurrence: () => cronApi.getOccurrence("occ-1"),
    retryOccurrence: () => cronApi.retryOccurrence("occ-1"),
    cancelOccurrence: () => cronApi.cancelOccurrence("occ-1"),
    status: () => cronApi.status(),
  },
  modelsApi: {
    list: () =>
      modelsApi.list({
        limit: 10,
        offset: 0,
        status: "active",
        tag: "t",
        admission: "passed",
        sort_by: "model_id",
        sort_order: "asc",
      }),
    get: () => modelsApi.get("ada.c4-tiny"),
    create: () =>
      modelsApi.create({
        manifest: { abi: "orion:model@1.0.0", name: "ada.c4-tiny" },
        artifact: { connector: "models", key: "c4-tiny.onnx", digest: "sha256:0" },
      }),
    update: () => modelsApi.update("ada.c4-tiny", { tags: ["t"] }),
    delete: () => modelsApi.delete("ada.c4-tiny"),
    validate: () =>
      modelsApi.validate({
        manifest: { abi: "orion:model@1.0.0", name: "ada.c4-tiny" },
        artifact: { connector: "models", key: "c4-tiny.onnx", digest: "sha256:0" },
      }),
    changeStatus: () =>
      modelsApi.changeStatus("ada.c4-tiny", { status: "active" }, { reload: "defer" }),
    changeStatusDryRun: () => modelsApi.changeStatusDryRun("ada.c4-tiny", { status: "active" }),
    admit: () => modelsApi.admit("ada.c4-tiny", { wait: true }),
    listVersions: () => modelsApi.listVersions("ada.c4-tiny", { limit: 10, offset: 0 }),
    createVersion: () => modelsApi.createVersion("ada.c4-tiny"),
    dependencies: () => modelsApi.dependencies("ada.c4-tiny"),
    import: () => modelsApi.import([], { dryRun: true, onConflict: "new_version" }),
    export: () =>
      modelsApi.export({
        status: "active",
        tag: "t",
        admission: "passed",
        limit: 10,
        offset: 0,
        sort_by: "model_id",
        sort_order: "asc",
      }),
  },
}

/**
 * Calls that still speak the 1.12 API, by `module.function`. Phase 1 of the
 * port moves the surfaces 2.0 kept (traces, DLQ, cron, audit, engine); phases
 * 2–4 replace the per-entity CRUD modules with deployments, definitions and
 * connections. Each entry must still fail; remove it when it is ported.
 */
const PENDING_V2 = new Set<string>([
  "connectorsApi.list",
  "connectorsApi.get",
  "connectorsApi.create",
  "connectorsApi.update",
  "connectorsApi.delete",
  "connectorsApi.validate",
  "connectorsApi.test",
  "connectorsApi.import",
  "connectorsApi.export",
  "packagesApi.list",
  "packagesApi.list?current",
  "packagesApi.get",
  "modelsApi.list",
  "modelsApi.get",
  "modelsApi.create",
  "modelsApi.update",
  "modelsApi.delete",
  "modelsApi.validate",
  "modelsApi.changeStatus",
  "modelsApi.changeStatusDryRun",
  "modelsApi.admit",
  "modelsApi.listVersions",
  "modelsApi.createVersion",
  "modelsApi.dependencies",
  "modelsApi.import",
  "modelsApi.export",
])

const MODULES: Record<string, object> = {
  channelsApi,
  connectorsApi,
  engineApi,
  auditApi,
  backupApi,
  functionsApi,
  tracesApi,
  traceDlqApi,
  packagesApi,
  cronApi,
  cacheApi,
  modelsApi,
  runtimeApi,
  deploymentsApi,
  definitionsApi,
}

describe("API layer ↔ OpenAPI contract", () => {
  beforeEach(() => {
    calls.length = 0
  })

  for (const [moduleName, fns] of Object.entries(INVOCATIONS)) {
    describe(moduleName, () => {
      for (const [fnName, invoke] of Object.entries(fns)) {
        const label = `${moduleName}.${fnName}`
        const pending = PENDING_V2.has(label)
        it(`${fnName} hits a documented endpoint${pending ? " (pending the 2.0 port)" : ""}`, async () => {
          const result = await invoke()
          expect(calls, `${label} should issue exactly one request`).toHaveLength(1)
          const mismatch = specMismatch(calls[0], label)
          if (pending) {
            expect(mismatch, `${label} now matches the 2.0 spec — remove it from PENDING_V2`).not.toBeNull()
            return
          }
          expect(mismatch).toBeNull()
          // A function that post-processes the answer is not judged here; one
          // that hands back the stub or its \`data\` must have chosen right.
          const envelope = responseEnvelope(calls[0])
          if (result === RESPONSE_STUB) {
            expect(envelope, `${label} returns the \`{data}\` envelope itself — unwrap it`).not.toBe("data")
          } else if (result === RESPONSE_STUB.data) {
            expect(envelope, `${label} unwraps a ${envelope} answer, which has no \`data\` envelope`).toBe("data")
          }
        })
      }
    })
  }

  it("lists only real functions as pending", () => {
    for (const label of PENDING_V2) {
      const [moduleName, fnName] = label.split(".")
      expect(Object.keys(INVOCATIONS[moduleName] ?? {}), `PENDING_V2 names ${label}, which has no invocation`).toContain(fnName)
    }
  })

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
    it("sync send posts to /api/v2/data/{channel}", async () => {
      await dataApi.processSync("orders", { data: {} })
      expect(calls[0]).toEqual({ method: "post", path: "data/orders" })
    })

    it("async send posts to /api/v2/data/{channel}/async", async () => {
      await dataApi.processAsync("orders", { data: {} })
      expect(calls[0]).toEqual({ method: "post", path: "data/orders/async" })
    })

    it("REST send targets the data prefix with the given method", async () => {
      await dataApi.processRest("GET", "/orders/42")
      expect(calls[0]).toEqual({ method: "get", path: "data/orders/42" })
    })
  })
})
