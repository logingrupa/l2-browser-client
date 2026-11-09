import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import { equipmentSlotForBodyPart, isEquipmentSlot } from "../../src/world/sandboxCommands";
import type { EquipmentSlot, WorldEntity, WorldEvent } from "../../src/world/worldTypes";

const origin = { x: 0, y: 0, z: 0 };

const adapterBuilds: readonly (readonly [string, () => NativeSliceAdapter])[] = [
  ["the default locomotion profile", () => new NativeSliceAdapter(origin)],
  ["a walk-capable locomotion profile", () => new NativeSliceAdapter(origin, undefined, null, undefined, { walkSupported: true })],
];

const nonCanonicalSlotSpellings: readonly string[] = [
  "body-part:07", "body-part:+7", "body-part: 7", "body-part:7.0", "body-part:-1", "BODY-PART:7", "body-part:9007199254740992", "upper2", "",
];

function recordEvents(adapter: NativeSliceAdapter): WorldEvent[] {
  const receivedEvents: WorldEvent[] = [];
  adapter.subscribe(event => receivedEvents.push(event));
  return receivedEvents;
}

function localPlayer(adapter: NativeSliceAdapter): WorldEntity {
  const player = adapter.getInitialState().find(entity => entity.id === "local-player");
  if (!player) throw new Error("The adapter has no local player.");
  return player;
}

function updatedEquipment(events: readonly WorldEvent[]) {
  return events.flatMap(event => event.type === "update" ? [event.entity.equipment] : []);
}

function equip(adapter: NativeSliceAdapter, slot: EquipmentSlot, itemId: number | null): void {
  adapter.dispatch({ type: "equip-item", slot, itemId });
}

describe.each(adapterBuilds)("body-part equipment slots on NativeSliceAdapter with %s", (_buildName, buildAdapter) => {
  it("equips and unequips an item in a body-part slot with one update each", () => {
    const adapter = buildAdapter();
    const receivedEvents = recordEvents(adapter);
    equip(adapter, "body-part:7", 1);
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({ type: "update", entity: { id: "local-player" } });
    expect(updatedEquipment(receivedEvents)).toEqual([{ "body-part:7": 1 }]);
    equip(adapter, "body-part:7", null);
    expect(updatedEquipment(receivedEvents)).toEqual([{ "body-part:7": 1 }, {}]);
    adapter.dispose();
  });

  it("rejects every non-canonical slot spelling and emits nothing", () => {
    const adapter = buildAdapter();
    const receivedEvents = recordEvents(adapter);
    for (const slot of nonCanonicalSlotSpellings) {
      adapter.dispatch({ type: "equip-item", slot: slot as EquipmentSlot, itemId: 1 });
      adapter.dispatch({ type: "equip-item", slot: slot as EquipmentSlot, itemId: null });
    }
    expect(receivedEvents).toEqual([]);
    expect(localPlayer(adapter)).not.toHaveProperty("equipment");
    adapter.dispose();
  });

  it("replaces the item in a body-part slot, confirms a repeat equip without a change and keeps upper as a separate key", () => {
    const adapter = buildAdapter();
    const receivedEvents = recordEvents(adapter);
    equip(adapter, "body-part:7", 1);
    equip(adapter, "body-part:7", 2);
    expect(updatedEquipment(receivedEvents)).toEqual([{ "body-part:7": 1 }, { "body-part:7": 2 }]);
    const playerBeforeRepeat = localPlayer(adapter);
    equip(adapter, "body-part:7", 2);
    expect(receivedEvents).toHaveLength(3);
    expect(receivedEvents[2]).toEqual({ type: "update", entity: playerBeforeRepeat });
    equip(adapter, "upper", 22);
    expect(localPlayer(adapter).equipment).toEqual({ upper: 22, "body-part:7": 2 });
    equip(adapter, "upper", null);
    expect(localPlayer(adapter).equipment).toEqual({ "body-part:7": 2 });
    adapter.dispose();
  });

  it("confirms an unequip of an empty slot without a change and leaves an empty record after the last item goes", () => {
    const adapter = buildAdapter();
    const receivedEvents = recordEvents(adapter);
    equip(adapter, "body-part:3", null);
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({ type: "update", entity: { id: "local-player" } });
    expect(localPlayer(adapter)).not.toHaveProperty("equipment");
    equip(adapter, "body-part:3", 5);
    equip(adapter, "body-part:3", null);
    expect(localPlayer(adapter).equipment).toEqual({});
    adapter.dispose();
  });

  it("orders keys upper first then body-part slots by ascending value, whatever the equip order", () => {
    const forwardAdapter = buildAdapter();
    const reverseAdapter = buildAdapter();
    equip(forwardAdapter, "body-part:12", 1);
    equip(forwardAdapter, "body-part:3", 2);
    equip(forwardAdapter, "upper", 22);
    equip(reverseAdapter, "upper", 22);
    equip(reverseAdapter, "body-part:3", 2);
    equip(reverseAdapter, "body-part:12", 1);
    expect(forwardAdapter.getInitialState()).toEqual(reverseAdapter.getInitialState());
    expect(Object.keys(localPlayer(forwardAdapter).equipment ?? {})).toEqual(["upper", "body-part:3", "body-part:12"]);
    expect(Object.keys(localPlayer(reverseAdapter).equipment ?? {})).toEqual(["upper", "body-part:3", "body-part:12"]);
    forwardAdapter.dispose();
    reverseAdapter.dispose();
  });

  it("applies two equip commands for one slot in dispatch order with one update each, so the later one wins", () => {
    const adapter = buildAdapter();
    const receivedEvents = recordEvents(adapter);
    equip(adapter, "body-part:14", 10);
    equip(adapter, "body-part:14", 11);
    expect(updatedEquipment(receivedEvents)).toEqual([{ "body-part:14": 10 }, { "body-part:14": 11 }]);
    expect(localPlayer(adapter).equipment).toEqual({ "body-part:14": 11 });
    adapter.dispose();
  });

  it("changes no entity field other than equipment", () => {
    const adapter = buildAdapter();
    const { equipment: _equipmentBefore, ...playerBefore } = localPlayer(adapter);
    equip(adapter, "body-part:7", 1);
    equip(adapter, "upper", 22);
    const { equipment: _equipmentAfter, ...playerAfter } = localPlayer(adapter);
    expect(playerAfter).toEqual(playerBefore);
    adapter.dispose();
  });
});

describe("equipment slot helpers", () => {
  it("accepts upper and canonical body-part slots and refuses every other spelling", () => {
    for (const slot of ["upper", "body-part:0", "body-part:7", "body-part:9007199254740991"]) expect(isEquipmentSlot(slot), slot).toBe(true);
    for (const slot of nonCanonicalSlotSpellings) expect(isEquipmentSlot(slot), slot).toBe(false);
  });

  it("builds a body-part slot only from a safe non-negative integer", () => {
    expect(equipmentSlotForBodyPart(0)).toBe("body-part:0");
    expect(equipmentSlotForBodyPart(14)).toBe("body-part:14");
    for (const bodyPart of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) expect(equipmentSlotForBodyPart(bodyPart)).toBeNull();
  });
});

const dataUiLaneStoreRoot = "artifacts/lane-store/data-ui/l2";
const dataUiLaneCatalogPath = `${dataUiLaneStoreRoot}/catalog.json`;
const equipmentTableIds = ["weapongrp", "armorgrp"] as const;

interface TableCatalogRecord {
  readonly id: string;
  readonly manifest: string;
  readonly manifestSha256: string;
  readonly manifestBytes: number;
}

function isTableCatalogRecord(value: unknown): value is TableCatalogRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.manifest === "string" && typeof record.manifestSha256 === "string" &&
    typeof record.manifestBytes === "number";
}

function laneTableRecord(tableId: string): TableCatalogRecord | null {
  if (!existsSync(dataUiLaneCatalogPath)) return null;
  const catalog: unknown = JSON.parse(readFileSync(dataUiLaneCatalogPath, "utf8"));
  const tables = catalog !== null && typeof catalog === "object" ? (catalog as { readonly tables?: unknown }).tables : undefined;
  if (!Array.isArray(tables)) throw new Error(`${dataUiLaneCatalogPath} has no tables array.`);
  const record: unknown = tables.find(table => isTableCatalogRecord(table) && table.id === tableId);
  return isTableCatalogRecord(record) ? record : null;
}

function decodedBodyPartCounts(record: TableCatalogRecord): ReadonlyMap<number, number> {
  if (!record.manifest.startsWith("/l2/")) throw new Error(`${record.id} manifest ${record.manifest} is outside /l2/.`);
  const manifestBytes = readFileSync(`${dataUiLaneStoreRoot}${record.manifest.slice("/l2".length)}`);
  if (manifestBytes.byteLength !== record.manifestBytes) throw new Error(`${record.id} manifest length differs from its catalog record.`);
  if (createHash("sha256").update(manifestBytes).digest("hex") !== record.manifestSha256) throw new Error(`${record.id} manifest SHA-256 differs from its catalog record.`);
  const manifest: unknown = JSON.parse(manifestBytes.toString("utf8"));
  const items = manifest !== null && typeof manifest === "object" ? (manifest as { readonly records?: { readonly item?: unknown } }).records?.item : undefined;
  if (!Array.isArray(items)) throw new Error(`${record.id} manifest has no records.item array.`);
  const counts = new Map<number, number>();
  for (const [ordinal, item] of items.entries()) {
    const bodyPart: unknown = item !== null && typeof item === "object" ? (item as { readonly body_part?: unknown }).body_part : undefined;
    if (typeof bodyPart !== "number") throw new Error(`${record.id} record ${ordinal} has no numeric body_part.`);
    counts.set(bodyPart, (counts.get(bodyPart) ?? 0) + 1);
  }
  return new Map([...counts].sort(([left], [right]) => left - right));
}

const equipmentTableRecords = equipmentTableIds.map(tableId => [tableId, laneTableRecord(tableId)] as const);
const equipmentTablesPresent = equipmentTableRecords.every(([, record]) => record !== null);

describe.skipIf(!equipmentTablesPresent)("decoded body_part values from the data-ui lane store, skipped while its catalog or its weapongrp or armorgrp record is absent", () => {
  it.each(equipmentTableRecords)("maps every distinct %s body_part value to an accepted slot", (tableId, record) => {
    if (record === null) throw new Error(`${tableId} has no tables record.`);
    const counts = decodedBodyPartCounts(record);
    console.log(`${tableId} body_part value:rows ${[...counts].map(([bodyPart, rows]) => `${bodyPart}:${rows}`).join(" ")}`);
    expect(counts.size).toBeGreaterThan(0);
    for (const bodyPart of counts.keys()) {
      const slot = equipmentSlotForBodyPart(bodyPart);
      expect(slot, `${tableId} body_part ${bodyPart}`).not.toBeNull();
      expect(isEquipmentSlot(slot ?? ""), `${tableId} body_part ${bodyPart}`).toBe(true);
    }
  });
});
