/**
 * `since` / `until` on the occurrence ledger are `NaiveDateTime`, and the
 * server refuses a trailing zone or fraction — verified against a live 1.8.0
 * node, which answers 400 `since: trailing input` for the `Z` form that every
 * other admin time filter accepts. The app only ever has ISO instants, so the
 * trim is the API module's job.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const calls: string[] = []

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>()
  return {
    ...actual,
    api: {
      get: (path: string) => {
        calls.push(path)
        return Promise.resolve({ data: [], total: 0, limit: 0, offset: 0 })
      },
      post: (path: string) => {
        calls.push(path)
        return Promise.resolve({ data: {} })
      },
    },
  }
})

const { cronApi } = await import("@/api/cron")

const queryOf = (path: string) =>
  Object.fromEntries(new URLSearchParams(path.split("?")[1] ?? ""))

describe("cronApi.listOccurrences time filters", () => {
  beforeEach(() => {
    calls.length = 0
  })

  it("strips the zone and fraction a Date.toISOString() carries", async () => {
    await cronApi.listOccurrences({ since: "2026-09-13T03:00:00.000Z" })
    expect(queryOf(calls[0]).since).toBe("2026-09-13T03:00:00")
  })

  it("strips a bare trailing Z", async () => {
    await cronApi.listOccurrences({ until: "2026-09-13T03:00:00Z" })
    expect(queryOf(calls[0]).until).toBe("2026-09-13T03:00:00")
  })

  it("leaves a value already in the server's own spelling alone", async () => {
    await cronApi.listOccurrences({ since: "2026-09-13T03:00:00" })
    expect(queryOf(calls[0]).since).toBe("2026-09-13T03:00:00")
  })

  it("omits an absent bound rather than sending an empty one", async () => {
    await cronApi.listOccurrences({ status: "failed", limit: 5 })
    const q = queryOf(calls[0])
    expect(q.since).toBeUndefined()
    expect(q.until).toBeUndefined()
    expect(q.status).toBe("failed")
  })

  it("keeps every other filter untouched", async () => {
    await cronApi.listOccurrences({
      channel_id: "ch-1",
      status: "failed",
      limit: 5,
      since: "2026-09-13T03:00:00.000Z",
    })
    expect(queryOf(calls[0])).toEqual({
      channel_id: "ch-1",
      status: "failed",
      limit: "5",
      since: "2026-09-13T03:00:00",
    })
  })
})
