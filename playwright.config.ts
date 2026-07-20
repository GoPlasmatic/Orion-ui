import { defineConfig } from "@playwright/test"

const orionUrl = process.env.ORION_URL ?? "http://localhost:8080"

/**
 * E2E smoke tests run the real UI (Vite dev server, which proxies /api to a
 * live orion-server at ORION_URL). Locally: start `orion-server` first, then
 * `npm run test:e2e`. Without a reachable server the suite skips itself
 * (fails in CI, where the server is provided as a container).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    env: { ORION_URL: orionUrl },
  },
})
