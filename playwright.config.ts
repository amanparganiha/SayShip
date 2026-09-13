import { defineConfig, devices } from "@playwright/test";
import { TEST_DATABASE_URL } from "./server/test/testEnv.ts";

const PORT = 3100;

/**
 * End-to-end tests run against the production build (`npm run test:e2e` builds first) with the
 * mock LLM, so they are deterministic, free, and exercise the real sandbox, SSE and database.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "node dist/server.js",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: "production",
      LLM_PROVIDER: "mock",
      DATABASE_URL: TEST_DATABASE_URL,
      SESSION_SECRET: "e2e-session-secret-0123456789-abcdefghijkl",
      // Every test signs up from localhost; lift the per-IP limits.
      GUEST_SIGNUPS_PER_HOUR: "10000",
      AUTH_ATTEMPTS_PER_15MIN: "10000",
      DAILY_RUN_LIMIT: "10000",
      GUEST_DAILY_RUN_LIMIT: "10000",
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "",
    },
  },
});
