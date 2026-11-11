import { describe, expect, it } from "vitest";
import type { LoadCheckRecord } from "../browser/support/loadCheckRecordFile";
import {
	LOAD_CHECK_KINDS,
	keysNotRecordedExactlyOnce,
	loadCheckKindKeyPrefix,
	loadCheckSkipReason,
	loadCheckSpecTitle,
	lowestAssetManifestSchemaVersion,
	pendingLoadCheckKeys,
	readLoadCheckSliceSettings,
	runLoadCheckSlice,
	type LoadCheckOutcome,
	type LoadCheckSliceActions,
	type LoadCheckSliceSettings,
} from "../browser/support/loadCheckRecords";

const laneNames = ["actors", "data-ui", "integration", "world"];
const firstCatalogSha256 = "a".repeat(64);
const secondCatalogSha256 = "b".repeat(64);
const passOutcome: LoadCheckOutcome = { status: "pass", reason: null, assetManifestSchemaVersion: 2 };
const windowsSettings: LoadCheckSliceSettings = { laneName: "data-ui", kind: "windows", limit: 10, selectedKeys: null };

interface FakeRecordStore {
	readonly recordsByCatalog: Map<string, LoadCheckRecord[]>;
	readonly checkedKeys: string[];
}

function createFakeRecordStore(): FakeRecordStore {
	return { recordsByCatalog: new Map(), checkedKeys: [] };
}

function fakeSliceActions(store: FakeRecordStore, options: {
	readonly catalogSha256?: string;
	readonly convertedKeys: readonly string[];
	readonly checkKey?: (key: string) => Promise<LoadCheckOutcome>;
	readonly failWriteForKey?: string;
}): LoadCheckSliceActions {
	const catalogSha256 = options.catalogSha256 ?? firstCatalogSha256;
	return {
		servedLaneCatalogSha256: async () => catalogSha256,
		readRecordedKeys: async (sha256) => new Set((store.recordsByCatalog.get(sha256) ?? []).map((record) => record.key)),
		listConvertedKeys: async (prefix) => options.convertedKeys.filter((key) => key.startsWith(prefix)),
		checkKey: async (key) => {
			store.checkedKeys.push(key);
			return options.checkKey === undefined ? passOutcome : options.checkKey(key);
		},
		writeRecord: async (sha256, record) => {
			if (record.key === options.failWriteForKey) throw new Error(`interrupted while writing ${record.key}`);
			store.recordsByCatalog.set(sha256, [...(store.recordsByCatalog.get(sha256) ?? []), record]);
		},
		nowAtRiga: () => "2026-11-09T02:30:00+02:00",
	};
}

describe("load-check slice settings", () => {
	it("maps every kind to its catalog key prefix", () => {
		expect(LOAD_CHECK_KINDS.map(loadCheckKindKeyPrefix)).toEqual(["tile:", "npc:", "item:", "skill:", "window:"]);
	});

	it("returns null while any sweep variable is unset", () => {
		expect(readLoadCheckSliceSettings({}, laneNames)).toBeNull();
		expect(readLoadCheckSliceSettings({ NATIVE_STORE_ROOT: "data-ui", LOAD_CHECK_KIND: "windows" }, laneNames)).toBeNull();
		expect(readLoadCheckSliceSettings({ NATIVE_STORE_ROOT: "data-ui", LOAD_CHECK_LIMIT: "2" }, laneNames)).toBeNull();
		expect(readLoadCheckSliceSettings({ LOAD_CHECK_KIND: "windows", LOAD_CHECK_LIMIT: "2" }, laneNames)).toBeNull();
	});

	it("reads the lane, kind and limit of a complete slice request and selects no keys while LOAD_CHECK_KEYS is unset", () => {
		expect(readLoadCheckSliceSettings({ NATIVE_STORE_ROOT: "data-ui", LOAD_CHECK_KIND: "windows", LOAD_CHECK_LIMIT: "2" }, laneNames))
			.toEqual({ laneName: "data-ui", kind: "windows", limit: 2, selectedKeys: null });
	});

	it("reads LOAD_CHECK_KEYS as the selected catalog keys in the given order", () => {
		const request = { NATIVE_STORE_ROOT: "integration", LOAD_CHECK_KIND: "windows", LOAD_CHECK_LIMIT: "5", LOAD_CHECK_KEYS: "window:StatusWnd,window:InventoryWnd" };
		expect(readLoadCheckSliceSettings(request, laneNames)?.selectedKeys).toEqual(["window:StatusWnd", "window:InventoryWnd"]);
		expect(readLoadCheckSliceSettings({ ...request, LOAD_CHECK_KIND: "skills", LOAD_CHECK_KEYS: "skill:1001:2" }, laneNames)?.selectedKeys)
			.toEqual(["skill:1001:2"]);
	});

	it("refuses a LOAD_CHECK_KEYS entry that is empty, of another kind, not a catalog key or listed twice", () => {
		const request = { NATIVE_STORE_ROOT: "integration", LOAD_CHECK_KIND: "windows", LOAD_CHECK_LIMIT: "5" };
		for (const selectedKeys of ["", "window:StatusWnd,", ",window:StatusWnd", " window:StatusWnd"]) {
			expect(() => readLoadCheckSliceSettings({ ...request, LOAD_CHECK_KEYS: selectedKeys }, laneNames)).toThrow("LOAD_CHECK_KEYS");
		}
		expect(() => readLoadCheckSliceSettings({ ...request, LOAD_CHECK_KEYS: "window:StatusWnd,npc:20001" }, laneNames))
			.toThrow("LOAD_CHECK_KEYS entry \"npc:20001\" is not a window: key");
		expect(() => readLoadCheckSliceSettings({ ...request, LOAD_CHECK_KEYS: "window:Status Wnd" }, laneNames))
			.toThrow("LOAD_CHECK_KEYS entry \"window:Status Wnd\" is not a catalog key");
		expect(() => readLoadCheckSliceSettings({ ...request, LOAD_CHECK_KEYS: "window:StatusWnd,window:StatusWnd" }, laneNames))
			.toThrow("LOAD_CHECK_KEYS lists \"window:StatusWnd\" twice");
	});

	it("refuses a lane that is not in lanes.json, an unknown kind and a limit that is not a positive safe integer", () => {
		const request = { NATIVE_STORE_ROOT: "data-ui", LOAD_CHECK_KIND: "windows", LOAD_CHECK_LIMIT: "2" };
		expect(() => readLoadCheckSliceSettings({ ...request, NATIVE_STORE_ROOT: "fixture" }, laneNames)).toThrow("NATIVE_STORE_ROOT");
		expect(() => readLoadCheckSliceSettings({ ...request, LOAD_CHECK_KIND: "tables" }, laneNames)).toThrow("LOAD_CHECK_KIND");
		for (const limit of ["0", "-1", "1.5", "2e3", " 2", "+2", "9007199254740993", "two"]) {
			expect(() => readLoadCheckSliceSettings({ ...request, LOAD_CHECK_LIMIT: limit }, laneNames)).toThrow("LOAD_CHECK_LIMIT");
		}
	});

	it("names the one spec title and a skip reason that holds the full slice command", () => {
		expect(loadCheckSpecTitle("npcs")).toBe("load sweep npcs slice");
		for (const kind of LOAD_CHECK_KINDS) {
			const reason = loadCheckSkipReason(kind);
			expect(reason).toContain(`NATIVE_STORE_ROOT=<lane> LOAD_CHECK_KIND=${kind} LOAD_CHECK_LIMIT=<n> pnpm test:e2e tests/browser/load-sweep-${kind}.spec.ts`);
			expect(reason).toContain("port 5173");
			expect(reason).toContain("artifacts/lane-store/<lane>/load-checks/<catalogSha256>.json");
			expect(reason).toContain("LOAD_CHECK_KEYS=<key,key>");
		}
	});
});

describe("pending load-check keys", () => {
	const convertedKeys = ["window:A", "window:B", "window:C", "window:D"];
	const recordedKeys = new Set(["window:B"]);

	it("drops recorded keys and keeps the index order", () => {
		expect(pendingLoadCheckKeys(convertedKeys, recordedKeys, 10, null)).toEqual(["window:A", "window:C", "window:D"]);
	});

	it("takes at most the limit when it equals or is below the pending count", () => {
		expect(pendingLoadCheckKeys(convertedKeys, recordedKeys, 3, null)).toEqual(["window:A", "window:C", "window:D"]);
		expect(pendingLoadCheckKeys(convertedKeys, recordedKeys, 2, null)).toEqual(["window:A", "window:C"]);
	});

	it("keeps the selected order, skips selected keys already recorded and applies the limit", () => {
		expect(pendingLoadCheckKeys(convertedKeys, recordedKeys, 10, ["window:D", "window:B", "window:A"])).toEqual(["window:D", "window:A"]);
		expect(pendingLoadCheckKeys(convertedKeys, recordedKeys, 1, ["window:D", "window:A"])).toEqual(["window:D"]);
	});

	it("refuses a selected key that is not converted", () => {
		expect(() => pendingLoadCheckKeys(convertedKeys, recordedKeys, 10, ["window:A", "window:Missing"]))
			.toThrow("LOAD_CHECK_KEYS selects window:Missing, which is not a converted key of the served catalog");
	});

	it("lists the keys the slice checked that the record file does not hold exactly once", () => {
		expect(keysNotRecordedExactlyOnce(["window:A", "window:B"], ["window:A", "window:C"])).toEqual(["window:B"]);
		expect(keysNotRecordedExactlyOnce(["window:A"], ["window:A", "window:A"])).toEqual(["window:A"]);
		expect(keysNotRecordedExactlyOnce(["window:A"], ["window:A"])).toEqual([]);
	});
});

describe("asset manifest schema version folding", () => {
	it("keeps the lowest version or null when no asset package was read", () => {
		expect(lowestAssetManifestSchemaVersion([2, 1, 2])).toBe(1);
		expect(lowestAssetManifestSchemaVersion([2, 2])).toBe(2);
		expect(lowestAssetManifestSchemaVersion([])).toBeNull();
	});
});

describe("resumable load-check slice", () => {
	it("checks and writes nothing when no key is converted", async () => {
		const store = createFakeRecordStore();
		const summary = await runLoadCheckSlice(windowsSettings, fakeSliceActions(store, { convertedKeys: [] }));
		expect(summary).toEqual({ catalogSha256: firstCatalogSha256, checkedKeys: [], skippedAsRecorded: 0 });
		expect(store.checkedKeys).toEqual([]);
		expect(store.recordsByCatalog.size).toBe(0);
	});

	it("checks only keys of its kind prefix and reports the keys skipped as already recorded", async () => {
		const store = createFakeRecordStore();
		store.recordsByCatalog.set(firstCatalogSha256, [{ key: "window:A", ...passOutcome, atRiga: "2026-11-09T01:00:00+02:00" }]);
		const summary = await runLoadCheckSlice(windowsSettings, fakeSliceActions(store, { convertedKeys: ["npc:1", "window:A", "window:B"] }));
		expect(summary).toEqual({ catalogSha256: firstCatalogSha256, checkedKeys: ["window:B"], skippedAsRecorded: 1 });
		expect(store.checkedKeys).toEqual(["window:B"]);
	});

	it("opens no check and writes nothing when every converted key is recorded", async () => {
		const store = createFakeRecordStore();
		store.recordsByCatalog.set(firstCatalogSha256, [{ key: "window:A", ...passOutcome, atRiga: "2026-11-09T01:00:00+02:00" }]);
		const summary = await runLoadCheckSlice(windowsSettings, fakeSliceActions(store, { convertedKeys: ["window:A"] }));
		expect(summary).toEqual({ catalogSha256: firstCatalogSha256, checkedKeys: [], skippedAsRecorded: 1 });
		expect(store.checkedKeys).toEqual([]);
		expect(store.recordsByCatalog.get(firstCatalogSha256)).toHaveLength(1);
	});

	it("records a rejected check as failed with the first line of its message and still checks the next key", async () => {
		const store = createFakeRecordStore();
		const checkKey = async (key: string): Promise<LoadCheckOutcome> => {
			if (key === "window:A") throw new Error("window manifest hash mismatch\n    at harness line 12");
			return passOutcome;
		};
		const summary = await runLoadCheckSlice(windowsSettings, fakeSliceActions(store, { convertedKeys: ["window:A", "window:B"], checkKey }));
		expect(summary.checkedKeys).toEqual(["window:A", "window:B"]);
		expect(store.recordsByCatalog.get(firstCatalogSha256)).toEqual([
			{ key: "window:A", status: "failed", reason: "window manifest hash mismatch", atRiga: "2026-11-09T02:30:00+02:00", assetManifestSchemaVersion: null },
			{ key: "window:B", ...passOutcome, atRiga: "2026-11-09T02:30:00+02:00" },
		]);
	});

	it("keeps only the first line of a failed outcome reason", async () => {
		const store = createFakeRecordStore();
		const checkKey = async (): Promise<LoadCheckOutcome> => ({ status: "failed", reason: "page error: boom\nstack", assetManifestSchemaVersion: null });
		await runLoadCheckSlice(windowsSettings, fakeSliceActions(store, { convertedKeys: ["window:A"], checkKey }));
		expect(store.recordsByCatalog.get(firstCatalogSha256)?.[0]?.reason).toBe("page error: boom");
	});

	it("loses only the key in progress when interrupted and resumes with the first unrecorded key", async () => {
		const store = createFakeRecordStore();
		const convertedKeys = ["window:A", "window:B", "window:C"];
		await expect(runLoadCheckSlice(windowsSettings, fakeSliceActions(store, { convertedKeys, failWriteForKey: "window:B" })))
			.rejects.toThrow("interrupted while writing window:B");
		expect(store.recordsByCatalog.get(firstCatalogSha256)?.map((record) => record.key)).toEqual(["window:A"]);
		store.checkedKeys.length = 0;
		const summary = await runLoadCheckSlice(windowsSettings, fakeSliceActions(store, { convertedKeys }));
		expect(summary).toEqual({ catalogSha256: firstCatalogSha256, checkedKeys: ["window:B", "window:C"], skippedAsRecorded: 1 });
		expect(store.checkedKeys).toEqual(["window:B", "window:C"]);
		expect(store.recordsByCatalog.get(firstCatalogSha256)?.map((record) => record.key)).toEqual(["window:A", "window:B", "window:C"]);
	});

	it("makes every converted key pending again under a changed catalog SHA-256", async () => {
		const store = createFakeRecordStore();
		const convertedKeys = ["window:A", "window:B"];
		await runLoadCheckSlice(windowsSettings, fakeSliceActions(store, { convertedKeys }));
		const summary = await runLoadCheckSlice(windowsSettings, fakeSliceActions(store, { convertedKeys, catalogSha256: secondCatalogSha256 }));
		expect(summary).toEqual({ catalogSha256: secondCatalogSha256, checkedKeys: ["window:A", "window:B"], skippedAsRecorded: 0 });
		expect(store.recordsByCatalog.get(secondCatalogSha256)).toHaveLength(2);
		expect(store.recordsByCatalog.get(firstCatalogSha256)).toHaveLength(2);
	});

	it("checks only the selected keys in the selected order", async () => {
		const store = createFakeRecordStore();
		const summary = await runLoadCheckSlice({ ...windowsSettings, selectedKeys: ["window:C", "window:A"] },
			fakeSliceActions(store, { convertedKeys: ["window:A", "window:B", "window:C"] }));
		expect(summary).toEqual({ catalogSha256: firstCatalogSha256, checkedKeys: ["window:C", "window:A"], skippedAsRecorded: 0 });
		expect(store.checkedKeys).toEqual(["window:C", "window:A"]);
	});

	it("checks nothing when a selected key is not converted", async () => {
		const store = createFakeRecordStore();
		await expect(runLoadCheckSlice({ ...windowsSettings, selectedKeys: ["window:A", "window:Z"] },
			fakeSliceActions(store, { convertedKeys: ["window:A"] }))).rejects.toThrow("window:Z");
		expect(store.checkedKeys).toEqual([]);
	});

	it("stops at the limit in index order", async () => {
		const store = createFakeRecordStore();
		const summary = await runLoadCheckSlice({ ...windowsSettings, limit: 1 }, fakeSliceActions(store, { convertedKeys: ["window:B", "window:C"] }));
		expect(summary.checkedKeys).toEqual(["window:B"]);
	});
});
