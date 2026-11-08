import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { refuseTestRunInsideMachineWindow } from "./tests/browser/support/machineScheduleConfigGuard";
refuseTestRunInsideMachineWindow();
const envFile = fileURLToPath(new URL(".env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const baseURL = `http://127.0.0.1:${Number(process.env.DEV_PORT || 5173)}`;
const dawnCapableFullChromiumChannel = "chromium";
const swiftShaderWebGpuAdapterArguments = ["--enable-unsafe-webgpu", "--enable-unsafe-swiftshader", "--use-webgpu-adapter=swiftshader"];
const chromiumLaunchArguments = process.env.WORLD_HARDWARE_TEST === "1" ? [] : swiftShaderWebGpuAdapterArguments;
export default defineConfig({
  testDir: "./tests/browser", fullyParallel: false, workers: 1, timeout: 45_000,
  expect: { timeout: 12_000 },
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: dawnCapableFullChromiumChannel, launchOptions: { args: chromiumLaunchArguments } } }],
  webServer: { command: "pnpm dev", url: baseURL, reuseExistingServer: false, timeout: 120_000 },
});
