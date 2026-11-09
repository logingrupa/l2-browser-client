import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, readFileSync, realpathSync, type Stats } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadEnv, type Connect, type Plugin } from "vite";
import { readLaneOwnership } from "../scripts/check-lane-ownership.mjs";

export const NATIVE_STORE_PATH_PATTERN = /^\/l2\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
export const NATIVE_STORE_FIXTURE_NAME = "fixture";
export const NATIVE_STORE_SOURCE_HEADER = "X-Native-Store-Source";
export const NATIVE_STORE_LANE_CATALOG_SHA256_HEADER = "X-Native-Store-Lane-Catalog-Sha256";

const runExecutable = promisify(execFile);
const nativeStorePathPrefix = "/l2/";
const laneOwnershipFilePath = resolve(dirname(fileURLToPath(import.meta.url)), "../.planning/lanes.json");
const laneUnionCatalogScriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/native_store/print_lane_union_catalog.py");
const laneUnionCatalogDocumentFields = "laneCatalogSha256,unionCatalogText";
const maximumLaneUnionCatalogDocumentBytes = 3 * 32 * 1024 * 1024;
const laneStoreFolder = "artifacts/lane-store";
const fixtureStoreFolder = "tests/fixtures/lane-store/l2";
const sharedStoreFolder = "public/l2";
const storeCatalogFileName = "catalog.json";
const storeRootOnlyFileNames = new Set([storeCatalogFileName, "coverage.json"]);
const sha256Pattern = /^[0-9a-f]{64}$/;
const nativeStoreContentTypes: Readonly<Record<string, string>> = {
	".json": "application/json",
	".glb": "model/gltf-binary",
	".png": "image/png",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
	".l2asset": "application/zip",
};
const unknownNativeStoreContentType = "application/octet-stream";
const singleByteRangePattern = /^bytes=(\d*)-(\d*)$/;

export type NativeStoreSource = "lane" | "shared" | "union";

export interface NativeStoreRoot {
	readonly rootName: string;
	readonly storeRoot: string;
	readonly sharedStoreRoot: string;
}

export interface SingleByteRange {
	readonly start: number;
	readonly end: number;
}

export interface ServedNativeCatalog {
	readonly source: NativeStoreSource;
	readonly laneCatalogSha256: string;
	readonly bytes: Buffer;
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

export function parseSingleByteRange(header: string | undefined, size: number): SingleByteRange | "unsatisfiable" | null {
	const match = header === undefined ? null : singleByteRangePattern.exec(header.trim());
	if (match === null) return null;
	const [, startText = "", endText = ""] = match;
	if (startText === "" && endText === "") return null;
	if (startText === "") {
		const suffixLength = Number(endText);
		return suffixLength === 0 || size === 0 ? "unsatisfiable" : { start: Math.max(0, size - suffixLength), end: size - 1 };
	}
	const start = Number(startText);
	if (endText !== "" && Number(endText) < start) return null;
	if (start >= size) return "unsatisfiable";
	return { start, end: endText === "" ? size - 1 : Math.min(Number(endText), size - 1) };
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

function locateNativeStoreFile(nativeStoreRoot: NativeStoreRoot, relativePath: string): NativeStoreFile | undefined {
	const laneFile = confinedNativeStoreFile("lane", nativeStoreRoot.storeRoot, relativePath);
	if (laneFile !== undefined || storeRootOnlyFileNames.has(relativePath)) return laneFile;
	return confinedNativeStoreFile("shared", nativeStoreRoot.sharedStoreRoot, relativePath);
}

function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLaneUnionCatalogDocument(text: string, rootName: string): ServedNativeCatalog {
	const refuse = (problem: string) => new Error(`NATIVE_STORE_ROOT ${rootName}: lane union catalog document refused: ${problem}`);
	let document: unknown;
	try {
		document = JSON.parse(text);
	} catch (error) {
		throw refuse(error instanceof Error ? error.message : String(error));
	}
	if (!isPlainObject(document) || Object.keys(document).sort().join(",") !== laneUnionCatalogDocumentFields) {
		throw refuse(`fields must be exactly ${laneUnionCatalogDocumentFields}`);
	}
	const { laneCatalogSha256, unionCatalogText } = document;
	if (typeof laneCatalogSha256 !== "string" || !sha256Pattern.test(laneCatalogSha256)) throw refuse("laneCatalogSha256 is not 64 lowercase hex digits");
	if (typeof unionCatalogText !== "string" || unionCatalogText === "") throw refuse("unionCatalogText is not a non-empty string");
	return { source: "union", laneCatalogSha256, bytes: Buffer.from(unionCatalogText, "utf8") };
}

function commandFailureText(error: unknown): string {
	const standardError = isPlainObject(error) && typeof error.stderr === "string" ? error.stderr.trim() : "";
	return standardError || (error instanceof Error ? error.message : String(error));
}

async function readLaneUnionCatalog(nativeStoreRoot: NativeStoreRoot): Promise<ServedNativeCatalog> {
	const commandArguments = ["-B", laneUnionCatalogScriptPath, "--lane-store", nativeStoreRoot.storeRoot, "--shared-store", nativeStoreRoot.sharedStoreRoot];
	let standardOutput: string;
	try {
		({ stdout: standardOutput } = await runExecutable("python", commandArguments,
			{ encoding: "utf8", maxBuffer: maximumLaneUnionCatalogDocumentBytes, windowsHide: true }));
	} catch (error) {
		throw new Error(`NATIVE_STORE_ROOT ${nativeStoreRoot.rootName}: ${commandFailureText(error)}`);
	}
	return parseLaneUnionCatalogDocument(standardOutput, nativeStoreRoot.rootName);
}

export async function readServedNativeCatalog(nativeStoreRoot: NativeStoreRoot): Promise<ServedNativeCatalog | undefined> {
	const laneCatalogFile = confinedNativeStoreFile("lane", nativeStoreRoot.storeRoot, storeCatalogFileName);
	if (laneCatalogFile === undefined) return undefined;
	if (nativeStoreRoot.rootName !== NATIVE_STORE_FIXTURE_NAME) return readLaneUnionCatalog(nativeStoreRoot);
	const bytes = readFileSync(laneCatalogFile.filePath);
	return { source: "lane", laneCatalogSha256: sha256Hex(bytes), bytes };
}

function answerWithStatus(response: ServerResponse, statusCode: number, reason = ""): void {
	response.statusCode = statusCode;
	response.setHeader("Cache-Control", "no-store");
	if (reason !== "") response.setHeader("Content-Type", "text/plain; charset=utf-8");
	response.end(reason);
}

function sendNativeStoreBody(request: IncomingMessage, response: ServerResponse, source: NativeStoreSource, fileName: string, size: number,
	writeBody: (servedRange: SingleByteRange) => void): void {
	response.setHeader("Content-Type", nativeStoreContentType(fileName));
	response.setHeader("Accept-Ranges", "bytes");
	response.setHeader("Cache-Control", "no-store");
	response.setHeader(NATIVE_STORE_SOURCE_HEADER, source);
	const byteRange = parseSingleByteRange(request.headers.range, size);
	if (byteRange === "unsatisfiable") {
		response.statusCode = 416;
		response.setHeader("Content-Range", `bytes */${size}`);
		response.end();
		return;
	}
	const servedRange = byteRange ?? { start: 0, end: size - 1 };
	response.statusCode = byteRange === null ? 200 : 206;
	if (byteRange !== null) response.setHeader("Content-Range", `bytes ${byteRange.start}-${byteRange.end}/${size}`);
	response.setHeader("Content-Length", String(Math.max(0, servedRange.end - servedRange.start + 1)));
	if (request.method === "HEAD" || size === 0) {
		response.end();
		return;
	}
	writeBody(servedRange);
}

function sendNativeStoreFile(request: IncomingMessage, response: ServerResponse, nativeStoreFile: NativeStoreFile): void {
	sendNativeStoreBody(request, response, nativeStoreFile.source, nativeStoreFile.filePath, nativeStoreFile.size, (servedRange) => {
		createReadStream(nativeStoreFile.filePath, servedRange)
			.on("error", (error) => response.destroy(error))
			.pipe(response);
	});
}

async function sendServedNativeCatalog(request: IncomingMessage, response: ServerResponse, nativeStoreRoot: NativeStoreRoot): Promise<void> {
	let servedCatalog: ServedNativeCatalog | undefined;
	try {
		servedCatalog = await readServedNativeCatalog(nativeStoreRoot);
	} catch (error) {
		answerWithStatus(response, 409, error instanceof Error ? error.message : String(error));
		return;
	}
	if (servedCatalog === undefined) {
		answerWithStatus(response, 404);
		return;
	}
	const { bytes } = servedCatalog;
	response.setHeader(NATIVE_STORE_LANE_CATALOG_SHA256_HEADER, servedCatalog.laneCatalogSha256);
	sendNativeStoreBody(request, response, servedCatalog.source, storeCatalogFileName, bytes.length,
		(servedRange) => response.end(bytes.subarray(servedRange.start, servedRange.end + 1)));
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
		const relativePath = requestPath.slice(nativeStorePathPrefix.length);
		if (relativePath === storeCatalogFileName) {
			void sendServedNativeCatalog(request, response, nativeStoreRoot);
			return;
		}
		const nativeStoreFile = locateNativeStoreFile(nativeStoreRoot, relativePath);
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
		async configureServer(server) {
			if (nativeStoreRoot === undefined) return;
			const servedCatalog = await readServedNativeCatalog(nativeStoreRoot);
			const catalogText = servedCatalog === undefined ? "no catalog" : `${servedCatalog.source} catalog of lane catalog ${servedCatalog.laneCatalogSha256}`;
			server.config.logger.info(`native store root ${nativeStoreRoot.rootName}: ${nativeStoreRoot.storeRoot} (${catalogText})`);
			server.middlewares.use(createNativeStoreRequestHandler(nativeStoreRoot));
		},
	};
}
