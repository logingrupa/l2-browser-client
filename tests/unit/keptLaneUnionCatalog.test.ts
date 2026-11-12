import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { NATIVE_STORE_LANE_CATALOG_SHA256_HEADER } from "../../src/assets/native/nativeStoreLaneCatalogHeader";
import {
	NATIVE_STORE_SOURCE_HEADER,
	createKeptLaneUnionCatalogReader,
	createNativeStoreRequestHandler,
	resolveNativeStoreRoot,
	type LaneUnionCatalogBuild,
	type NativeStoreRoot,
	type ServedNativeCatalog,
} from "../../vite/nativeStoreRootPlugin";

const catalogFileName = "catalog.json";
const catalogRequestPath = "/l2/catalog.json";
const laneStoreFolder = "artifacts/lane-store/world/l2";
const sharedStoreFolder = "public/l2";
const sharedCatalogText = "{\"models\":[{\"id\":\"shared:model\"}],\"schemaVersion\":1}\n";
const fixedModificationTime = new Date("2001-02-03T04:05:06Z");
const temporaryFolders: string[] = [];
const listeningServers: Server[] = [];

function temporaryFolder(): string {
	const folder = mkdtempSync(join(tmpdir(), "kept-lane-union-catalog-"));
	temporaryFolders.push(folder);
	return folder;
}

function sha256Hex(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function writeCatalogFile(storeRoot: string, content: string): void {
	mkdirSync(storeRoot, { recursive: true });
	writeFileSync(join(storeRoot, catalogFileName), content);
}

function catalogFileRoot(): NativeStoreRoot {
	const folder = temporaryFolder();
	const nativeStoreRoot = { rootName: "world", storeRoot: join(folder, "lane"), sharedStoreRoot: join(folder, "shared") };
	writeCatalogFile(nativeStoreRoot.storeRoot, "lane");
	writeCatalogFile(nativeStoreRoot.sharedStoreRoot, "shared");
	return nativeStoreRoot;
}

function servedCatalogNamed(name: string): ServedNativeCatalog {
	return { source: "union", laneCatalogSha256: sha256Hex(name), bytes: Buffer.from(name, "utf8") };
}

function countingBuild() {
	return vi.fn<LaneUnionCatalogBuild>(async (nativeStoreRoot) => servedCatalogNamed(nativeStoreRoot.storeRoot));
}

interface DeferredBuild {
	readonly servedCatalog: Promise<ServedNativeCatalog>;
	readonly resolveBuild: (servedCatalog: ServedNativeCatalog) => void;
	readonly rejectBuild: (error: Error) => void;
}

function deferredBuild(): DeferredBuild {
	let resolveBuild: DeferredBuild["resolveBuild"] = () => undefined;
	let rejectBuild: DeferredBuild["rejectBuild"] = () => undefined;
	const servedCatalog = new Promise<ServedNativeCatalog>((resolvePromise, rejectPromise) => {
		resolveBuild = resolvePromise;
		rejectBuild = rejectPromise;
	});
	return { servedCatalog, resolveBuild, rejectBuild };
}

function laneCatalogText(modelIds: readonly string[]): string {
	const models = modelIds.map((modelId) => `{"id":"${modelId}"}`).join(",");
	return `{"models":[${models}],"schemaVersion":1,"sourceCatalogSha256":"${sha256Hex(sharedCatalogText)}"}`;
}

function laneStoreProject(laneCatalog: string): string {
	const projectRoot = temporaryFolder();
	writeCatalogFile(resolve(projectRoot, laneStoreFolder), laneCatalog);
	writeCatalogFile(resolve(projectRoot, sharedStoreFolder), sharedCatalogText);
	return projectRoot;
}

async function catalogUrlOfLaneStoreServer(projectRoot: string): Promise<string> {
	const handler = createNativeStoreRequestHandler(resolveNativeStoreRoot(projectRoot, "world"));
	const server = createServer((request, response) => handler(request, response, () => response.end()));
	listeningServers.push(server);
	await new Promise<void>((resolveListening) => server.listen(0, "127.0.0.1", resolveListening));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}${catalogRequestPath}`;
}

interface CatalogAnswer {
	readonly status: number;
	readonly body: string;
	readonly cacheControl: string | null;
	readonly source: string | null;
	readonly laneCatalogSha256: string | null;
	readonly contentType: string | null;
	readonly acceptRanges: string | null;
	readonly contentLength: string | null;
}

async function requestCatalog(catalogUrl: string, method: "GET" | "HEAD"): Promise<CatalogAnswer> {
	const answer = await fetch(catalogUrl, { method });
	return {
		status: answer.status,
		body: await answer.text(),
		cacheControl: answer.headers.get("Cache-Control"),
		source: answer.headers.get(NATIVE_STORE_SOURCE_HEADER),
		laneCatalogSha256: answer.headers.get(NATIVE_STORE_LANE_CATALOG_SHA256_HEADER),
		contentType: answer.headers.get("Content-Type"),
		acceptRanges: answer.headers.get("Accept-Ranges"),
		contentLength: answer.headers.get("Content-Length"),
	};
}

afterEach(async () => {
	for (const server of listeningServers.splice(0)) {
		server.closeAllConnections();
		await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
	}
});

afterAll(() => {
	for (const folder of temporaryFolders) rmSync(folder, { recursive: true, force: true });
});

describe("kept lane union catalog reader", () => {
	it("builds once for many requests while both catalog files keep their identity", async () => {
		const nativeStoreRoot = catalogFileRoot();
		const buildLaneUnionCatalog = countingBuild();
		const readLaneUnionCatalog = createKeptLaneUnionCatalogReader(buildLaneUnionCatalog);
		const answers: ServedNativeCatalog[] = [];
		for (let requestNumber = 0; requestNumber < 5; requestNumber += 1) answers.push(await readLaneUnionCatalog(nativeStoreRoot));
		expect(buildLaneUnionCatalog).toHaveBeenCalledTimes(1);
		expect(buildLaneUnionCatalog).toHaveBeenCalledWith(nativeStoreRoot);
		for (const answer of answers) expect(answer).toBe(answers[0]);
	});

	it("builds again after the lane catalog file changes", async () => {
		const nativeStoreRoot = catalogFileRoot();
		const buildLaneUnionCatalog = countingBuild();
		const readLaneUnionCatalog = createKeptLaneUnionCatalogReader(buildLaneUnionCatalog);
		const firstAnswer = await readLaneUnionCatalog(nativeStoreRoot);
		writeCatalogFile(nativeStoreRoot.storeRoot, "lane with another length");
		const answerAfterRewrite = await readLaneUnionCatalog(nativeStoreRoot);
		expect(buildLaneUnionCatalog).toHaveBeenCalledTimes(2);
		expect(answerAfterRewrite).not.toBe(firstAnswer);
		utimesSync(join(nativeStoreRoot.storeRoot, catalogFileName), fixedModificationTime, fixedModificationTime);
		const answerAfterTimeChange = await readLaneUnionCatalog(nativeStoreRoot);
		expect(buildLaneUnionCatalog).toHaveBeenCalledTimes(3);
		expect(answerAfterTimeChange).not.toBe(answerAfterRewrite);
		expect(await readLaneUnionCatalog(nativeStoreRoot)).toBe(answerAfterTimeChange);
		expect(buildLaneUnionCatalog).toHaveBeenCalledTimes(3);
	});

	it("builds again after the shared catalog file changes, appears or disappears", async () => {
		const nativeStoreRoot = catalogFileRoot();
		const sharedCatalogFilePath = join(nativeStoreRoot.sharedStoreRoot, catalogFileName);
		const buildLaneUnionCatalog = countingBuild();
		const readLaneUnionCatalog = createKeptLaneUnionCatalogReader(buildLaneUnionCatalog);
		await readLaneUnionCatalog(nativeStoreRoot);
		writeCatalogFile(nativeStoreRoot.sharedStoreRoot, "shared with another length");
		await readLaneUnionCatalog(nativeStoreRoot);
		expect(buildLaneUnionCatalog).toHaveBeenCalledTimes(2);
		utimesSync(sharedCatalogFilePath, fixedModificationTime, fixedModificationTime);
		await readLaneUnionCatalog(nativeStoreRoot);
		expect(buildLaneUnionCatalog).toHaveBeenCalledTimes(3);
		rmSync(sharedCatalogFilePath);
		const answerWithoutSharedCatalog = await readLaneUnionCatalog(nativeStoreRoot);
		expect(buildLaneUnionCatalog).toHaveBeenCalledTimes(4);
		expect(await readLaneUnionCatalog(nativeStoreRoot)).toBe(answerWithoutSharedCatalog);
		expect(buildLaneUnionCatalog).toHaveBeenCalledTimes(4);
		writeCatalogFile(nativeStoreRoot.sharedStoreRoot, "shared");
		await readLaneUnionCatalog(nativeStoreRoot);
		expect(buildLaneUnionCatalog).toHaveBeenCalledTimes(5);
	});

	it("shares one running build among requests that arrive before it ends", async () => {
		const nativeStoreRoot = catalogFileRoot();
		const runningBuild = deferredBuild();
		const buildLaneUnionCatalog = vi.fn<LaneUnionCatalogBuild>(() => runningBuild.servedCatalog);
		const readLaneUnionCatalog = createKeptLaneUnionCatalogReader(buildLaneUnionCatalog);
		const pendingAnswers = [readLaneUnionCatalog(nativeStoreRoot), readLaneUnionCatalog(nativeStoreRoot), readLaneUnionCatalog(nativeStoreRoot)];
		const servedCatalog = servedCatalogNamed("shared build");
		runningBuild.resolveBuild(servedCatalog);
		const answers = await Promise.all(pendingAnswers);
		expect(buildLaneUnionCatalog).toHaveBeenCalledTimes(1);
		expect(answers).toHaveLength(3);
		for (const answer of answers) expect(answer).toBe(servedCatalog);
	});

	it("does not keep a failed build", async () => {
		const nativeStoreRoot = catalogFileRoot();
		const buildFailure = new Error("the first build failed");
		const servedCatalog = servedCatalogNamed("second build");
		const buildLaneUnionCatalog = vi.fn<LaneUnionCatalogBuild>().mockRejectedValueOnce(buildFailure).mockResolvedValue(servedCatalog);
		const readLaneUnionCatalog = createKeptLaneUnionCatalogReader(buildLaneUnionCatalog);
		await expect(readLaneUnionCatalog(nativeStoreRoot)).rejects.toBe(buildFailure);
		expect(await readLaneUnionCatalog(nativeStoreRoot)).toBe(servedCatalog);
		expect(buildLaneUnionCatalog).toHaveBeenCalledTimes(2);
		expect(await readLaneUnionCatalog(nativeStoreRoot)).toBe(servedCatalog);
		expect(buildLaneUnionCatalog).toHaveBeenCalledTimes(2);
	});

	it("a failed older build does not drop the answer of a newer build", async () => {
		const nativeStoreRoot = catalogFileRoot();
		const olderBuild = deferredBuild();
		const olderBuildFailure = new Error("the older build failed");
		const newerServedCatalog = servedCatalogNamed("newer build");
		const buildLaneUnionCatalog = vi.fn<LaneUnionCatalogBuild>().mockReturnValueOnce(olderBuild.servedCatalog).mockResolvedValue(newerServedCatalog);
		const readLaneUnionCatalog = createKeptLaneUnionCatalogReader(buildLaneUnionCatalog);
		const olderOutcome = readLaneUnionCatalog(nativeStoreRoot).then(() => "resolved", (error: unknown) => error);
		writeCatalogFile(nativeStoreRoot.storeRoot, "lane with another length");
		expect(await readLaneUnionCatalog(nativeStoreRoot)).toBe(newerServedCatalog);
		olderBuild.rejectBuild(olderBuildFailure);
		expect(await olderOutcome).toBe(olderBuildFailure);
		expect(await readLaneUnionCatalog(nativeStoreRoot)).toBe(newerServedCatalog);
		expect(buildLaneUnionCatalog).toHaveBeenCalledTimes(2);
	});

	it("keeps one answer per native store root", async () => {
		const firstRoot = catalogFileRoot();
		const secondRoot = catalogFileRoot();
		const buildLaneUnionCatalog = countingBuild();
		const readLaneUnionCatalog = createKeptLaneUnionCatalogReader(buildLaneUnionCatalog);
		const firstAnswer = await readLaneUnionCatalog(firstRoot);
		const secondAnswer = await readLaneUnionCatalog(secondRoot);
		expect(buildLaneUnionCatalog.mock.calls).toEqual([[firstRoot], [secondRoot]]);
		expect(await readLaneUnionCatalog(firstRoot)).toBe(firstAnswer);
		expect(await readLaneUnionCatalog(secondRoot)).toBe(secondAnswer);
		expect(secondAnswer).not.toBe(firstAnswer);
		expect(buildLaneUnionCatalog).toHaveBeenCalledTimes(2);
	});
});

describe("kept lane union catalog of the native store request handler", () => {
	it("answers a kept catalog request with the status, body and headers of the building request", async () => {
		const laneCatalog = laneCatalogText(["lane:model"]);
		const catalogUrl = await catalogUrlOfLaneStoreServer(laneStoreProject(laneCatalog));
		const buildingAnswer = await requestCatalog(catalogUrl, "GET");
		const keptAnswer = await requestCatalog(catalogUrl, "GET");
		const headAnswer = await requestCatalog(catalogUrl, "HEAD");
		expect(buildingAnswer).toEqual({
			status: 200,
			body: "{\"models\":[{\"id\":\"shared:model\"},{\"id\":\"lane:model\"}],\"schemaVersion\":1}",
			cacheControl: "no-store",
			source: "union",
			laneCatalogSha256: sha256Hex(laneCatalog),
			contentType: "application/json",
			acceptRanges: "bytes",
			contentLength: String(Buffer.byteLength(buildingAnswer.body, "utf8")),
		});
		expect(keptAnswer).toEqual(buildingAnswer);
		expect(headAnswer).toEqual({ ...buildingAnswer, body: "" });
	});

	it("answers from the kept catalog, without a new build, while both catalog files keep their identity", async () => {
		const projectRoot = laneStoreProject(laneCatalogText(["lane:first"]));
		const laneCatalogFilePath = resolve(projectRoot, laneStoreFolder, catalogFileName);
		utimesSync(laneCatalogFilePath, fixedModificationTime, fixedModificationTime);
		const catalogUrl = await catalogUrlOfLaneStoreServer(projectRoot);
		const buildingAnswer = await requestCatalog(catalogUrl, "GET");
		writeCatalogFile(resolve(projectRoot, laneStoreFolder), laneCatalogText(["lane:other"]));
		utimesSync(laneCatalogFilePath, fixedModificationTime, fixedModificationTime);
		expect(buildingAnswer.body).toContain("lane:first");
		expect(await requestCatalog(catalogUrl, "GET")).toEqual(buildingAnswer);
	});

	it("serves the new lane catalog SHA-256 after the lane catalog file is replaced", async () => {
		const projectRoot = laneStoreProject(laneCatalogText(["lane:model"]));
		const catalogUrl = await catalogUrlOfLaneStoreServer(projectRoot);
		const firstAnswer = await requestCatalog(catalogUrl, "GET");
		const replacedLaneCatalog = laneCatalogText(["lane:model", "lane:second"]);
		writeCatalogFile(resolve(projectRoot, laneStoreFolder), replacedLaneCatalog);
		const answerAfterReplacement = await requestCatalog(catalogUrl, "GET");
		expect(firstAnswer.laneCatalogSha256).toBe(sha256Hex(laneCatalogText(["lane:model"])));
		expect(firstAnswer.body).not.toContain("lane:second");
		expect([answerAfterReplacement.status, answerAfterReplacement.laneCatalogSha256]).toEqual([200, sha256Hex(replacedLaneCatalog)]);
		expect(answerAfterReplacement.body).toContain("lane:second");
	});
});
