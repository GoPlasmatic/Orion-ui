import { test, expect, type Page } from "@playwright/test"
import { seedEcho, sendUntilServed } from "./seed"

/**
 * Workflows, channels and plugins as views of the head (PLAN-2.0.md, phase 3)
 * against a live server: the lists read the deployed manifest, a workflow's
 * page draws its lenses and runs its definition through `definitions/test`,
 * a channel's page names the workflow it requires and its history, a 1.x
 * authoring link lands on the entity, and a read-only key is told why the
 * test is off.
 */

const fullKey = process.env.ORION_ADMIN_KEY
const readOnlyKey = process.env.ORION_READ_ONLY_KEY
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
  const seeded = await seedEcho(request, fullKey, 1)
  await sendUntilServed(request, seeded.path)
})

test.beforeEach(() => {
  test.skip(!serverUp, "Orion server not running")
  test.skip(!fullKey || !readOnlyKey, "Set ORION_ADMIN_KEY and ORION_READ_ONLY_KEY to the server's keys")
})

const holdKey = (page: Page, key: string) =>
  page.addInitScript((k) => sessionStorage.setItem("orion-admin-key", k), key)

test("the workflow list reads the head and says what runs each one", async ({ page }) => {
  await holdKey(page, fullKey!)
  await page.goto("/workflows?q=e2e-echo")
  const row = page.locator("tbody tr", { hasText: "e2e-echo" })
  await expect(row).toContainText(/r\d+/)
  await expect(row.getByText("e2e-echo").last()).toBeVisible()
  await row.click()
  await expect(page).toHaveURL(/\/workflows\/e2e-echo/)
  await expect(page.getByRole("button", { name: "Structure" })).toHaveAttribute("aria-pressed", "true")
})

test("a workflow's deployed definition runs through definitions/test", async ({ page }) => {
  await holdKey(page, fullKey!)
  await page.goto("/workflows/e2e-echo")
  const editor = page.getByRole("textbox", { name: "Test payload" })
  await editor.click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type('{"n": 1}')
  await page.getByRole("button", { name: /^Run revision \d+$/ }).click()
  await expect(page.getByText("Matched", { exact: true })).toBeVisible()
  await expect(page.locator("pre").getByText('"echoed"').first()).toBeVisible()
})

test("a channel names the workflow it requires and keeps a history", async ({ page }) => {
  await holdKey(page, fullKey!)
  await page.goto("/channels?q=e2e-echo")
  await page.locator("tbody tr", { hasText: "/e2e-echo" }).click()
  await expect(page).toHaveURL(/\/channels\/e2e-echo/)
  await expect(page.getByRole("link", { name: /^e2e-echo r\d+$/ })).toHaveAttribute("href", "/workflows/e2e-echo")
  await page.getByRole("tab", { name: "History" }).click()
  await expect(page.getByText("deployed", { exact: true })).toBeVisible()
})

test("a 1.x authoring link lands on the entity instead of a form", async ({ page }) => {
  await holdKey(page, fullKey!)
  await page.goto("/workflows/e2e-echo/edit")
  await expect(page).toHaveURL(/\/workflows\/e2e-echo$/)
  await page.goto("/channels/new")
  await expect(page).toHaveURL(/\/channels$/)
})

test("an id the head does not deploy says so", async ({ page }) => {
  await holdKey(page, fullKey!)
  await page.goto("/workflows/never-deployed-here")
  await expect(page.getByText('The head does not deploy workflow "never-deployed-here"')).toBeVisible()
})

test("a read-only key is told why the test is off", async ({ page }) => {
  await holdKey(page, readOnlyKey!)
  // Nothing announces a read-only key: the first refused mutation teaches the
  // console, which then disables the verb and says why.
  await page.goto("/workflows/e2e-echo")
  const run = page.getByRole("button", { name: /^Run revision \d+$/ })
  await run.click()
  await expect(run).toBeDisabled()
  await expect(page.getByText(/This console holds a read-only admin key/).first()).toBeVisible()
})
