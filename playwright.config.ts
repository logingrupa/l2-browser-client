import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", fullyParallel: false, workers: 1, timeout: 45_000,
  expect: { timeout: 12_000 },
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--use-angle=swiftshader", "--enable-webgl", "--enable-unsafe-swiftshader"] } } }],
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:5173", reuseExistingServer: false, timeout: 120_000 },
});
