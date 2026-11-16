import { describe, expect, it } from "vitest";
import { buildPrivatePreviewNginxConfig, devServerPort } from "../../scripts/private-preview-nginx-config.mjs";
import { privatePreviewWorldPath } from "../../scripts/private-preview-targets.mjs";

const accessKey = "a".repeat(64);
const configurationInputs = {
	key: accessKey,
	pidFile: "C:\\preview\\nginx.pid",
	directory: "C:\\preview",
	nginxExecutable: "C:/laragon/bin/nginx/nginx-1.22.0/nginx.exe",
	distDirectory: "C:\\project\\dist",
	cookieName: "__Host-l2_preview",
	hostname: "l2.kingdom.lv",
	port: 8189,
};

describe("private preview nginx config", () => {
	it("serves only the static build and hides source files in static mode", () => {
		const configuration = buildPrivatePreviewNginxConfig({ ...configurationInputs, mode: "static" });
		expect(configuration).toContain('root "C:/project/dist";');
		expect(configuration).toContain("try_files $uri $uri/ =404;");
		expect(configuration).toContain("\\.(map|ts|tsx|jsx|mjs|cjs)$ { return 404; }");
		expect(configuration).not.toContain("proxy_pass");
	});

	it("proxies to the dev server with websocket upgrade and no source hiding in dev mode", () => {
		const configuration = buildPrivatePreviewNginxConfig({ ...configurationInputs, mode: "dev" });
		expect(configuration).toContain(`proxy_pass http://127.0.0.1:${devServerPort};`);
		expect(configuration).toContain(`proxy_set_header Host 127.0.0.1:${devServerPort};`);
		expect(configuration).toContain("proxy_set_header Upgrade $http_upgrade;");
		expect(configuration).toContain("map $http_upgrade $connection_upgrade");
		expect(configuration).not.toContain("try_files");
		expect(configuration).not.toContain("root ");
		expect(configuration).not.toContain("{ return 404; }");
	});

	it.each(["static", "dev"] as const)("keeps the invitation gate in front of every location in %s mode", (mode) => {
		const configuration = buildPrivatePreviewNginxConfig({ ...configurationInputs, mode });
		const gateIndex = configuration.indexOf("if ($preview_allowed = 0) { return 403; }");
		expect(gateIndex).toBeGreaterThan(-1);
		expect(gateIndex).toBeLessThan(configuration.indexOf("location / "));
		expect(configuration).toContain("if ($request_method !~ ^(GET|HEAD)$) { return 403; }");
		expect(configuration).toContain("listen 127.0.0.1:8189 default_server");
		expect(configuration).toContain(`${configurationInputs.cookieName}=${accessKey}`);
	});

	it.each(["static", "dev"] as const)("redirects a valid invite to the code-built world in %s mode", (mode) => {
		expect(privatePreviewWorldPath).toBe("/");
		expect(buildPrivatePreviewNginxConfig({ ...configurationInputs, mode })).toContain(`return 303 "${privatePreviewWorldPath}";`);
	});

	it("refuses an unknown mode", () => {
		expect(() => buildPrivatePreviewNginxConfig({ ...configurationInputs, mode: "production" })).toThrow("Unknown private preview mode: production");
	});
});
