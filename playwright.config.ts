import { defineConfig } from "@playwright/test"

const orionUrl = process.env.ORION_URL ?? "http://localhost:8080"
// The dev server's port. Overridable because `reuseExistingServer` will happily
// adopt whatever else is listening on 5173 and run the suite against it.
const uiPort = process.env.UI_PORT ?? "5173"
const baseURL = `http://localhost:${uiPort}`

/**
 * E2E smoke tests run the real UI (Vite dev server, which proxies /api to a
 * live orion-server at ORION_URL). Locally: start `orion-server` first, then
 * `npm run test:e2e`. Without a reachable server the suite skips itself
 * (fails in CI, where the server is provided as a container). Set UI_PORT when
 * something else already holds 5173.
 */
export default defineConfig({
  testDir: "./e2e",
  // The 1.12 smoke flow authors and activates entities through endpoints 2.0
  // removed; phase 7 of the port (PLAN-2.0.md) rewrites it around
  // deployments. Until then the 2.0 foundations spec is what runs.
  testIgnore: ["smoke.spec.ts"],
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${uiPort} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    env: { ORION_URL: orionUrl },
  },
})
