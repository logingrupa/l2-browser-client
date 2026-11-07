import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", fullyParallel: false, workers: 1, timeout: 45_000,
  expect: { timeout: 12_000 },
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  // Full Chromium supports Dawn on this Windows setup; headless-shell cannot
  // load its DXC library. ANGLE SwiftShader flags also hide WebGPU adapters.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium", launchOptions: { args: process.env.WORLD_HARDWARE_TEST === "1" ? [] : ["--enable-unsafe-webgpu", "--enable-unsafe-swiftshader", "--use-webgpu-adapter=swiftshader"] } } }],
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:5173", reuseExistingServer: false, timeout: 120_000 },
});
