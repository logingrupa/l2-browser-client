import { resolveConfig } from "vite";
import { describe, expect, it } from "vitest";

const nativeStoreRootPluginName = "native-store-root";

async function resolvedPluginNames(command: "build" | "serve", mode: string): Promise<string[]> {
	const config = await resolveConfig({ configFile: "vite.config.ts", logLevel: "silent" }, command, mode);
	return config.plugins.map((plugin) => plugin.name);
}

describe("native store root switch in builds", () => {
	it("is absent from the production build", async () => {
		expect(await resolvedPluginNames("build", "production")).not.toContain(nativeStoreRootPluginName);
	});

	it("is present on the dev server", async () => {
		expect(await resolvedPluginNames("serve", "development")).toContain(nativeStoreRootPluginName);
	});
});
