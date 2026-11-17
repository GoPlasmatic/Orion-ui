import { test, expect, type Page } from "@playwright/test"
import { E2E_CONNECTION, seedConnection } from "./seed"

/**
 * Connections and provider packages against a live server: a deployed
 * connection over the built-in cache driver, its probe, the read-only refusal
 * of one, a package scaffolded, linted and packed in the studio, then
 * uploaded, admitted and revoked.
 */

const fullKey = process.env.ORION_ADMIN_KEY
const readOnlyKey = process.env.ORION_READ_ONLY_KEY
let serverUp = false
// One provider id per run: a published version is immutable, and a revoked
// digest stays revoked, so a rerun against the same server needs its own.
const PROVIDER = `e2e.studio${Date.now().toString(36)}`

test.describe.configure({ mode: "serial" })

test.beforeAll(async ({ request }) => {
  try {
    serverUp = (await request.get("/healthz")).ok()
  } catch {
    serverUp = false
  }
  if (!serverUp && process.env.CI) throw new Error("Orion server not reachable through the dev proxy")
  if (!serverUp || !fullKey) return
  await seedConnection(request, fullKey)
})

test.beforeEach(() => {
  test.skip(!serverUp, "Orion server not running")
  test.skip(!fullKey || !readOnlyKey, "Set ORION_ADMIN_KEY and ORION_READ_ONLY_KEY to the server's keys")
})

const holdKey = (page: Page, key: string) =>
  page.addInitScript((k) => sessionStorage.setItem("orion-admin-key", k), key)

test("the connection list groups revisions and names the provider", async ({ page }) => {
  await holdKey(page, fullKey!)
  await page.goto(`/connections?q=${E2E_CONNECTION}`)
  const row = page.locator("tbody tr", { hasText: E2E_CONNECTION })
  await expect(row).toContainText("org.orion.memory-cache")
  await expect(row).toContainText(/r\d+/)
})

test("a deployed connection probes healthy from this node", async ({ page }) => {
  await holdKey(page, fullKey!)
  await page.goto(`/connections/${E2E_CONNECTION}`)
  await expect(page.getByText(/^deployed r\d+$/)).toBeVisible()
  await page.getByRole("button", { name: /^Probe r\d+$/ }).click()
  await expect(page.getByText(/is healthy from this node/)).toBeVisible()
  await expect(page.getByText("cache read of a probe key")).toBeVisible()
})

test("a read-only key is refused a probe and told why", async ({ page }) => {
  await holdKey(page, readOnlyKey!)
  await page.goto(`/connections/${E2E_CONNECTION}`)
  const probe = page.getByRole("button", { name: /^Probe r\d+$/ })
  await probe.click()
  await expect(probe).toBeDisabled()
  await expect(page.getByText(/refuses it to a read-only key/)).toBeVisible()
})

test("the studio scaffolds, lints and packs with a read-only key, and still cannot upload", async ({ page }) => {
  await holdKey(page, readOnlyKey!)
  // The authoring tools store nothing, so a read-only key may use them.
  await page.goto("/provider-packages?tab=studio")
  await page.getByLabel("Publisher").fill("e2e")
  await page.getByLabel("Provider id").fill(PROVIDER)
  await page.getByRole("button", { name: "Generate" }).click()
  await expect(page.getByText("connector.json").first()).toBeVisible()
  await page.getByRole("button", { name: "Lint" }).click()
  await expect(page.getByText(new RegExp(`Lint passed — ${PROVIDER.replace(".", "\\.")}`))).toBeVisible()
  await page.getByRole("button", { name: "Pack" }).click()
  await expect(page.getByText(/Packs to sha256:[0-9a-f]{64}/)).toBeVisible()

  // Nothing announces a read-only key in advance. Their success is no proof
  // of full access either, so try the one verb that stores: the server's 403
  // teaches the session, and uploading then stays disabled.
  await page.getByRole("button", { name: "Upload…" }).click()
  const dialog = page.getByRole("dialog", { name: "Upload a provider package" })
  const upload = dialog.getByRole("button", { name: "Upload", exact: true })
  await upload.click()
  // The server's refusal is what teaches the session — wait for it, not just
  // for the pending state to disable the button.
  await expect(dialog.getByText(/read-only/)).toBeVisible()
  await expect(upload).toBeDisabled()
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByRole("button", { name: "Upload…" })).toBeDisabled()
})

test("a package is uploaded and admitted, then revoked", async ({ page }) => {
  await holdKey(page, fullKey!)
  await page.goto("/provider-packages?tab=studio")
  await page.getByLabel("Publisher").fill("e2e")
  await page.getByLabel("Provider id").fill(PROVIDER)
  await page.getByRole("button", { name: "Generate" }).click()
  await page.getByRole("button", { name: "Upload…" }).click()
  const dialog = page.getByRole("dialog", { name: "Upload a provider package" })
  await dialog.getByRole("checkbox", { name: "Admit it now" }).click()
  await dialog.getByRole("button", { name: "Upload and admit" }).click()
  await expect(page).toHaveURL(/\/provider-packages\/sha256%3A[0-9a-f]{64}|\/provider-packages\/sha256:[0-9a-f]{64}/)
  await expect(page.getByText("admitted", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Revoke" }).click()
  const revoke = page.getByRole("dialog", { name: new RegExp(`Revoke ${PROVIDER.replace(".", "\\.")}`) })
  await revoke.getByLabel("Reason").fill("e2e")
  await revoke.getByRole("button", { name: "Revoke" }).click()
  await expect(page.getByText("revoked", { exact: true })).toBeVisible()
})
