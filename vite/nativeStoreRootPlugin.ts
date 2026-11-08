import { createReadStream, existsSync, lstatSync, realpathSync, type Stats } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, type Connect, type Plugin } from "vite";
import { readLaneOwnership } from "../scripts/check-lane-ownership.mjs";

export const NATIVE_STORE_PATH_PATTERN = /^\/l2\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
export const NATIVE_STORE_FIXTURE_NAME = "fixture";
export const NATIVE_STORE_SOURCE_HEADER = "X-Native-Store-Source";

const nativeStorePathPrefix = "/l2/";
const laneOwnershipFilePath = resolve(dirname(fileURLToPath(import.meta.url)), "../.planning/lanes.json");
const laneStoreFolder = "artifacts/lane-store";
const fixtureStoreFolder = "tests/fixtures/lane-store/l2";
const sharedStoreFolder = "public/l2";
const storeRootOnlyFileNames = new Set(["catalog.json", "coverage.json"]);
const nativeStoreContentTypes: Readonly<Record<string, string>> = {
	".json": "application/json",
	".glb": "model/gltf-binary",
	".png": "image/png",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
	".l2asset": "application/zip",
};
const unknownNativeStoreContentType = "application/octet-stream";

export type NativeStoreSource = "lane" | "shared";

export interface NativeStoreRoot {
	readonly rootName: string;
	readonly storeRoot: string;
	readonly sharedStoreRoot: string;
}

interface NativeStoreFile {
	readonly source: NativeStoreSource;
	readonly filePath: string;
	readonly size: number;
}

export function nativeStoreRootNames(): readonly string[] {
	return [...Object.keys(readLaneOwnership(laneOwnershipFilePath).lanes), NATIVE_STORE_FIXTURE_NAME].sort();
}

function comparablePath(path: string): string {
	const resolvedPath = resolve(path);
	return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}

function isSameOrUnderPath(path: string, ancestor: string): boolean {
	const pathFromAncestor = relative(comparablePath(ancestor), comparablePath(path));
	return pathFromAncestor === "" || (!pathFromAncestor.startsWith("..") && !isAbsolute(pathFromAncestor));
}

export function resolveNativeStoreRoot(projectRoot: string, rootName: string): NativeStoreRoot {
	const allowedRootNames = nativeStoreRootNames();
	if (!allowedRootNames.includes(rootName)) {
		throw new Error(`NATIVE_STORE_ROOT ${JSON.stringify(rootName)} is not allowed; use one of ${allowedRootNames.join(", ")}`);
	}
	const storeRoot = rootName === NATIVE_STORE_FIXTURE_NAME ? resolve(projectRoot, fixtureStoreFolder) : resolve(projectRoot, laneStoreFolder, rootName, "l2");
	if (!existsSync(storeRoot)) throw new Error(`NATIVE_STORE_ROOT ${rootName}: lane store not found at ${storeRoot}`);
	const storeRootRealpath = realpathSync.native(storeRoot);
	if (comparablePath(storeRootRealpath) !== comparablePath(storeRoot)) {
		throw new Error(`NATIVE_STORE_ROOT ${rootName}: ${storeRoot} passes through a junction or symlink to ${storeRootRealpath}`);
	}
	const sharedStoreRoot = resolve(projectRoot, sharedStoreFolder);
	if (existsSync(sharedStoreRoot) && isSameOrUnderPath(storeRootRealpath, realpathSync.native(sharedStoreRoot))) {
		throw new Error(`NATIVE_STORE_ROOT ${rootName}: ${storeRoot} lies in the shared store ${sharedStoreRoot}`);
	}
	return { rootName, storeRoot, sharedStoreRoot };
}

export function nativeStoreRootFromEnvironment(mode: string, projectRoot: string): NativeStoreRoot | undefined {
	const rootName = loadEnv(mode, projectRoot, "").NATIVE_STORE_ROOT;
	return rootName ? resolveNativeStoreRoot(projectRoot, rootName) : undefined;
}

export function nativeStoreRequestPath(url: string): string | null | undefined {
	const rawPath = url.split(/[?#]/, 1)[0] ?? "";
	let decodedPath: string;
	try {
		decodedPath = decodeURIComponent(rawPath);
	} catch {
		return rawPath.startsWith(nativeStorePathPrefix) ? null : undefined;
	}
	if (!rawPath.startsWith(nativeStorePathPrefix) && !decodedPath.startsWith(nativeStorePathPrefix)) return undefined;
	return NATIVE_STORE_PATH_PATTERN.test(decodedPath) ? decodedPath : null;
}

export function nativeStoreContentType(fileName: string): string {
	return nativeStoreContentTypes[extname(fileName).toLowerCase()] ?? unknownNativeStoreContentType;
}

function regularFileStats(filePath: string): Stats | undefined {
	try {
		const stats = lstatSync(filePath);
		return stats.isFile() ? stats : undefined;
	} catch {
		return undefined;
	}
}

function confinedNativeStoreFile(source: NativeStoreSource, root: string, relativePath: string): NativeStoreFile | undefined {
	if (!existsSync(root)) return undefined;
	const filePath = resolve(root, relativePath);
	if (comparablePath(filePath) === comparablePath(root) || !isSameOrUnderPath(filePath, root)) return undefined;
	const stats = regularFileStats(filePath);
	if (stats === undefined || !isSameOrUnderPath(realpathSync.native(filePath), realpathSync.native(root))) return undefined;
	return { source, filePath, size: stats.size };
}

function locateNativeStoreFile(nativeStoreRoot: NativeStoreRoot, requestPath: string): NativeStoreFile | undefined {
	const relativePath = requestPath.slice(nativeStorePathPrefix.length);
	const laneFile = confinedNativeStoreFile("lane", nativeStoreRoot.storeRoot, relativePath);
	if (laneFile !== undefined || storeRootOnlyFileNames.has(relativePath)) return laneFile;
	return confinedNativeStoreFile("shared", nativeStoreRoot.sharedStoreRoot, relativePath);
}

function answerWithStatus(response: ServerResponse, statusCode: number): void {
	response.statusCode = statusCode;
	response.setHeader("Cache-Control", "no-store");
	response.end();
}

function sendNativeStoreFile(request: IncomingMessage, response: ServerResponse, nativeStoreFile: NativeStoreFile): void {
	response.statusCode = 200;
	response.setHeader("Content-Type", nativeStoreContentType(nativeStoreFile.filePath));
	response.setHeader("Content-Length", String(nativeStoreFile.size));
	response.setHeader("Accept-Ranges", "bytes");
	response.setHeader("Cache-Control", "no-store");
	response.setHeader(NATIVE_STORE_SOURCE_HEADER, nativeStoreFile.source);
	if (request.method === "HEAD") {
		response.end();
		return;
	}
	createReadStream(nativeStoreFile.filePath)
		.on("error", (error) => response.destroy(error))
		.pipe(response);
}

export function createNativeStoreRequestHandler(nativeStoreRoot: NativeStoreRoot): Connect.NextHandleFunction {
	return (request, response, next) => {
		const requestPath = nativeStoreRequestPath(request.url ?? "");
		if (requestPath === undefined) {
			next();
			return;
		}
		if (requestPath === null) {
			answerWithStatus(response, 400);
			return;
		}
		if (request.method !== "GET" && request.method !== "HEAD") {
			response.setHeader("Allow", "GET, HEAD");
			answerWithStatus(response, 405);
			return;
		}
		const nativeStoreFile = locateNativeStoreFile(nativeStoreRoot, requestPath);
		if (nativeStoreFile === undefined) {
			answerWithStatus(response, 404);
			return;
		}
		sendNativeStoreFile(request, response, nativeStoreFile);
	};
}

export function nativeStoreRootPlugin(): Plugin {
	let nativeStoreRoot: NativeStoreRoot | undefined;
	return {
		name: "native-store-root",
		apply: "serve",
		configResolved(config) {
			nativeStoreRoot = nativeStoreRootFromEnvironment(config.mode, config.root);
		},
		configureServer(server) {
			if (nativeStoreRoot === undefined) return;
			server.config.logger.info(`native store root ${nativeStoreRoot.rootName}: ${nativeStoreRoot.storeRoot}`);
			server.middlewares.use(createNativeStoreRequestHandler(nativeStoreRoot));
		},
	};
}
