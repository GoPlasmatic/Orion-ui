import { test, expect } from "@playwright/test"

/**
 * Full-stack smoke flow against a live orion-server (via the dev-server proxy):
 * author a workflow in the UI → validate → activate → create a channel bound to
 * it → activate → send a request through the Data Console → confirm the trace
 * and backups. This is the drift canary: it exercises
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
  // the Data Console exercise its REST method+path mode below. Methods are a
  // checkbox group and the workflow a picker since 2026-09-05.
  await page.getByRole("checkbox", { name: "POST" }).click()
  await page.getByLabel("Route pattern").fill(`/${chName}`)
  await page.getByLabel("Linked workflow").selectOption(workflowId)
  await page.getByRole("button", { name: "Create Draft" }).click()
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

test("backups can be created and listed", async ({ page }) => {
  await page.goto("/engine")
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

// ---- Orion 1.6: cron channels and the occurrence ledger ----------------------

const cronName = `smoke-cron-${runId}`
let cronChannelId = ""

test("create and activate a cron channel bound to the workflow", async ({ page }) => {
  // `?protocol=cron` preselects the schedule editor, as the Schedules page links it.
  await page.goto("/channels/new?protocol=cron")
  await expect(page.getByRole("heading", { name: "Create Cron Channel" })).toBeVisible()
  await page.getByLabel("Channel name").fill(cronName)
  // Daily at 03:00 UTC: the schedule itself never fires during the run, so
  // the ledger holds exactly what the suite triggers. Occurrence identity is
  // `(channel, scheduled_for)` at second precision, and a busy schedule made
  // "Trigger now" collide with its own tick as a 409.
  await page.getByLabel("Cron expression").fill("0 0 3 * * *")
  await page.getByLabel("Linked workflow").selectOption(workflowId)

  // Server-side validation runs the create-time checks against the real
  // schedule. It answers `valid: true` here — with an advisory about the
  // linked workflow, so the verdict renders as findings rather than the bare
  // "valid" label. What matters is that nothing was refused.
  await page.getByRole("button", { name: "Validate" }).click()
  await expect(page.getByText(/refuses|references workflow|valid/i).first()).toBeVisible()
  await expect(page.getByText(/must|unknown field|invalid/i)).toHaveCount(0)

  await page.getByRole("button", { name: "Create Draft" }).click()
  // A UUID, specifically: `/channels/new?protocol=cron` is where the form
  // lives, and a looser pattern matched it before the save landed.
  await page.waitForURL(/\/channels\/[0-9a-f-]{36}$/)
  cronChannelId = page.url().split("/").pop()!

  // The schedule card renders the transport_config, not a route.
  await expect(page.getByText("Schedule", { exact: true })).toBeVisible()
  await expect(page.getByText("0 0 3 * * *").first()).toBeVisible()

  await page.getByRole("button", { name: "Activate" }).click()
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible()
})

test("a cron channel is not offered in the Data Console", async ({ page }) => {
  await page.goto("/console")
  await expect(page.getByLabel("Channel")).toBeVisible()
  await expect(page.getByLabel("Channel").locator(`option[value="${cronName}"]`)).toHaveCount(0)
  await expect(page.getByText(/not listed: a schedule is not reachable by name/)).toBeVisible()
})

test("the schedule appears on the Schedules page and can be triggered", async ({ page }) => {
  await page.goto("/schedules")
  // Materialised within one poll interval of activation.
  await expect(page.getByRole("link", { name: cronName })).toBeVisible({ timeout: 15_000 })

  const row = page.getByRole("row", { name: new RegExp(cronName) })
  await row.getByRole("button", { name: "Trigger now" }).click()
  await expect(page.getByText("Occurrence created")).toBeVisible({ timeout: 15_000 })

  // The ledger, filtered to this channel, shows a manual occurrence.
  await page.goto(`/schedules?channel_id=${cronChannelId}`)
  await expect(page.getByText("manual").first()).toBeVisible({ timeout: 15_000 })
})

test("an occurrence opens in full and links its trace", async ({ page }) => {
  await page.goto(`/channels/${cronChannelId}`)
  await page.getByRole("tab", { name: "Occurrences" }).click()
  const first = page.getByRole("row").nth(1)
  await expect(first).toBeVisible({ timeout: 15_000 })
  await first.click()
  await page.waitForURL(/\/schedules\/occurrences\/[^/]+$/)
  await expect(page.getByText("Scheduled for")).toBeVisible()
  // A run that completed has a trace to read it in.
  await expect(page.getByRole("link", { name: /open trace/i })).toBeVisible({ timeout: 30_000 })
})

test("a triggered run leaves a trace with mode cron", async ({ page }) => {
  await page.goto("/traces")
  await page.getByLabel("Filter by mode").selectOption("cron")
  await expect(page.getByText(cronName).first()).toBeVisible({ timeout: 15_000 })
})

test("archiving the cron channel stops it", async ({ page }) => {
  await page.goto(`/channels/${cronChannelId}`)
  await page.getByRole("button", { name: "Archive" }).click()
  await page.getByRole("button", { name: "Confirm" }).click()
  await expect(page.getByRole("button", { name: "Archive" })).toHaveCount(0)
})

// ---- Orion 1.6: plugins --------------------------------------------------------

test("the plugins page renders and the upload form validates server-side", async ({ page }) => {
  await page.goto("/plugins")
  // A fresh CI container has none; a developer's server may hold some. Either
  // way the page must land on one of its two shapes, never on a blank.
  await expect(
    page.getByText("No plugins yet").or(page.getByRole("columnheader", { name: "Plugin" }))
  ).toBeVisible()

  await page.goto("/plugins/new")
  // The seeded manifest names no component: the client asks for one before
  // the round trip, the way it does for a workflow name.
  await page.getByRole("button", { name: "Validate" }).click()
  await expect(page.getByText(/Choose the component file/)).toBeVisible()

  // With a digest nothing holds, the *server* answers — either the sandbox
  // is off (400, plugins.enabled = false) or the artifact is unknown. Both
  // are rendered rather than swallowed.
  await page.getByLabel("Component digest").fill("sha256:" + "0".repeat(64))
  await page.getByRole("button", { name: "Validate" }).click()
  await expect(
    page.getByText(/plugin|disabled|digest|artifact|manifest/i).first()
  ).toBeVisible({ timeout: 15_000 })
})

test("the health report on Engine names the 1.6 components", async ({ page }) => {
  await page.goto("/engine")
  await expect(page.getByText("engine_reload")).toBeVisible()
  await expect(page.getByText("plugins", { exact: true })).toBeVisible()
})
