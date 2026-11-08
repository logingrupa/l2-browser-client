import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, request as sendHttpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { nativeResourceUrl } from "../../src/assets/native/nativeResourceUrl";
import {
	NATIVE_STORE_FIXTURE_NAME,
	NATIVE_STORE_PATH_PATTERN,
	createNativeStoreRequestHandler,
	nativeStoreContentType,
	nativeStoreRequestPath,
	nativeStoreRootFromEnvironment,
	nativeStoreRootNames,
	parseSingleByteRange,
	resolveNativeStoreRoot,
} from "../../vite/nativeStoreRootPlugin";

const archiveSha256 = "a".repeat(64);
const sharedOnlySha256 = "b".repeat(64);
const musicTrackPath = `/l2/world-audio/${"d".repeat(64)}/track.ogg`;
const musicTrackBytes = Uint8Array.from({ length: 100 }, (_, index) => index);
const temporaryFolders: string[] = [];

function temporaryFolder(): string {
	const folder = mkdtempSync(join(tmpdir(), "native-store-root-"));
	temporaryFolders.push(folder);
	return folder;
}

function writeProjectFile(projectRoot: string, relativePath: string, content: string | Uint8Array): void {
	const filePath = resolve(projectRoot, relativePath);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, content);
}

function laneStoreProject(): string {
	const projectRoot = temporaryFolder();
	writeProjectFile(projectRoot, "package.json", "{\"name\":\"outside-the-store\"}");
	writeProjectFile(projectRoot, "artifacts/lane-store/world/l2/catalog.json", "{\"schemaVersion\":1,\"lane\":true}");
	writeProjectFile(projectRoot, `artifacts/lane-store/world/l2/${archiveSha256}/asset.l2asset`, new Uint8Array([1, 2, 3, 4]));
	writeProjectFile(projectRoot, `artifacts/lane-store/world${musicTrackPath}`, musicTrackBytes);
	writeProjectFile(projectRoot, "public/l2/catalog.json", "{\"schemaVersion\":1,\"shared\":true}");
	writeProjectFile(projectRoot, "public/l2/coverage.json", "{\"shared\":true}");
	writeProjectFile(projectRoot, `public/l2/${sharedOnlySha256}/asset.l2asset`, new Uint8Array([9, 8, 7]));
	return projectRoot;
}

function makeJunction(target: string, link: string): string | undefined {
	mkdirSync(dirname(link), { recursive: true });
	try {
		symlinkSync(target, link, "junction");
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

afterEach(() => {
	vi.unstubAllEnvs();
});

afterAll(() => {
	for (const folder of temporaryFolders) rmSync(folder, { recursive: true, force: true });
});

describe("native store root names and resolution", () => {
	it("allows the lanes.json keys plus fixture", () => {
		expect(nativeStoreRootNames()).toEqual(["actors", "data-ui", "fixture", "integration", "world"]);
	});

	it("resolves the committed fixture store", () => {
		const nativeStoreRoot = resolveNativeStoreRoot(process.cwd(), NATIVE_STORE_FIXTURE_NAME);
		expect(nativeStoreRoot).toEqual({
			rootName: "fixture",
			storeRoot: resolve("tests/fixtures/lane-store/l2"),
			sharedStoreRoot: resolve("public/l2"),
		});
	});

	it("resolves a lane to its artifacts lane store", () => {
		const projectRoot = laneStoreProject();
		expect(resolveNativeStoreRoot(projectRoot, "world").storeRoot).toBe(resolve(projectRoot, "artifacts/lane-store/world/l2"));
	});

	it("refuses an unknown name and lists the allowed ones", () => {
		expect(() => resolveNativeStoreRoot(laneStoreProject(), "plan")).toThrow("actors, data-ui, fixture, integration, world");
	});

	it("refuses a lane whose store folder is missing", () => {
		expect(() => resolveNativeStoreRoot(laneStoreProject(), "actors")).toThrow("lane store not found");
	});

	it("refuses a lane root reached through a junction", (context) => {
		const projectRoot = temporaryFolder();
		const outsideStore = temporaryFolder();
		const junctionError = makeJunction(outsideStore, resolve(projectRoot, "artifacts/lane-store/world/l2"));
		if (junctionError !== undefined) context.skip(`cannot create a junction here: ${junctionError}`);
		expect(() => resolveNativeStoreRoot(projectRoot, "world")).toThrow("junction or symlink");
	});

	it("refuses a lane root that is the realpath of public/l2", (context) => {
		const projectRoot = temporaryFolder();
		const laneRoot = resolve(projectRoot, "artifacts/lane-store/world/l2");
		mkdirSync(laneRoot, { recursive: true });
		const junctionError = makeJunction(laneRoot, resolve(projectRoot, "public/l2"));
		if (junctionError !== undefined) context.skip(`cannot create a junction here: ${junctionError}`);
		expect(() => resolveNativeStoreRoot(projectRoot, "world")).toThrow("lies in the shared store");
	});

	it("does nothing when NATIVE_STORE_ROOT is unset and refuses an unknown value", () => {
		const projectRoot = laneStoreProject();
		vi.stubEnv("NATIVE_STORE_ROOT", undefined);
		expect(nativeStoreRootFromEnvironment("development", projectRoot)).toBeUndefined();
		vi.stubEnv("NATIVE_STORE_ROOT", "world");
		expect(nativeStoreRootFromEnvironment("development", projectRoot)?.rootName).toBe("world");
		vi.stubEnv("NATIVE_STORE_ROOT", "plan");
		expect(() => nativeStoreRootFromEnvironment("development", projectRoot)).toThrow("is not allowed");
	});
});

describe("native store request paths and content types", () => {
	it("leaves other paths alone and refuses bad /l2/ paths", () => {
		expect(nativeStoreRequestPath("/assets/x")).toBeUndefined();
		expect(nativeStoreRequestPath("/l2/catalog.json?v=1")).toBe("/l2/catalog.json");
		expect(nativeStoreRequestPath("/l2/%2e%2e/package.json")).toBeNull();
		expect(nativeStoreRequestPath("/l2/..%2fpackage.json")).toBeNull();
		expect(nativeStoreRequestPath("/l2/%E0%A4%A")).toBeNull();
		expect(nativeStoreRequestPath("/l2/")).toBeNull();
	});

	it("accepts and refuses the same paths as nativeResourceUrl", () => {
		const agreementCases = ["/l2/catalog.json", "/l2/a/b.glb", "/l2/.hidden", "/l2/a/../b", "/l2/a//b", "/l2/a b", "/l2/", "/l3/a", "/l2/a%2Fb"];
		const browserAccepts = (path: string) => {
			try {
				nativeResourceUrl(path);
				return true;
			} catch {
				return false;
			}
		};
		expect(agreementCases.map((path) => NATIVE_STORE_PATH_PATTERN.test(path))).toEqual(agreementCases.map(browserAccepts));
		expect(agreementCases.map(browserAccepts)).toEqual([true, true, false, false, false, false, false, false, false]);
	});

	it("copies the regex source text of nativeResourceUrl.ts", () => {
		expect(readFileSync("src/assets/native/nativeResourceUrl.ts", "utf8")).toContain(`/${NATIVE_STORE_PATH_PATTERN.source}/`);
	});

	it("parses one satisfiable byte range", () => {
		expect(parseSingleByteRange("bytes=0-15", 100)).toEqual({ start: 0, end: 15 });
		expect(parseSingleByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
		expect(parseSingleByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
		expect(parseSingleByteRange("bytes=0-200", 100)).toEqual({ start: 0, end: 99 });
	});

	it("marks ranges past the end unsatisfiable and ignores several or malformed ranges", () => {
		expect(parseSingleByteRange("bytes=100-", 100)).toBe("unsatisfiable");
		expect(parseSingleByteRange("bytes=-0", 100)).toBe("unsatisfiable");
		for (const header of ["bytes=0-1,4-5", "items=0-1", "bytes=5-2", undefined]) expect(parseSingleByteRange(header, 100)).toBeNull();
	});

	it("maps file extensions to content types", () => {
		expect(["a.json", "a.glb", "a.png", "a.ogg", "a.wav", "a.l2asset", "a.bin"].map(nativeStoreContentType)).toEqual([
			"application/json",
			"model/gltf-binary",
			"image/png",
			"audio/ogg",
			"audio/wav",
			"application/zip",
			"application/octet-stream",
		]);
	});
});

interface RawAnswer {
	readonly status: number;
	readonly headers: Record<string, string | string[] | undefined>;
	readonly body: Buffer;
}

function rawRequest(server: Server, method: string, path: string, headers: Record<string, string> = {}): Promise<RawAnswer> {
	const { port } = server.address() as AddressInfo;
	return new Promise((resolveAnswer, rejectAnswer) => {
		const outgoing = sendHttpRequest({ host: "127.0.0.1", port, method, path, headers }, (incoming) => {
			const chunks: Buffer[] = [];
			incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
			incoming.on("end", () => resolveAnswer({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: Buffer.concat(chunks) }));
			incoming.on("error", rejectAnswer);
		});
		outgoing.on("error", rejectAnswer);
		outgoing.end();
	});
}

describe("native store request handler", () => {
	let server: Server;

	beforeAll(async () => {
		const handler = createNativeStoreRequestHandler(resolveNativeStoreRoot(laneStoreProject(), "world"));
		server = createServer((request, response) => {
			handler(request, response, () => {
				response.statusCode = 299;
				response.end("next");
			});
		});
		await new Promise<void>((resolveListening) => server.listen(0, "127.0.0.1", resolveListening));
	});

	afterAll(async () => {
		await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
	});

	it("serves the catalog from the lane root", async () => {
		const answer = await rawRequest(server, "GET", "/l2/catalog.json");
		expect(answer.status).toBe(200);
		expect(answer.body.toString("utf8")).toBe("{\"schemaVersion\":1,\"lane\":true}");
		expect(answer.headers["x-native-store-source"]).toBe("lane");
		expect(answer.headers["content-type"]).toBe("application/json");
		expect(answer.headers["cache-control"]).toBe("no-store");
		expect(answer.headers["accept-ranges"]).toBe("bytes");
	});

	it("never takes coverage from the shared store", async () => {
		expect((await rawRequest(server, "GET", "/l2/coverage.json")).status).toBe(404);
	});

	it("serves lane archives from the lane and other hash paths from the shared store", async () => {
		const laneAnswer = await rawRequest(server, "GET", `/l2/${archiveSha256}/asset.l2asset`);
		expect([laneAnswer.status, laneAnswer.headers["x-native-store-source"], laneAnswer.headers["content-type"]]).toEqual([200, "lane", "application/zip"]);
		expect([...laneAnswer.body]).toEqual([1, 2, 3, 4]);
		const sharedAnswer = await rawRequest(server, "GET", `/l2/${sharedOnlySha256}/asset.l2asset`);
		expect([sharedAnswer.status, sharedAnswer.headers["x-native-store-source"]]).toEqual([200, "shared"]);
		expect([...sharedAnswer.body]).toEqual([9, 8, 7]);
	});

	it("answers 404 for a path in neither store", async () => {
		expect((await rawRequest(server, "GET", `/l2/${"c".repeat(64)}/asset.l2asset`)).status).toBe(404);
	});

	it("answers 400 for encoded traversal", async () => {
		expect((await rawRequest(server, "GET", "/l2/%2e%2e/package.json")).status).toBe(400);
		expect((await rawRequest(server, "GET", "/l2/..%2fpackage.json")).status).toBe(400);
		expect((await rawRequest(server, "GET", "/l2/%2e%2e/%2e%2e/%2e%2e/package.json")).status).toBe(400);
	});

	it("answers 405 for other methods", async () => {
		const answer = await rawRequest(server, "POST", "/l2/catalog.json");
		expect([answer.status, answer.headers.allow]).toEqual([405, "GET, HEAD"]);
	});

	it("answers a single byte range with 206 and Content-Range", async () => {
		const answer = await rawRequest(server, "GET", musicTrackPath, { Range: "bytes=0-15" });
		expect([answer.status, answer.headers["content-range"], answer.headers["content-length"], answer.headers["content-type"]]).toEqual([206, "bytes 0-15/100", "16", "audio/ogg"]);
		expect([...answer.body]).toEqual([...musicTrackBytes.slice(0, 16)]);
	});

	it("answers an unsatisfiable range with 416 and the size", async () => {
		const answer = await rawRequest(server, "GET", musicTrackPath, { Range: "bytes=100-" });
		expect([answer.status, answer.headers["content-range"], answer.body.length]).toEqual([416, "bytes */100", 0]);
	});

	it("answers several ranges with the whole file", async () => {
		const answer = await rawRequest(server, "GET", musicTrackPath, { Range: "bytes=0-1,4-5" });
		expect([answer.status, answer.headers["content-range"]]).toEqual([200, undefined]);
		expect([...answer.body]).toEqual([...musicTrackBytes]);
	});

	it("answers HEAD with headers only", async () => {
		const answer = await rawRequest(server, "HEAD", musicTrackPath);
		expect([answer.status, answer.headers["content-length"], answer.headers["x-native-store-source"], answer.body.length]).toEqual([200, "100", "lane", 0]);
	});

	it("passes paths outside /l2/ to the next middleware", async () => {
		const answer = await rawRequest(server, "GET", "/assets/x");
		expect([answer.status, answer.body.toString("utf8")]).toEqual([299, "next"]);
	});
});
