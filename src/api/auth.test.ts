/**
 * The admin credential rules (api/auth.ts), driven through the real client
 * against a stubbed `fetch`. The point of every one: a request with no key is
 * a failed attempt, five of them lock the address out, and the console must
 * never send a burst of them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { api, ApiError } from "@/api/client"
import {
  clearAdminKey,
  getAdminAuth,
  resetAdminAuthForTests,
  setAdminKey,
  tryAdminKey,
} from "@/api/auth"

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown }

let seen: { url: string; headers: Record<string, string>; method: string }[] = []

function serve(handler: Handler) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>
      seen.push({ url, headers, method: (init.method ?? "GET").toUpperCase() })
      const { status, body } = handler(url, init)
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    })
  )
}

const unauthorized = (message: string) => ({
  status: 401,
  body: { error: { code: "UNAUTHORIZED", message } },
})

/** A server with `admin_auth` on and one full key. */
const guarded =
  (fullKey: string, readOnlyKey?: string): Handler =>
  (url, init) => {
    if (!url.startsWith("/api/v2/admin/")) return { status: 200, body: { status: "ok" } }
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization
    if (!auth) return unauthorized("Missing Authorization header")
    if (auth === `Bearer ${readOnlyKey}`) {
      return (init.method ?? "GET") === "GET"
        ? { status: 200, body: { data: [] } }
        : { status: 403, body: { error: { code: "FORBIDDEN", message: "This API key is read-only" } } }
    }
    if (auth !== `Bearer ${fullKey}`) return unauthorized("Invalid API key")
    return { status: 200, body: { data: [] } }
  }

beforeEach(() => {
  seen = []
  sessionStorage.clear()
  localStorage.clear()
  resetAdminAuthForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("admin auth", () => {
  it("sends one probe, not a burst, when a page asks for many things at once", async () => {
    serve(guarded("full-key"))
    const results = await Promise.allSettled([
      api.get("admin/traces"),
      api.get("admin/audit-logs"),
      api.get("admin/cron/status"),
      api.get("admin/trace-dlq"),
      api.get("admin/engine/status"),
      api.get("admin/functions"),
    ])
    // The probe was the only request the server saw; the six failed locally.
    expect(seen.map((s) => s.url)).toEqual(["/api/v2/admin/runtime-capabilities"])
    expect(results.every((r) => r.status === "rejected")).toBe(true)
    const reason = (results[0] as PromiseRejectedResult).reason as ApiError
    expect(reason.status).toBe(401)
    expect(reason.heldBack).toBe(true)
    expect(getAdminAuth()).toMatchObject({ status: "needed", reason: "missing" })
  })

  it("keeps holding back until a key is entered, then sends it as a bearer token", async () => {
    serve(guarded("full-key"))
    await expect(api.get("admin/traces")).rejects.toBeInstanceOf(ApiError)
    await expect(api.get("admin/traces")).rejects.toBeInstanceOf(ApiError)
    expect(seen).toHaveLength(1)

    setAdminKey("full-key")
    await expect(api.get("admin/traces")).resolves.toEqual({ data: [] })
    const last = seen.at(-1)!
    expect(last.url).toBe("/api/v2/admin/traces")
    expect(last.headers.Authorization).toBe("Bearer full-key")
    expect(getAdminAuth().status).toBe("accepted")
    expect(sessionStorage.getItem("orion-admin-key")).toBe("full-key")
    expect(localStorage.getItem("orion-admin-key")).toBeNull()
  })

  it("asks nothing of a server with admin auth off", async () => {
    serve(() => ({ status: 200, body: { data: [] } }))
    await api.get("admin/traces")
    await api.get("admin/audit-logs")
    expect(getAdminAuth().status).toBe("open")
    expect(seen.every((s) => s.headers.Authorization === undefined)).toBe(true)
  })

  it("never sends the admin key to the data plane", async () => {
    serve(() => ({ status: 200, body: { data: {} } }))
    setAdminKey("full-key", undefined, true)
    await api.post("data/orders", { data: {} })
    await api.send("GET", "data/orders/42")
    await api.get("/health")
    expect(seen.map((s) => [s.url, s.headers.Authorization])).toEqual([
      ["/api/v2/data/orders", undefined],
      ["/api/v2/data/orders/42", undefined],
      ["/health", "Bearer full-key"],
    ])
  })

  it("never holds back /health, which answers anyone", async () => {
    serve(guarded("full-key"))
    await api.get("admin/traces").catch(() => undefined)
    await expect(api.get("/health")).resolves.toEqual({ status: "ok" })
  })

  it("reads a custom admin_auth.header off the server's 401 and sends the key raw in it", async () => {
    serve((url, init) => {
      const key = (init.headers as Record<string, string> | undefined)?.["X-API-Key"]
      if (url.startsWith("/api/v2/admin/") && key !== "k") return unauthorized("Missing X-API-Key header")
      return { status: 200, body: { data: [] } }
    })
    await api.get("admin/traces").catch(() => undefined)
    expect(getAdminAuth().header).toBe("X-API-Key")
    setAdminKey("k")
    await api.get("admin/traces")
    expect(seen.at(-1)!.headers["X-API-Key"]).toBe("k")
    expect(seen.at(-1)!.headers.Authorization).toBeUndefined()
  })

  it("marks a refused key as refused rather than missing", async () => {
    serve(guarded("full-key"))
    setAdminKey("wrong")
    await api.get("admin/traces").catch(() => undefined)
    expect(getAdminAuth()).toMatchObject({ status: "needed", reason: "refused" })
  })

  it("learns a read-only key from the first refused mutation, and full access from an accepted one", async () => {
    serve(guarded("full-key", "ro-key"))
    setAdminKey("ro-key")
    await api.get("admin/traces")
    expect(getAdminAuth().access).toBe("unknown")
    await expect(api.post("admin/backups")).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" })
    expect(getAdminAuth().access).toBe("read-only")

    setAdminKey("full-key")
    await api.post("admin/backups")
    expect(getAdminAuth().access).toBe("full")
  })

  it("does not take an accepted plan or authoring call as proof of full access", async () => {
    // A read-only key may plan and use the authoring tools; the server says yes to both.
    serve(() => ({ status: 200, body: {} }))
    setAdminKey("ro-key")
    await api.post("admin/deployment-plans", {})
    await api.post("admin/authoring/lint", { files: {} })
    expect(getAdminAuth().access).toBe("unknown")
  })

  it("forgetting the key holds back again", async () => {
    serve(guarded("full-key"))
    setAdminKey("full-key", undefined, true)
    await api.get("admin/traces")
    clearAdminKey()
    await expect(api.get("admin/traces")).rejects.toMatchObject({ heldBack: true })
    expect(sessionStorage.getItem("orion-admin-key")).toBeNull()
  })

  it("tryAdminKey reports what one probe said", async () => {
    serve(guarded("full-key"))
    expect(await tryAdminKey("full-key", "Authorization")).toBe("accepted")
    expect(await tryAdminKey("nope", "Authorization")).toBe("refused")
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("network"))))
    expect(await tryAdminKey("full-key", "Authorization")).toBe("unreachable")
  })

  it("does not settle on a network failure: the next request probes again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("network"))))
    await expect(api.get("admin/traces")).rejects.toThrow()
    expect(getAdminAuth().status).toBe("unprobed")
    serve(() => ({ status: 200, body: { data: [] } }))
    await api.get("admin/traces")
    expect(getAdminAuth().status).toBe("open")
  })
})

describe("error envelope", () => {
  it("carries the 2.0 connector detail onto ApiError", async () => {
    serve(() => ({
      status: 502,
      body: {
        error: {
          code: "CONNECTOR_ERROR",
          message: "upstream failed",
          connector: { class: "unavailable", provider_code: "PG_CONN_REFUSED", retryable: true },
        },
      },
    }))
    const err = (await api.post("data/orders").catch((e) => e)) as ApiError
    expect(err.connector).toEqual({ class: "unavailable", provider_code: "PG_CONN_REFUSED", retryable: true })
  })
})
