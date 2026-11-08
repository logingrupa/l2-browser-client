import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const startupMeasurementBaseUrl = "http://127.0.0.1:5175";

export default defineConfig({
  ...base,
  testDir: "./tests/startup",
  workers: 1,
  outputDir: "test-results/startup",
  use: { ...base.use, baseURL: startupMeasurementBaseUrl, trace: "on" },
  webServer: { command: "pnpm exec vite --host 127.0.0.1 --port 5175 --strictPort", url: startupMeasurementBaseUrl, reuseExistingServer: false, timeout: 120_000 },
});
