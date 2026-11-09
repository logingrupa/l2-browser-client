import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DevSheet } from "../../src/ui/devSheet/DevSheet";
import type { NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { attachSandboxCommandSheet } from "../../src/runtime/attachSandboxCommandSheet";
import { installMiniDom, type MiniDom } from "./support/miniDom";
import { attachSandboxSheetWithFakes, fakeCatalogIndexOver } from "./support/sandboxCommandSheetFakes";

const fakeCatalogIndex = fakeCatalogIndexOver(new Map<string, NativeCatalogLookup>([
  ["item:22", { status: "converted", key: "item:22", record: { itemId: 22, slot: "upper", catalogIds: ["fighter-equipment:0"], playerProfileIds: ["human-male-fighter"] } }],
  ["skill:3:1", { status: "converted", key: "skill:3:1", record: { skillId: 3, level: 1, effectComponentId: "interlude:skill:3:level:1:raw-source-dispatch" } }],
  ["npc:21622", { status: "converted", key: "npc:21622", record: { npcId: 21622, profileId: "native-npc-profiles", modelCatalogId: "musveren:0", join: "legacy-single-mesh-match" } }],
  ["window:StatusWnd", { status: "converted", key: "window:StatusWnd", record: { window: "StatusWnd", manifest: "/l2/windows/statuswnd/manifest.json", manifestSha256: "0".repeat(64), manifestBytes: 1 } }],
]));

let dom: MiniDom;
const openSheets: DevSheet[] = [];

function attachWithFakes(selectedEntityId: string | null = "native-musveren", indexFailure: string | null = null) {
  const attached = attachSandboxSheetWithFakes(dom, { index: fakeCatalogIndex, selectedEntityId, indexFailure });
  openSheets.push(attached.sheet);
  return attached;
}

beforeEach(() => { dom = installMiniDom(); });
afterEach(() => { for (const sheet of openSheets.splice(0)) sheet.dispose(); dom.restore(); });

describe("sandbox section picker groups", () => {
  it("holds the six picker groups and none of the superseded by-ID groups", () => {
    const { panel } = attachWithFakes();
    const groupIds = panel.querySelectorAll(".dev-group").map(group => group.dataset.group);
    expect(groupIds).toEqual(["tile", "spawn", "equip", "cast", "window", "clips"]);
    for (const supersededGroupId of ["spawn-npc", "equip-item", "cast-skill", "open-window"]) expect(groupIds).not.toContain(supersededGroupId);
  });

  it("refuses a second attach to the same section while the first is attached", () => {
    const { section, adapter, release } = attachWithFakes();
    const pickerContext = { host: { dispatch() {}, reloadTile: () => ({ tone: "info" as const, text: "" }), openWindow: async () => ({ tone: "info" as const, text: "" }),
      actorClipEntityIds: () => [], actorClipListing: () => null, previewing: () => null },
      catalogIndex: fakeCatalogIndex, readNameIndex: async () => ({ status: "not-in-catalog" as const, key: "table:none", reason: "none" }),
      selectedEntityId: () => null, currentTileId: () => null, signal: new AbortController().signal };
    expect(() => attachSandboxCommandSheet({ section, adapter, pickerContext, indexFailure: null, powerStrike: null }))
      .toThrow("The sandbox pickers are already attached to this section.");
    release();
  });

  it("removes every picker control on release and treats a second release as a no-op", () => {
    const { panel, listeners, release } = attachWithFakes();
    release();
    expect(panel.querySelector('[data-testid="sandbox-spawn-npc"]')).toBeNull();
    expect(panel.querySelector('[data-testid="sandbox-window"]')).toBeNull();
    expect(listeners.size).toBe(0);
    expect(() => release()).not.toThrow();
    expect(listeners.size).toBe(0);
  });
});

describe("sandbox catalog index failure", () => {
  it("shows a warning note on the Sandbox tab when the catalog index could not be built", () => {
    const { panel } = attachWithFakes("native-musveren", "Native catalog has duplicate entries for musveren:0.");
    const failureNote = panel.querySelector('[data-testid="sandbox-catalog-index-failure"]')!;
    expect(failureNote.textContent).toBe("Catalog index unavailable: Native catalog has duplicate entries for musveren:0.");
    expect(failureNote.dataset.tone).toBe("warning");
  });

  it("shows no index note when the index was built", () => {
    const { panel } = attachWithFakes();
    expect(panel.querySelector('[data-testid="sandbox-catalog-index-failure"]')).toBeNull();
  });
});

describe("sandbox pickers dispatch through the runtime host", () => {
  it("spawns NPC 21622 and a missing NPC through the adapter and notes both lookups", async () => {
    const { dispatched, submit, note } = attachWithFakes();
    await submit("sandbox-spawn-npc", { npcId: "21622" });
    expect(note("sandbox-spawn-note")[0]!.textContent).toBe("npc:21622 converted");
    await submit("sandbox-spawn-npc", { npcId: "12345" });
    expect(dispatched).toEqual([{ type: "spawn-npc", npcId: 21622 }, { type: "spawn-npc", npcId: 12345 }]);
    expect(note("sandbox-spawn-note")).toHaveLength(1);
    expect(note("sandbox-spawn-note")[0]!.textContent).toBe("npc:12345 not in catalog");
    expect(note("sandbox-spawn-note")[0]!.dataset.tone).toBe("warning");
  });

  it("equips converted item 22 in the upper slot and notes it as converted", async () => {
    const { dispatched, submit, note } = attachWithFakes();
    await submit("sandbox-equip-item", { itemId: "22" });
    expect(dispatched).toEqual([{ type: "equip-item", slot: "upper", itemId: 22 }]);
    expect(note("sandbox-equip-note")[0]!.textContent).toBe("item:22 converted");
    expect(note("sandbox-equip-note")[0]!.dataset.tone).toBe("info");
  });

  it("casts skill 3 level 1 on the selected entity, and without a target when nothing is selected", async () => {
    const selected = attachWithFakes("native-musveren");
    await selected.submit("sandbox-cast-skill", { skillId: "3", level: "1" });
    expect(selected.dispatched).toEqual([{ type: "cast-skill", skillId: 3, level: 1, targetId: "native-musveren" }]);
    expect(selected.note("sandbox-cast-note")[0]!.textContent).toBe("skill:3:1 converted");
    const unselected = attachSandboxSheetWithFakes(dom, { index: fakeCatalogIndex, selectedEntityId: null });
    openSheets.push(unselected.sheet);
    await unselected.submit("sandbox-cast-skill", { skillId: "3", level: "1" });
    expect(unselected.dispatched).toEqual([{ type: "cast-skill", skillId: 3, level: 1 }]);
  });

  it("opens a converted window and notes a missing one without any adapter dispatch", async () => {
    const { dispatched, openedWindowIds, submit, note } = attachWithFakes();
    await submit("sandbox-window", { window: "StatusWnd" });
    expect(note("sandbox-window-note")[0]!.textContent).toBe("window:StatusWnd opened");
    await submit("sandbox-window", { window: "MissingWnd" });
    expect(note("sandbox-window-note")[0]!.textContent).toBe("window:MissingWnd not in catalog: interface windows are not converted yet (UI-01)");
    expect(note("sandbox-window-note")[0]!.dataset.tone).toBe("warning");
    expect(openedWindowIds).toEqual(["StatusWnd"]);
    expect(dispatched).toEqual([]);
  });

  it("reloads another tile through the location with only map set and never through the adapter", async () => {
    const { adapter, assignedLocations, submit, note } = attachWithFakes();
    await submit("sandbox-tile", { tile: "20_21" });
    expect(assignedLocations).toEqual(["http://127.0.0.1:5173/?map=20_21"]);
    expect(note("sandbox-tile-note")[0]!.textContent).toBe("tile 20_21 reloading");
    expect(adapter.dispatch).not.toHaveBeenCalled();
  });
});

describe("sandbox Power Strike preview", () => {
  it("starts the staged Power Strike preview once for a skill-cast of the converted skill 3 level 1", () => {
    const { emit, powerStrike } = attachWithFakes();
    emit({ type: "skill-cast", casterId: "local-player", skillId: 3, level: 1, targetId: "native-musveren" });
    expect(powerStrike.start).toHaveBeenCalledOnce();
  });

  it("starts nothing for another skill and nothing after release", () => {
    const { emit, powerStrike, release } = attachWithFakes();
    emit({ type: "skill-cast", casterId: "local-player", skillId: 7, level: 1 });
    release();
    emit({ type: "skill-cast", casterId: "local-player", skillId: 3, level: 1 });
    expect(powerStrike.start).not.toHaveBeenCalled();
  });
});
