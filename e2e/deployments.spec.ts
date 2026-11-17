import { test, expect, type Page } from "@playwright/test"
import { seedEcho, sendUntilServed } from "./seed"

/**
 * Deployments against a live server: two revisions of the echo workflow, then
 * the history, a revision's changes with the definition diff, a rollback
 * through the UI with its convergence, and a read-only key refused the
 * rollback.
 */

const fullKey = process.env.ORION_ADMIN_KEY
const readOnlyKey = process.env.ORION_READ_ONLY_KEY
let serverUp = false
let first = 0
let second = 0

test.describe.configure({ mode: "serial" })

test.beforeAll(async ({ request }) => {
  try {
    serverUp = (await request.get("/healthz")).ok()
  } catch {
    serverUp = false
  }
  if (!serverUp && process.env.CI) throw new Error("Orion server not reachable through the dev proxy")
  if (!serverUp || !fullKey) return
  first = (await seedEcho(request, fullKey, 1)).revision
  const changed = await seedEcho(request, fullKey, 2)
  second = changed.revision
  await sendUntilServed(request, changed.path)
})

test.beforeEach(() => {
  test.skip(!serverUp, "Orion server not running")
  test.skip(!fullKey || !readOnlyKey, "Set ORION_ADMIN_KEY and ORION_READ_ONLY_KEY to the server's keys")
})

const holdKey = (page: Page, key: string) =>
  page.addInitScript((k) => sessionStorage.setItem("orion-admin-key", k), key)

test("the history lists the head first", async ({ page }) => {
  await holdKey(page, fullKey!)
  await page.goto("/deployments")
  const firstRow = page.locator("tbody tr").first()
  await expect(firstRow).toContainText(String(second))
  await expect(firstRow).toContainText("head")
  await expect(page.getByText("Head revision")).toBeVisible()
})

test("a revision shows what it changed, down to the definition", async ({ page }) => {
  await holdKey(page, fullKey!)
  await page.goto(`/deployments/${second}?tab=changes&compare=${first}`)
  await expect(page.getByText(`What revision ${second} changes against`)).toBeVisible()
  const row = page.locator("tbody tr", { hasText: "e2e-echo" }).filter({ hasText: "workflow" })
  await expect(row).toContainText("changed")
  await expect(row).toContainText("definition")
  await row.click()
  await expect(page.getByText(/changed lines?$/)).toBeVisible()
  await expect(page.locator("pre").getByText('"logic": 2')).toBeVisible()
})

test("a read-only key is refused a rollback and the console says so", async ({ page }) => {
  await holdKey(page, readOnlyKey!)
  await page.goto(`/deployments/${first}`)
  await page.getByRole("button", { name: "Roll back to this revision" }).click()
  const dialog = page.getByRole("dialog", { name: `Roll back to revision ${first}` })
  await dialog.getByRole("button", { name: `Roll back to ${first}` }).click()
  await expect(dialog.getByText(/read-only/)).toBeVisible()
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByRole("button", { name: "Roll back to this revision" })).toBeDisabled()
  await expect(page.getByRole("button", { name: /^Read-only\./ })).toBeVisible()
})

test("rolling back commits a new revision and it converges", async ({ page }) => {
  await holdKey(page, fullKey!)
  await page.goto(`/deployments/${first}`)
  await page.getByRole("button", { name: "Roll back to this revision" }).click()
  const dialog = page.getByRole("dialog", { name: `Roll back to revision ${first}` })
  await expect(dialog.getByText("changed").first()).toBeVisible()
  await dialog.getByLabel("Reason").fill("e2e rollback")
  await dialog.getByRole("button", { name: `Roll back to ${first}` }).click()
  const done = page.getByRole("dialog", { name: "Rolled back" })
  await expect(done.getByText(`Committed revision ${second + 1}`)).toBeVisible()
  await done.getByRole("link", { name: "Watch convergence" }).click()
  await expect(page).toHaveURL(new RegExp(`/deployments/${second + 1}\\?tab=convergence`))
  await expect(page.getByText(`Converged: this node serves revision ${second + 1}.`)).toBeVisible()

  await page.goto("/audit?action=v2_deployment_rollback")
  await expect(page.locator("tbody tr").first()).toContainText(String(second + 1))
})
