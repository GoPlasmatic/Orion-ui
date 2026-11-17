import { test, expect, type Page } from "@playwright/test"
import { seedEcho, sendUntilServed } from "./seed"

/**
 * The surfaces 2.0 kept, against a live server seeded with one deployment and
 * some traffic: the trace list pages by cursor, the Engine page reads the
 * node's reconciler, the audit log speaks 2.0's vocabulary, and the DLQ and
 * Schedules ledgers load.
 */

const fullKey = process.env.ORION_ADMIN_KEY
const TRAFFIC = 25
let serverUp = false

test.describe.configure({ mode: "serial" })

test.beforeAll(async ({ request }) => {
  try {
    serverUp = (await request.get("/healthz")).ok()
  } catch {
    serverUp = false
  }
  if (!serverUp && process.env.CI) throw new Error("Orion server not reachable through the dev proxy")
  if (!serverUp || !fullKey) return
  const { path } = await seedEcho(request, fullKey)
  await sendUntilServed(request, path)
  for (let i = 0; i < TRAFFIC; i++) await request.post(path, { data: { data: { n: i } } })
})

test.beforeEach(async ({ page }) => {
  test.skip(!serverUp, "Orion server not running")
  test.skip(!fullKey, "Set ORION_ADMIN_KEY to the server's full-access key")
  await page.addInitScript((k) => sessionStorage.setItem("orion-admin-key", k), fullKey!)
})

const rows = (page: Page) => page.locator("tbody tr")

test("the trace list loads more by cursor", async ({ page }) => {
  await page.goto("/traces?channel=e2e-echo")
  await expect(page.getByText(/^20 of [\d,]+ traces$/)).toBeVisible()
  await expect(rows(page)).toHaveCount(20)
  await page.getByRole("button", { name: "Load more" }).click()
  await expect(rows(page)).not.toHaveCount(20)
  expect(await rows(page).count()).toBeGreaterThan(20)
})

test("the Engine page reads the node's deployment", async ({ page }) => {
  await page.goto("/engine?tab=cluster")
  const card = page.getByText("Deployment on this node").locator("xpath=ancestor::*[contains(@class,'rounded')][1]")
  await expect(page.getByText("Deployment on this node")).toBeVisible()
  await expect(card.getByText("Head revision")).toBeVisible()
  await expect(card.getByText("none yet")).toHaveCount(0)
  await expect(page.getByText("Provider backends")).toBeVisible()
  await expect(page.getByText("org.orion.sqlite")).toBeVisible()
  await expect(page.getByRole("button", { name: /Reload/ })).toHaveCount(0)
})

test("the audit log records the deployment in 2.0's words", async ({ page }) => {
  await page.goto("/audit?action=v2_deployment_apply")
  await expect(rows(page).first()).toContainText("v2_deployment_apply")
  await expect(page.getByLabel("Filter by action")).toHaveValue("v2_deployment_apply")
})

test("the DLQ and the schedule ledger load", async ({ page }) => {
  await page.goto("/trace-dlq")
  await expect(page.getByRole("heading", { name: "Trace DLQ" })).toBeVisible()
  await expect(page.getByText(/Could not|Failed to load/)).toHaveCount(0)
  await page.goto("/schedules")
  await expect(page.getByRole("heading", { name: "Schedules" })).toBeVisible()
})

test("the Data Console sends to a channel and opens its trace", async ({ page }) => {
  await page.goto("/console?channel=e2e-echo")
  await expect(page.getByLabel("Channel")).toHaveValue("e2e-echo")
  await page.getByRole("button", { name: "Send", exact: true }).click()
  // A sync run answers { id, status, data, errors }.
  await expect(page.getByText('"status": "ok"').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("link", { name: /Open as trace/i })).toBeVisible()
})

test("a backup can be created and listed", async ({ page }) => {
  await page.goto("/engine?tab=maintenance")
  await page.getByRole("button", { name: "Create backup" }).click()
  // POST answers 201 and the list carries `created_at` in 2.0.
  await expect(page.getByText(/orion_backup_/).first()).toBeVisible({ timeout: 10_000 })
})
