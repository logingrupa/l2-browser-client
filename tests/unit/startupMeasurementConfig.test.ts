import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import startupMeasurementConfig from "../../playwright.startup.config";

describe("dev cold-start measurement server", () => {
  it("starts through pnpm dev so the WebGPU compilers are staged as in a real dev start", async () => {
    const packageScripts = (JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(packageScripts.dev).toContain("node scripts/stage-webgpu-compilers.mjs");
    const webServer = startupMeasurementConfig.webServer;
    if (!webServer || Array.isArray(webServer)) throw new Error("The startup measurement config needs one web server.");
    expect(webServer.command).toBe("pnpm dev --port 5175 --strictPort");
    expect(webServer.url).toBe("http://127.0.0.1:5175");
  });
});
