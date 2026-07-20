import { describe, it, expect, vi, afterEach } from "vitest"
import { api, ApiError, buildQuery } from "@/api/client"

function mockFetch(status: number, body: string | null, contentType = "application/json") {
  // Build a fresh Response per call — a Response body can only be consumed once.
  const spy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(body, {
        status,
        headers: body !== null ? { "Content-Type": contentType } : undefined,
      })
    )
  )
  vi.stubGlobal("fetch", spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("client error handling", () => {
  it("parses the structured error envelope into ApiError", async () => {
    mockFetch(404, JSON.stringify({ error: { code: "NOT_FOUND", message: "no such workflow" } }))
    const err = (await api.get("admin/workflows/missing").catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(404)
    expect(err.code).toBe("NOT_FOUND")
    expect(err.message).toBe("no such workflow")
  })

  it("falls back to the raw body for non-JSON errors", async () => {
    mockFetch(502, "Bad Gateway", "text/plain")
    const err = (await api.get("health").catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(502)
    expect(err.message).toBe("Bad Gateway")
    expect(err.code).toBeUndefined()
  })

  it("returns undefined for 204 No Content", async () => {
    mockFetch(204, null)
    await expect(api.delete("admin/workflows/wf-1")).resolves.toBeUndefined()
  })

  it("prefixes relative paths with /api/v1 and passes absolute paths through", async () => {
    const spy = mockFetch(200, "{}")
    await api.get("admin/engine/status")
    await api.get("/health")
    expect(spy.mock.calls[0][0]).toBe("/api/v1/admin/engine/status")
    expect(spy.mock.calls[1][0]).toBe("/health")
  })

  it("api.send uses the given method and omits an undefined body", async () => {
    const spy = mockFetch(200, "{}")
    await api.send("GET", "data/orders/42")
    const init = spy.mock.calls[0][1]
    expect(init?.method).toBe("GET")
    expect(init?.body).toBeUndefined()
  })
})

describe("buildQuery", () => {
  it("drops undefined and empty values", () => {
    expect(buildQuery({ a: 1, b: undefined, c: "", d: "x" })).toBe("?a=1&d=x")
  })

  it("returns an empty string when nothing survives", () => {
    expect(buildQuery({ a: undefined, b: "" })).toBe("")
  })

  it("URL-encodes values", () => {
    expect(buildQuery({ tag: "a b&c" })).toBe("?tag=a%20b%26c")
  })
})
