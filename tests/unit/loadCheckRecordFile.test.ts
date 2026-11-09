import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	servedLaneCatalogSha256,
	loadCheckRecordFilePath,
	readLoadCheckRecordFile,
	writeLoadCheckRecordFile,
	type LoadCheckRecord,
} from "../browser/support/loadCheckRecordFile";
import { NATIVE_STORE_LANE_CATALOG_SHA256_HEADER } from "../../src/assets/native/nativeStoreLaneCatalogHeader";

const catalogSha256 = "e".repeat(64);
const temporaryFolders: string[] = [];

function temporaryRecordFilePath(): string {
	const folder = mkdtempSync(join(tmpdir(), "load-check-records-"));
	temporaryFolders.push(folder);
	return join(folder, "load-checks", `${catalogSha256}.json`);
}

function passRecord(key: string): LoadCheckRecord {
	return { key, status: "pass", reason: null, atRiga: "2026-11-08T15:05:00+02:00", assetManifestSchemaVersion: 2 };
}

afterAll(() => {
	for (const folder of temporaryFolders) rmSync(folder, { recursive: true, force: true });
});

describe("load-check record file path", () => {
	it("places records under the lane's load-checks folder by catalog SHA-256", () => {
		expect(loadCheckRecordFilePath("C:/p", "world", catalogSha256)).toBe(resolve("C:/p", "artifacts/lane-store/world/load-checks", `${catalogSha256}.json`));
	});

	it("refuses names that are not lanes and SHA-256 values that are not 64 hex digits", () => {
		expect(() => loadCheckRecordFilePath("C:/p", "plan", catalogSha256)).toThrow("not a lane");
		expect(() => loadCheckRecordFilePath("C:/p", "fixture", catalogSha256)).toThrow("not a lane");
		expect(() => loadCheckRecordFilePath("C:/p", "world", "E".repeat(64))).toThrow("64 lowercase hex");
		expect(() => loadCheckRecordFilePath("C:/p", "world", "e".repeat(63))).toThrow("64 lowercase hex");
	});
});

describe("load-check record file writes", () => {
	it("writes one record, adds others sorted by key and replaces a rewritten key", () => {
		const filePath = temporaryRecordFilePath();
		writeLoadCheckRecordFile(filePath, "world", catalogSha256, passRecord("tile:20_21"));
		expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ schemaVersion: 1, lane: "world", catalogSha256, records: [passRecord("tile:20_21")] });
		writeLoadCheckRecordFile(filePath, "world", catalogSha256, passRecord("npc:12077"));
		expect(readLoadCheckRecordFile(filePath, "world", catalogSha256).map((record) => record.key)).toEqual(["npc:12077", "tile:20_21"]);
		const failedRecord: LoadCheckRecord = { key: "tile:20_21", status: "failed", reason: "chunk manifest 404", atRiga: "2026-11-08T16:00:00+02:00", assetManifestSchemaVersion: null };
		writeLoadCheckRecordFile(filePath, "world", catalogSha256, failedRecord);
		expect(readLoadCheckRecordFile(filePath, "world", catalogSha256)).toEqual([passRecord("npc:12077"), failedRecord]);
	});

	it("leaves only the record file in its folder after each write", () => {
		const filePath = temporaryRecordFilePath();
		writeLoadCheckRecordFile(filePath, "world", catalogSha256, passRecord("item:57"));
		writeLoadCheckRecordFile(filePath, "world", catalogSha256, passRecord("skill:3:1"));
		expect(readdirSync(dirname(filePath))).toEqual([`${catalogSha256}.json`]);
	});

	it("refuses records whose fields break the format and leaves the file absent", () => {
		const filePath = temporaryRecordFilePath();
		const refusedRecords: unknown[] = [
			{ ...passRecord("tile:20_21"), status: "loaded" },
			{ ...passRecord("tile:20_21"), reason: "looked fine" },
			{ ...passRecord("tile:20_21"), status: "failed", reason: "" },
			{ ...passRecord("tile:20_21"), status: "failed", reason: null },
			passRecord("model:x"),
			{ ...passRecord("tile:20_21"), atRiga: "2026-11-08 10:00" },
			{ ...passRecord("tile:20_21"), atRiga: "2026-11-08T10:00:00" },
			{ ...passRecord("tile:20_21"), assetManifestSchemaVersion: 3 },
		];
		for (const record of refusedRecords) {
			expect(() => writeLoadCheckRecordFile(filePath, "world", catalogSha256, record as LoadCheckRecord), JSON.stringify(record)).toThrow("load-check record");
		}
		expect(existsSync(filePath)).toBe(false);
	});

	it("accepts every gap-row key kind", () => {
		const filePath = temporaryRecordFilePath();
		const keys = ["tile:20_21", "map:Gludio_Castle", "npc:12077", "item:57", "skill:3:1", "table:skillgrp", "window:StatusWnd", "character:0"];
		for (const key of keys) writeLoadCheckRecordFile(filePath, "world", catalogSha256, passRecord(key));
		expect(readLoadCheckRecordFile(filePath, "world", catalogSha256).map((record) => record.key)).toEqual([...keys].sort());
	});
});

describe("load-check record file reads", () => {
	it("reads an absent file as no records", () => {
		expect(readLoadCheckRecordFile(temporaryRecordFilePath(), "world", catalogSha256)).toEqual([]);
	});

	it("refuses a file pinned to another lane or catalog", () => {
		const filePath = temporaryRecordFilePath();
		writeLoadCheckRecordFile(filePath, "world", catalogSha256, passRecord("tile:20_21"));
		expect(() => readLoadCheckRecordFile(filePath, "actors", catalogSha256)).toThrow("lane");
		expect(() => readLoadCheckRecordFile(filePath, "world", "f".repeat(64))).toThrow("catalogSha256");
	});

	it("refuses a file with duplicate or unsorted keys", () => {
		const filePath = temporaryRecordFilePath();
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, lane: "world", catalogSha256, records: [passRecord("tile:20_21"), passRecord("npc:1")] }));
		expect(() => readLoadCheckRecordFile(filePath, "world", catalogSha256)).toThrow("sorted");
	});
});

describe("served lane catalog SHA-256", () => {
	const servers: Server[] = [];

	afterAll(async () => {
		for (const runningServer of servers) await new Promise<void>((resolveClosed) => runningServer.close(() => resolveClosed()));
	});

	async function catalogServer(statusCode: number, laneCatalogSha256: string | undefined): Promise<string> {
		const runningServer = createServer((request, response) => {
			response.statusCode = request.url === "/l2/catalog.json" ? statusCode : 404;
			if (laneCatalogSha256 !== undefined) response.setHeader(NATIVE_STORE_LANE_CATALOG_SHA256_HEADER, laneCatalogSha256);
			response.end();
		});
		servers.push(runningServer);
		await new Promise<void>((resolveListening) => runningServer.listen(0, "127.0.0.1", resolveListening));
		return `http://127.0.0.1:${(runningServer.address() as AddressInfo).port}`;
	}

	it("reads the lane catalog SHA-256 the dev switch names for /l2/catalog.json", async () => {
		const laneCatalogSha256 = createHash("sha256").update("{\"models\":[],\"schemaVersion\":1}").digest("hex");
		expect(await servedLaneCatalogSha256(await catalogServer(200, laneCatalogSha256))).toBe(laneCatalogSha256);
	});

	it("refuses a catalog answer without the lane catalog SHA-256 or with a refusal status", async () => {
		await expect(servedLaneCatalogSha256(await catalogServer(200, undefined))).rejects.toThrow("names no lane catalog SHA-256");
		await expect(servedLaneCatalogSha256(await catalogServer(200, "e"))).rejects.toThrow("names no lane catalog SHA-256");
		await expect(servedLaneCatalogSha256(await catalogServer(409, catalogSha256))).rejects.toThrow("answered 409");
	});
});
