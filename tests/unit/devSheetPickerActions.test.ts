import { describe, expect, it } from "vitest";
import type { SandboxActionOutcome } from "../../src/ui/devSheet/sandboxPickerHost";
import type { NativeTableNameIndexRead } from "../../src/ui/nativeTables/readNativeTableNameIndex";
import { equipmentSlotForBodyPart, isEquipmentSlot } from "../../src/world/sandboxCommands";
import { converted, createPickerHarness, nameEntries, settle, type CatalogEntries, type MountedPicker } from "./support/sandboxPickerHarness";

const { mountPicker } = createPickerHarness();
const tileKeys = "sandbox-tile-keys";
const windowKeys = "sandbox-window-keys";

const tileCatalog: CatalogEntries = {
  "tile:20_20": converted("tile:20_20"),
  "tile:20_21": { status: "gap", key: "tile:20_21", reason: "terrain heightmap missing", coverageStatus: "gap" },
};

describe("tile picker", () => {
  it("lists the catalog tiles with status and reason, refuses a gap tile and reloads only on the Reload button", async () => {
    const picker = mountPicker("tile", { catalog: tileCatalog, currentTileId: "20_20" });
    await picker.open(tileKeys);
    expect(picker.rowTexts(tileKeys)).toEqual(["20_20 tile:20_20 converted", "20_21 tile:20_21 gap: terrain heightmap missing"]);
    expect(picker.byTestId(`${tileKeys}-option-1`)!.getAttribute("aria-disabled")).toBe("true");
    await picker.pick(tileKeys, 1);
    expect(picker.fakeHost.reloadedTiles).toEqual([]);
    picker.byTestId(`${tileKeys}-option-0`)!.click();
    expect(picker.fakeHost.reloadedTiles).toEqual([]);
    picker.byTestId(`${tileKeys}-pick`)!.click();
    expect(picker.fakeHost.reloadedTiles).toEqual(["20_20"]);
    expect(picker.note("sandbox-tile-note")).toBe("tile:20_20 reloaded");
    const variables = Object.fromEntries(picker.variables(tileKeys).map(variable => [variable.name, variable]));
    expect(variables["sandbox.tile.current"]?.value()).toBe("20_20");
    expect(variables["sandbox.tile.selected"]?.value()).toBe("tile:20_20");
    expect(variables["sandbox.tile.lookup"]?.value()).toBe("tile:20_20 converted");
    expect(variables["sandbox.tile.walk"]?.source).toMatch(/existing tap-to-move/);
  });

  it("offers a typed XX_YY tile that is not in the catalog, shows the host outcome and offers no other spelling", async () => {
    const picker = mountPicker("tile", { catalog: tileCatalog, reloadOutcome: { tone: "warning", text: "tile:20_22 is not staged" } });
    await picker.type(tileKeys, "20_22");
    expect(picker.rowTexts(tileKeys)).toEqual(["20_22 tile:20_22 not in catalog"]);
    await picker.pick(tileKeys, 0);
    expect(picker.fakeHost.reloadedTiles).toEqual(["20_22"]);
    expect(picker.note("sandbox-tile-note")).toBe("tile:20_22 is not staged");
    expect(picker.byTestId("sandbox-tile-note")!.dataset.tone).toBe("warning");
    for (const rejected of ["2022", "20-22"]) {
      await picker.type(tileKeys, rejected);
      expect(picker.rowTexts(tileKeys)).toEqual([]);
      expect(picker.byTestId(`${tileKeys}-pick`)!.disabled).toBe(true);
    }
    expect(picker.fakeHost.reloadedTiles).toEqual(["20_22"]);
  });

  it("notes an empty tile list and still takes a typed tile", async () => {
    const picker = mountPicker("tile");
    expect(picker.note(`${tileKeys}-empty`)).toBe("The catalog index lists no tile: keys.");
    await picker.type(tileKeys, "20_21");
    expect(picker.rowTexts(tileKeys)).toEqual(["20_21 tile:20_21 not in catalog"]);
  });
});

const itemNameIndex: NativeTableNameIndexRead = { status: "converted", key: "table:itemname_e_names", manifest: "/l2/tables/x/itemname_e_names.json",
  identifierFields: ["id"], entries: nameEntries([[[22], "Leather Shirt"], [[2386], "Wooden Breastplate"]]) };

async function equipByName(picker: MountedPicker, query: string): Promise<void> {
  await picker.type("sandbox-equip-search", query);
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
    await picker.type("sandbox-cast-search", "power strike");
    expect(picker.rowTexts("sandbox-cast-search")).toEqual(["Power Strike skill:3:1 converted", "Power Strike skill:3:2 not in catalog"]);
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
    await picker.type("sandbox-cast-search", "zero");
    expect(picker.rowTexts("sandbox-cast-search")).toEqual(["Zero Level identifiers 9:0 gives no catalog key"]);
    expect(picker.byTestId("sandbox-cast-search-option-0")!.getAttribute("aria-disabled")).toBe("true");
    await picker.pick("sandbox-cast-search", 0);
    expect(picker.fakeHost.dispatched).toEqual([]);
  });
});

const windowCatalog: CatalogEntries = {
  "window:StatusWnd": converted("window:StatusWnd"),
  "window:ShortcutWnd#2": converted("window:ShortcutWnd#2"),
};

describe("window picker", () => {
  it("lists catalog windows including ordinal ids and shows the awaited host outcome", async () => {
    const picker = mountPicker("window", { catalog: windowCatalog,
      windowOutcome: Promise.resolve({ tone: "warning", text: "ShortcutWnd#2 has an unresolved texture" }) });
    await picker.open(windowKeys);
    expect(picker.rowTexts(windowKeys)).toEqual(["ShortcutWnd#2 window:ShortcutWnd#2 converted", "StatusWnd window:StatusWnd converted"]);
    await picker.pick(windowKeys, 0);
    expect(picker.fakeHost.openedWindows).toEqual(["ShortcutWnd#2"]);
    expect(picker.note("sandbox-window-note")).toBe("ShortcutWnd#2 has an unresolved texture");
    expect(picker.variables(windowKeys).find(variable => variable.name === "sandbox.window.selected")?.value()).toBe("window:ShortcutWnd#2");
  });

  it("lists windows through the registry: base name, then ordinal as a number, with each status", async () => {
    const picker = mountPicker("window", { catalog: {
      "window:Back2#10": converted("window:Back2#10"),
      "window:Back2#2": converted("window:Back2#2"),
      "window:Back2": converted("window:Back2"),
      "window:ChatWnd": { status: "gap", key: "window:ChatWnd", reason: "decode-failed:FormatError", coverageStatus: "gap" },
    } });
    await picker.open(windowKeys);
    expect(picker.rowTexts(windowKeys)).toEqual([
      "Back2 window:Back2 converted", "Back2#2 window:Back2#2 converted", "Back2#10 window:Back2#10 converted",
      "ChatWnd window:ChatWnd gap: decode-failed:FormatError"]);
  });

  it("notes no windows converted for an empty registry and still takes a typed window", async () => {
    const picker = mountPicker("window");
    expect(picker.note(`${windowKeys}-empty`)).toBe("no windows converted");
    await picker.type(windowKeys, "StatusWnd");
    expect(picker.rowTexts(windowKeys)).toEqual(["StatusWnd window:StatusWnd not in catalog"]);
  });

  it("opens a typed window id and reports a rejected open as a warning", async () => {
    const picker = mountPicker("window", { catalog: windowCatalog, windowOutcome: Promise.reject(new Error("manifest hash mismatch")) });
    await picker.type(windowKeys, "MissingWnd");
    expect(picker.rowTexts(windowKeys)).toEqual(["MissingWnd window:MissingWnd not in catalog"]);
    await picker.pick(windowKeys, 0);
    expect(picker.fakeHost.openedWindows).toEqual(["MissingWnd"]);
    expect(picker.note("sandbox-window-note")).toBe("window:MissingWnd did not open: manifest hash mismatch");
  });

  it("shows no outcome that arrives after release", async () => {
    let resolveOpen: (outcome: SandboxActionOutcome) => void = () => undefined;
    const picker = mountPicker("window", { catalog: windowCatalog, windowOutcome: new Promise(resolve => { resolveOpen = resolve; }) });
    await picker.type(windowKeys, "StatusWnd");
    await picker.pick(windowKeys, 0);
    picker.release();
    resolveOpen({ tone: "info", text: "StatusWnd opened" });
    await settle();
    expect(picker.note("sandbox-window-note")).toBeNull();
    expect(picker.groupElement.children).toHaveLength(picker.childCountBefore);
  });
});
