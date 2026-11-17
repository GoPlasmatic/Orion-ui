import { test, expect, type Page } from "@playwright/test"

/**
 * The 2.0 foundations against a live Orion 2.0 server with admin auth on: the
 * console asks for a key with one probe rather than a burst of refused
 * requests, takes a valid key, speaks only `/api/v2`, and learns a read-only
 * key from the first change it is refused.
 *
 * Needs `ORION_ADMIN_KEY` (full access) and `ORION_READ_ONLY_KEY` — the keys
 * the server under test was started with. CI provides both.
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
  if (!serverUp && process.env.CI) {
    throw new Error(`Orion server not reachable through the dev proxy (ORION_URL=${process.env.ORION_URL})`)
  }
})

test.beforeEach(() => {
  test.skip(!serverUp, "Orion server not running")
  test.skip(!fullKey || !readOnlyKey, "Set ORION_ADMIN_KEY and ORION_READ_ONLY_KEY to the server's keys")
})

/** Every request the page sends to the server, by path. */
function recordRequests(page: Page): string[] {
  const seen: string[] = []
  page.on("request", (r) => {
    const url = new URL(r.url())
    if (url.pathname.startsWith("/api/") || url.pathname === "/metrics") seen.push(url.pathname)
  })
  return seen
}

/** A tab that already holds `key`, as one would after entering it. */
async function holdKey(page: Page, key: string) {
  await page.addInitScript((k) => sessionStorage.setItem("orion-admin-key", k), key)
}

const keyDialog = (page: Page) => page.getByRole("dialog", { name: "Admin API key" })

test("asks for a key after one probe, not a burst of refused requests", async ({ page }) => {
  const seen = recordRequests(page)
  await page.goto("/")
  await expect(keyDialog(page)).toBeVisible()
  await expect(keyDialog(page).getByText("This server requires an admin API key")).toBeVisible()
  // Let every query on the dashboard settle: none of them may reach the server.
  await page.waitForTimeout(1500)
  expect(seen.filter((p) => p.startsWith("/api/v2/admin/"))).toEqual(["/api/v2/admin/runtime-capabilities"])
})

test("refuses a wrong key, then takes a valid one", async ({ page }) => {
  await page.goto("/")
  const dialog = keyDialog(page)
  await dialog.getByLabel("Key").fill("not-a-key-at-all")
  await dialog.getByRole("button", { name: "Use key" }).click()
  await expect(dialog.getByText("The server refused this key")).toBeVisible()

  await dialog.getByLabel("Key").fill(fullKey!)
  await dialog.getByRole("button", { name: "Use key" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("button", { name: /^Admin key\./ })).toBeVisible()
})

test("speaks /api/v2 only", async ({ page }) => {
  await holdKey(page, fullKey!)
  const seen = recordRequests(page)
  for (const path of ["/", "/engine", "/traces", "/schedules", "/audit"]) {
    await page.goto(path)
    await page.waitForLoadState("networkidle")
  }
  expect(seen.length).toBeGreaterThan(0)
  expect(seen.filter((p) => p.startsWith("/api/v1/"))).toEqual([])
  await expect(keyDialog(page)).toBeHidden()
})

test("learns a read-only key from the first change it is refused", async ({ page }) => {
  await holdKey(page, readOnlyKey!)
  await page.goto("/engine?tab=maintenance")
  await page.getByRole("button", { name: "Create backup" }).click()
  await expect(page.getByRole("button", { name: /^Read-only\./ })).toBeVisible()
})
