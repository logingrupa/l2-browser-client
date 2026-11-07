import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
import { resolve } from "node:path";

const evidenceRoot = process.env.TERRAIN_REFERENCE_EVIDENCE ?? "artifacts/native-parity/research/terrain-uv-reference-20261106";

/** Isolated fixture server; no Editor regeneration or persistent service changes. */
export default defineConfig({
  ...base,
  testMatch: "terrainLegacyReference.spec.ts",
  outputDir: resolve(evidenceRoot, "playwright-results"),
  use: { ...base.use, baseURL: "http://127.0.0.1:5191" },
  webServer: { command: "pnpm exec vite --host 127.0.0.1 --port 5191 --strictPort", url: "http://127.0.0.1:5191", reuseExistingServer: process.env.TERRAIN_REFERENCE_SERVER === "1", timeout: 120_000 },
});
