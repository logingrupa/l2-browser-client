import { describe, expect, it } from "vitest";
import type { SandboxActionOutcome } from "../../src/ui/devSheet/sandboxPickerHost";
import type { NativeTableNameIndexRead } from "../../src/ui/nativeTables/readNativeTableNameIndex";
import { equipmentSlotForBodyPart, isEquipmentSlot } from "../../src/world/sandboxCommands";
import { fire } from "./support/miniDom";
import { converted, createPickerHarness, nameEntries, settle, type CatalogEntries, type MountedPicker } from "./support/sandboxPickerHarness";

const { mountPicker } = createPickerHarness();

const tileCatalog: CatalogEntries = {
  "tile:20_20": converted("tile:20_20"),
  "tile:20_21": { status: "gap", key: "tile:20_21", reason: "terrain heightmap missing", coverageStatus: "gap" },
};

describe("tile picker", () => {
  it("lists the catalog tile keys with status and reason and reloads the picked tile", () => {
    const picker = mountPicker("tile", { catalog: tileCatalog, currentTileId: "20_20" });
    expect(picker.optionTexts("sandbox-tile-keys")).toEqual(["tile:20_20 converted", "tile:20_21 gap: terrain heightmap missing"]);
    const select = picker.byTestId("sandbox-tile-keys")!.querySelector("select")!;
    select.value = "tile:20_21"; fire(select, "change");
    picker.byTestId("sandbox-tile-keys-pick")!.click();
    expect(picker.fakeHost.reloadedTiles).toEqual(["20_21"]);
    expect(picker.note("sandbox-tile-note")).toBe("tile:20_21 reloaded");
    const variables = Object.fromEntries(picker.variables("sandbox-tile").map(variable => [variable.name, variable]));
    expect(variables["sandbox.tile.current"]?.value()).toBe("20_20");
    expect(variables["sandbox.tile.selected"]?.value()).toBe("tile:20_21");
    expect(variables["sandbox.tile.lookup"]?.value()).toBe("tile:20_21 gap: terrain heightmap missing");
    expect(variables["sandbox.tile.walk"]?.source).toMatch(/existing tap-to-move/);
  });

  it("reloads a typed XX_YY tile, shows the host outcome and rejects other spellings before the host", async () => {
    const picker = mountPicker("tile", { catalog: tileCatalog, reloadOutcome: { tone: "warning", text: "tile:20_21 is not staged" } });
    await picker.submit("sandbox-tile", { tile: "20_21" });
    expect(picker.fakeHost.reloadedTiles).toEqual(["20_21"]);
    expect(picker.note("sandbox-tile-note")).toBe("tile:20_21 is not staged");
    expect(picker.byTestId("sandbox-tile-note")!.dataset.tone).toBe("warning");
    for (const rejected of ["2021", "20-21"]) {
      await picker.submit("sandbox-tile", { tile: rejected });
      expect(picker.message("sandbox-tile").hidden).toBe(false);
    }
    expect(picker.fakeHost.reloadedTiles).toEqual(["20_21"]);
  });

  it("notes an empty tile list instead of an empty select", () => {
    const picker = mountPicker("tile");
    expect(picker.byTestId("sandbox-tile-keys")).toBeNull();
    expect(picker.note("sandbox-tile-keys-empty")).toBe("The catalog index lists no tile: keys.");
  });
});

const itemNameIndex: NativeTableNameIndexRead = { status: "converted", key: "table:itemname_e_names", manifest: "/l2/tables/x/itemname_e_names.json",
  identifierFields: ["id"], entries: nameEntries([[[22], "Leather Shirt"], [[2386], "Wooden Breastplate"]]) };

async function equipByName(picker: MountedPicker, query: string): Promise<void> {
  await picker.submit("sandbox-equip-search", { query });
  await picker.pick("sandbox-equip-search", 0);
}

describe("equip picker", () => {
  it("equips an item picked by name into the upper slot", async () => {
    const picker = mountPicker("equip", { catalog: { "item:22": converted("item:22") }, nameIndexes: { "itemname-e": itemNameIndex } });
    await equipByName(picker, "shirt");
    expect(picker.fakeHost.dispatched).toEqual([{ type: "equip-item", slot: "upper", itemId: 22 }]);
    expect(picker.note("sandbox-equip-note")).toBe("item:22 converted");
  });

  it("equips into the slot equipmentSlotForBodyPart builds from a typed body_part value", async () => {
    const picker = mountPicker("equip", { nameIndexes: { "itemname-e": itemNameIndex } });
    await picker.submit("sandbox-equip-body-part", { bodyPart: "10" });
    await equipByName(picker, "breastplate");
    expect(picker.fakeHost.dispatched).toEqual([{ type: "equip-item", slot: equipmentSlotForBodyPart(10), itemId: 2386 }]);
    const slotVariable = picker.variables("sandbox-equip-item").find(variable => variable.name === "sandbox.equip.slot");
    expect(slotVariable?.value()).toBe(equipmentSlotForBodyPart(10));
    expect(slotVariable?.status).toBe("unverified");
    expect(slotVariable?.source).toBe("02-41 slot form; body_part meaning undecoded");
  });

  it("dispatches only slots that pass isEquipmentSlot", async () => {
    const picker = mountPicker("equip");
    await picker.submit("sandbox-equip-item", { itemId: "22" });
    await picker.submit("sandbox-equip-body-part", { bodyPart: "0" });
    await picker.submit("sandbox-equip-item", { itemId: "22" });
    const slots = picker.fakeHost.dispatched.map(command => command.type === "equip-item" ? command.slot : "not an equip command");
    expect(slots).toEqual(["upper", equipmentSlotForBodyPart(0)]);
    for (const slot of slots) expect(isEquipmentSlot(slot)).toBe(true);
  });

  it.each(["-1", "1.5"])("refuses body_part %s, dispatches nothing and keeps the slot", async rejected => {
    const picker = mountPicker("equip");
    await picker.submit("sandbox-equip-body-part", { bodyPart: rejected });
    expect(picker.fakeHost.dispatched).toEqual([]);
    expect(picker.message("sandbox-equip-body-part").textContent).toBe("body_part value must be a whole number of at most 9 digits.");
    expect(picker.byTestId("sandbox-equip-slot")!.querySelectorAll("[role='radio']").map(chip => chip.textContent)).toEqual(["upper"]);
  });
});

const skillNameIndex: NativeTableNameIndexRead = { status: "converted", key: "table:skillname_e_names", manifest: "/l2/tables/x/skillname_e_names.json",
  identifierFields: ["skill_id", "skill_level"], entries: nameEntries([[[3, 2], "Power Strike"], [[3, 1], "Power Strike"], [[56, 1], "Power Shot"]]) };

describe("cast picker", () => {
  it("lists one row per skill level and casts the picked id and level on the selected entity", async () => {
    const picker = mountPicker("cast", { catalog: { "skill:3:1": converted("skill:3:1") }, nameIndexes: { "skillname-e": skillNameIndex },
      selectedEntityId: "npc-20001-1" });
    await picker.submit("sandbox-cast-search", { query: "power strike" });
    expect(picker.matchTexts("sandbox-cast-search")).toEqual(["Power Strike (skill:3:1 converted)", "Power Strike (skill:3:2 not in catalog)"]);
    await picker.pick("sandbox-cast-search", 1);
    expect(picker.fakeHost.dispatched).toEqual([{ type: "cast-skill", skillId: 3, level: 2, targetId: "npc-20001-1" }]);
    expect(picker.note("sandbox-cast-note")).toBe("skill:3:2 not in catalog");
  });

  it("casts by typed id and level without a target when nothing is selected", async () => {
    const picker = mountPicker("cast");
    await picker.submit("sandbox-cast-skill", { skillId: "56", level: "1" });
    expect(picker.fakeHost.dispatched).toEqual([{ type: "cast-skill", skillId: 56, level: 1 }]);
    expect(picker.variables("sandbox-cast-skill").find(variable => variable.name === "sandbox.cast.target")?.value()).toBe("none");
  });

  it("disables a skill row whose level gives no catalog key", async () => {
    const levelZero: NativeTableNameIndexRead = { ...skillNameIndex, entries: nameEntries([[[9, 0], "Zero Level"]]) };
    const picker = mountPicker("cast", { nameIndexes: { "skillname-e": levelZero } });
    await picker.submit("sandbox-cast-search", { query: "zero" });
    const option = picker.byTestId("sandbox-cast-search-matches")!.querySelector("option")!;
    expect(option.textContent).toBe("Zero Level (identifiers 9:0 give no catalog key)");
    expect(option.disabled).toBe(true);
    picker.byTestId("sandbox-cast-search-pick")!.click();
    expect(picker.fakeHost.dispatched).toEqual([]);
  });
});

const windowCatalog: CatalogEntries = {
  "window:StatusWnd": converted("window:StatusWnd"),
  "window:ShortcutWnd#2": converted("window:ShortcutWnd#2"),
};

describe("window picker", () => {
  it("lists catalog window keys including ordinal ids and shows the awaited host outcome", async () => {
    const picker = mountPicker("window", { catalog: windowCatalog,
      windowOutcome: Promise.resolve({ tone: "warning", text: "ShortcutWnd#2 has an unresolved texture" }) });
    expect(picker.optionTexts("sandbox-window-keys")).toEqual(["window:ShortcutWnd#2 converted", "window:StatusWnd converted"]);
    picker.byTestId("sandbox-window-keys-pick")!.click();
    await settle();
    expect(picker.fakeHost.openedWindows).toEqual(["ShortcutWnd#2"]);
    expect(picker.note("sandbox-window-note")).toBe("ShortcutWnd#2 has an unresolved texture");
  });

  it("opens a typed window id and reports a rejected open as a warning", async () => {
    const picker = mountPicker("window", { catalog: windowCatalog, windowOutcome: Promise.reject(new Error("manifest hash mismatch")) });
    await picker.submit("sandbox-window", { window: "StatusWnd" });
    expect(picker.fakeHost.openedWindows).toEqual(["StatusWnd"]);
    expect(picker.note("sandbox-window-note")).toBe("window:StatusWnd did not open: manifest hash mismatch");
  });

  it("shows no outcome that arrives after release", async () => {
    let resolveOpen: (outcome: SandboxActionOutcome) => void = () => undefined;
    const picker = mountPicker("window", { catalog: windowCatalog, windowOutcome: new Promise(resolve => { resolveOpen = resolve; }) });
    await picker.submit("sandbox-window", { window: "StatusWnd" });
    picker.release();
    resolveOpen({ tone: "info", text: "StatusWnd opened" });
    await settle();
    expect(picker.note("sandbox-window-note")).toBeNull();
    expect(picker.groupElement.children).toHaveLength(picker.childCountBefore);
  });
});
