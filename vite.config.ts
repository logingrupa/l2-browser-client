// Adapted from the Apache-2.0 Babylon.js Editor v5.5.3 Vanilla template.
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [{
		name: "editor-run-ready",
		configureServer(server) {
			// Editor 5.5.3's project runner waits for the capitalized Ready marker.
			server.httpServer?.once("listening", () => {
				const address = server.httpServer?.address();
				if (address && typeof address !== "string") setTimeout(() => server.config.logger.info(`Ready http://localhost:${address.port}`), 0);
			});
		},
	}],
	server: {
		port: 5173,
		strictPort: true,
		// Native captures/conversion evidence are not application inputs.
		// Watching this large scratch tree delays development-server startup.
		watch: { ignored: ["**/artifacts/**"] },
	},
	build: {
		target: "es2022",
	},
});
