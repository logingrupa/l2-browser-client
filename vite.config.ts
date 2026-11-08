import { defineConfig, loadEnv, type Plugin } from "vite";

const editorProjectRunnerReadyMarker = "Ready";
const unwatchedNativeEvidenceScratchTree = "**/artifacts/**";

function announceReadyToEditorProjectRunner(): Plugin {
	return {
		name: "editor-run-ready",
		configureServer(server) {
			server.httpServer?.once("listening", () => {
				const address = server.httpServer?.address();
				if (address && typeof address !== "string") setTimeout(() => server.config.logger.info(`${editorProjectRunnerReadyMarker} http://localhost:${address.port}`), 0);
			});
		},
	};
}

export default defineConfig(({ mode }) => ({
	plugins: [announceReadyToEditorProjectRunner()],
	server: {
		port: Number(loadEnv(mode, process.cwd(), "").DEV_PORT || 5173),
		strictPort: true,
		watch: { ignored: [unwatchedNativeEvidenceScratchTree] },
	},
	build: {
		target: "es2022",
	},
}));
