/**
 * Render guard for the `/health` report's resident-model rows.
 *
 * A row is a loaded *session*, not a model version. Orion 1.8.1 fixed the
 * session cache to key on the manifest's binding as well as the digest — a
 * load is a function of the bytes, the manifest and the device — and added
 * `binding` to these rows so two sessions over one artifact are
 * distinguishable. Registering one artifact under several manifests is
 * expressly representable and has ordinary uses, so the digest is not a key.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import type { HealthResponse } from "@/api/types"
import { HealthComponents } from "./health-components"

afterEach(cleanup)

/** One digest, two manifests: two plans over one graph, so two sessions. */
const twoSessionsOneDigest: HealthResponse = {
  status: "ok",
  components: { database: "ok", engine: "ok", models: "ok" },
  models: {
    node: "node-a1b2c3d4",
    loaded_bytes: 2048,
    cache_bytes: 4096,
    admission_queue_capacity: 1024,
    loaded: [
      {
        digest: `sha256:${"a".repeat(64)}`,
        binding: "b1a9f00d",
        runtime: "tract",
        device: "cpu",
        resident_bytes: 1024,
      },
      {
        digest: `sha256:${"a".repeat(64)}`,
        binding: "c0ffee42",
        runtime: "tract",
        device: "cpu",
        resident_bytes: 1024,
      },
    ],
  },
} as unknown as HealthResponse

const renderReport = (health: HealthResponse) =>
  render(
    <MemoryRouter>
      <HealthComponents health={health} />
    </MemoryRouter>
  )

describe("resident model sessions", () => {
  it("renders one row per session when two share a digest", () => {
    renderReport(twoSessionsOneDigest)
    // Both bindings are shown, so the two rows are told apart.
    expect(screen.getByText("b1a9f00d")).toBeInTheDocument()
    expect(screen.getByText("c0ffee42")).toBeInTheDocument()
    // And the count reflects sessions, not distinct digests.
    expect(screen.getByText(/^2 ·/)).toBeInTheDocument()
  })

  /**
   * The list key has to carry the binding. Keyed on the digest alone the two
   * rows above collide, which React reports only as a console error — so that
   * is what this asserts, since the rendered output looks correct either way.
   */
  it("gives each session a distinct list key", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    renderReport(twoSessionsOneDigest)
    const duplicateKey = errors.mock.calls.filter((args) =>
      args.some((a) => typeof a === "string" && a.includes("same key"))
    )
    errors.mockRestore()
    expect(duplicateKey).toEqual([])
  })

  it("renders a pre-1.8.1 row that carries no binding", () => {
    const health = {
      ...twoSessionsOneDigest,
      models: {
        ...twoSessionsOneDigest.models,
        loaded: [
          {
            digest: `sha256:${"b".repeat(64)}`,
            runtime: "tract",
            device: "cpu",
            resident_bytes: 512,
          },
        ],
      },
    } as unknown as HealthResponse
    renderReport(health)
    expect(screen.getByText(/^1 ·/)).toBeInTheDocument()
  })
})
