import { test, expect } from "@playwright/test"

/**
 * Full-stack smoke flow against a live orion-server (via the dev-server proxy):
 * author a workflow in the UI → validate → activate → create a channel bound to
 * it → activate → send a request through the Data Console → confirm the trace,
 * the functions registry, and backups. This is the drift canary: it exercises
 * the admin API, the engine reload path, and the data plane end to end.
 */

const runId = Date.now().toString(36)
const wfName = `smoke-wf-${runId}`
const chName = `smoke-ch-${runId}`
const connName = `smoke-conn-${runId}`
let workflowId = ""
let serverUp = false

test.describe.configure({ mode: "serial" })

test.beforeAll(async ({ request }) => {
  try {
    serverUp = (await request.get("/healthz")).ok()
  } catch {
    serverUp = false
  }
  if (!serverUp && process.env.CI) {
    throw new Error(
      `Orion server not reachable through the dev proxy (ORION_URL=${process.env.ORION_URL ?? "http://localhost:8080"})`
    )
  }
})

test.beforeEach(() => {
  test.skip(!serverUp, "Orion server not running — start orion-server on :8080 to run the smoke test")
})

test("author, validate, and activate a workflow", async ({ page }) => {
  await page.goto("/workflows/new")
  await page.getByLabel("Workflow name").fill(wfName)
  // The seeded sample tasks (one map task) are a valid minimal pipeline.
  await page.getByRole("button", { name: "Validate" }).click()
  await expect(page.getByText("Workflow is valid.")).toBeVisible()

  await page.getByRole("button", { name: "Create Draft" }).click()
  await page.waitForURL(/\/workflows\/(?!new$)[^/]+$/)
  workflowId = page.url().split("/").pop()!

  await page.getByRole("button", { name: "Activate" }).click()
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible()
})

test("create and activate a channel bound to the workflow", async ({ page }) => {
  await page.goto("/channels/new")
  await page.getByLabel("Channel name").fill(chName)
  // REST/HTTP channels require methods + route_pattern; the route also makes
  // the Data Console exercise its REST method+path mode below.
  await page.getByLabel("HTTP methods").fill("POST")
  await page.getByLabel("Route pattern").fill(`/${chName}`)
  await page.getByLabel("Linked workflow ID").fill(workflowId)
  await page.getByRole("button", { name: "Save" }).click()
  await page.waitForURL(/\/channels\/(?!new$)[^/]+$/)

  await page.getByRole("button", { name: "Activate" }).click()
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible()

  // The engine reloads on activation; wait until the channel is routable.
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/v1/admin/engine/status")
        if (!res.ok()) return []
        // Every admin 2xx body puts its payload under `data` since 1.0.
        const body = await res.json()
        return (body.data?.channels ?? []) as string[]
      },
      { timeout: 15_000 }
    )
    .toContain(chName)
})

test("send a request through the Data Console", async ({ page }) => {
  await page.goto("/console")
  await page.getByLabel("Channel").selectOption(chName)
  await page.getByRole("button", { name: "Send" }).click()

  // Sync responses come back as { id, status: "ok", data, errors }.
  await expect(page.getByText('"status": "ok"').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("link", { name: /open as trace/i })).toBeVisible()
})

test("the request left a trace", async ({ page }) => {
  await page.goto("/traces")
  await expect(page.getByText(chName).first()).toBeVisible()
})

test("functions reference renders the server registry", async ({ page }) => {
  await page.goto("/functions")
  await expect(page.getByText("http_call").first()).toBeVisible()
})

test("backups can be created and listed", async ({ page }) => {
  await page.goto("/settings")
  await page.getByRole("button", { name: "Create Backup" }).click()
  await expect(page.getByText(/orion_backup_/).first()).toBeVisible({ timeout: 10_000 })
})

test("workflow dependencies come from the server, not client-side parsing", async ({ page }) => {
  await page.goto(`/workflows/${workflowId}`)
  await page.getByRole("tab", { name: "Dependencies" }).click()
  // The seeded pipeline is a single map task, so it references no connectors —
  // the panel must say so rather than render empty.
  await expect(page.getByText("No connector-backed tasks.")).toBeVisible()
})

test("a connector can be created and probed", async ({ page }) => {
  await page.goto("/connectors/new")
  await page.getByPlaceholder("my-connector").fill(connName)

  // Server-side validation, not a client guess: an http connector with no url
  // is refused, and the field-level reason is rendered.
  await page.getByRole("button", { name: "Validate" }).click()
  await expect(page.getByText(/missing field `url`/)).toBeVisible()

  await page.getByPlaceholder("host").fill("url")
  await page.getByRole("button", { name: "Add" }).click()
  // exact: aria-label "url" also substring-matches the row's "Remove url" button.
  await page.getByLabel("url", { exact: true }).fill("https://example.com")

  await page.getByRole("button", { name: "Validate" }).click()
  await expect(page.getByText("Connector is valid.")).toBeVisible()

  await page.getByRole("button", { name: "Save" }).click()
  await page.waitForURL(/\/connectors\/(?!new$)[^/]+$/)

  await page.getByRole("button", { name: "Test" }).click()
  await page.getByRole("button", { name: "Run probe" }).click()
  // An http connector with no URL cannot be reached; "not reachable" is a
  // legitimate 200 answer, so the dialog must render an outcome either way.
  await expect(page.getByText(/Reachable|Not reachable|No probe available/)).toBeVisible({
    timeout: 15_000,
  })
})

test("the trace DLQ renders its empty state", async ({ page }) => {
  await page.goto("/trace-dlq")
  await expect(page.getByText("Nothing in the dead-letter queue")).toBeVisible()
})

test("the packages page renders its empty state", async ({ page }) => {
  await page.goto("/packages")
  await expect(page.getByText("No package receipts")).toBeVisible()
})
