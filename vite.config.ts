// Adapted from the Apache-2.0 Babylon.js Editor v5.5.3 Vanilla template.
import { cpSync, existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

export const buildExcludedPublicPaths = ["assets/characters", "assets/world"] as const;

const editorProjectRunnerReadyMarker = "Ready";
const unwatchedNativeEvidenceScratchTree = "**/artifacts/**";
const keepBundleOutputOverCollidingPublicFile = { force: false, errorOnExist: false } as const;

export function isBuildExcludedPublicPath(publicDir: string, source: string): boolean {
	const path = relative(publicDir, source).split(sep).join("/");
	return buildExcludedPublicPaths.some(excluded => path === excluded || path.startsWith(`${excluded}/`));
}

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

function copyPublicDirWithoutLineagenMediaInPlaceOfViteCopy(): Plugin {
	let publicDir = "", outDir = "";
	return {
		name: "public-without-lineagen-media",
		apply: "build",
		configResolved(config) { publicDir = config.publicDir; outDir = resolve(config.root, config.build.outDir); },
		writeBundle() {
			if (!publicDir || !existsSync(publicDir)) return;
			cpSync(publicDir, outDir, { recursive: true, ...keepBundleOutputOverCollidingPublicFile, filter: source => !isBuildExcludedPublicPath(publicDir, source) });
		},
	};
}

export default defineConfig(({ mode }) => ({
	plugins: [announceReadyToEditorProjectRunner(), copyPublicDirWithoutLineagenMediaInPlaceOfViteCopy()],
	server: {
		port: Number(loadEnv(mode, process.cwd(), "").DEV_PORT || 5173),
		strictPort: true,
		watch: { ignored: [unwatchedNativeEvidenceScratchTree] },
	},
	build: {
		target: "es2022",
		copyPublicDir: false,
	},
}));
