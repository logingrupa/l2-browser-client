import { describe, expect, it } from "vitest";
import type { NativeTableCatalogRecord } from "../../src/assets/native/nativeCatalogRecords";
import { nativeTableManifestMismatch } from "../browser/support/nativeTableLoadCheck";

function tableRecord(table: string, recordCount: number): NativeTableCatalogRecord {
	return { table, manifest: `/l2/tables/${"a".repeat(64)}/${table}.json`, manifestSha256: "a".repeat(64), manifestBytes: 10, recordCount, sourceSha256: "b".repeat(64) };
}

describe("native table load check", () => {
	it("passes a native-table manifest whose table and recordCount equal the catalog record", () => {
		expect(nativeTableManifestMismatch({ kind: "native-table", table: "armorgrp", recordCount: 1014 }, tableRecord("armorgrp", 1014))).toBeNull();
	});

	it("passes a name index whose source table and entryCount match the catalog record", () => {
		expect(nativeTableManifestMismatch({ kind: "native-table-name-index", table: "itemname-e", entryCount: 9238 }, tableRecord("itemname_e_names", 9238)))
			.toBeNull();
	});

	it("names the first mismatch of kind, table and record count", () => {
		expect(nativeTableManifestMismatch([], tableRecord("armorgrp", 1))).toBe("the manifest is not a JSON object");
		expect(nativeTableManifestMismatch({ kind: "native-window" }, tableRecord("armorgrp", 1)))
			.toBe("kind \"native-window\" is not native-table or native-table-name-index");
		expect(nativeTableManifestMismatch({ kind: "native-table", table: "weapongrp", recordCount: 1 }, tableRecord("armorgrp", 1)))
			.toBe("table \"weapongrp\" is not the catalog id armorgrp");
		expect(nativeTableManifestMismatch({ kind: "native-table", table: "armorgrp", recordCount: 2 }, tableRecord("armorgrp", 1)))
			.toBe("recordCount 2 is not the catalog recordCount 1");
		expect(nativeTableManifestMismatch({ kind: "native-table-name-index", table: "npcname-e", entryCount: 3 }, tableRecord("itemname_e_names", 3)))
			.toBe("name index table \"npcname-e\" does not name the catalog id itemname_e_names");
		expect(nativeTableManifestMismatch({ kind: "native-table-name-index", table: "itemname-e", entryCount: 2 }, tableRecord("itemname_e_names", 3)))
			.toBe("entryCount 2 is not the catalog recordCount 3");
	});
});
