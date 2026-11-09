import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DevSheet } from "../../src/ui/devSheet/DevSheet";
import type { NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";
import { attachSandboxSheetWithFakes, fakeCatalogIndexOver } from "./support/sandboxCommandSheetFakes";

const rabbitGapReason = "converter-refused:Mesh bone has no unique native parent/name mapping: bip01 r finger0nub";
const gremlinLookup: NativeCatalogLookup = { status: "converted", key: "npc:20001",
  record: { npcId: 20001, profileId: "interlude:npc-profiles:pack-b01bce43a24fdadd", modelCatalogId: "npc-model:gremlin", join: "model-catalog-id" } };
const rabbitLookup: NativeCatalogLookup = { status: "gap", key: "npc:20002", reason: rabbitGapReason, coverageStatus: "gap" };

const laneLookups: readonly NativeCatalogLookup[] = [
  gremlinLookup, rabbitLookup,
  { status: "converted", key: "item:22", record: { itemId: 22, slot: "upper", catalogIds: ["fighter-equipment:0"], playerProfileIds: ["human-male-fighter"] } },
  { status: "gap", key: "item:23", reason: "item-mesh-unresolved", coverageStatus: "pending" },
  { status: "converted", key: "skill:3:1", record: { skillId: 3, level: 1, effectComponentId: "interlude:skill:3:level:1:raw-source-dispatch" } },
  { status: "gap", key: "skill:7:1", reason: "native-skill-dispatch-required", coverageStatus: "gap" },
  { status: "converted", key: "window:StatusWnd", record: { window: "StatusWnd", manifest: "/l2/windows/statuswnd/manifest.json", manifestSha256: "0".repeat(64), manifestBytes: 1 } },
  { status: "gap", key: "window:InventoryWnd", reason: "window-texture-missing", coverageStatus: "failed" },
];

let dom: MiniDom;
const openSheets: DevSheet[] = [];

function attachWithLaneLookups(lookups: readonly NativeCatalogLookup[] = laneLookups) {
  const attached = attachSandboxSheetWithFakes(dom, { index: fakeCatalogIndexOver(new Map(lookups.map(lookup => [lookup.key, lookup]))) });
  openSheets.push(attached.sheet);
  return attached;
}

function openEntryCard(sheet: DevSheet, panel: FakeElement, testId: string): FakeElement {
  panel.querySelector(`[data-testid="${testId}"] .dev-info`)!.click();
  return sheet.cards.element as unknown as FakeElement;
}

function variableValue(card: FakeElement, name: string): string {
  return card.querySelector(`[data-variable="${name}"] .dev-variable-value`)!.textContent;
}

beforeEach(() => { dom = installMiniDom(); });
afterEach(() => { for (const sheet of openSheets.splice(0)) sheet.dispose(); dom.restore(); });

describe("spawn picker coverage notes", () => {
  it.each([
    ["20001", "npc:20001 converted", "info"],
    ["20002", `npc:20002 gap: ${rabbitGapReason}`, "warning"],
    ["999999", "npc:999999 not in catalog", "warning"],
  ])("still dispatches npc %s and notes its lookup", async (npcId, expectedText, expectedTone) => {
    const { dispatched, submit, note } = attachWithLaneLookups();
    await submit("sandbox-spawn-npc", { npcId });
    expect(dispatched).toEqual([{ type: "spawn-npc", npcId: Number(npcId) }]);
    expect(note("sandbox-spawn-note")).toHaveLength(1);
    expect(note("sandbox-spawn-note")[0]!.textContent).toBe(expectedText);
    expect(note("sandbox-spawn-note")[0]!.dataset.tone).toBe(expectedTone);
  });

  it("shows the last lookup with its reason in the sandbox.spawn.lookup variable from the catalog index", async () => {
    const { submit, sheet, panel } = attachWithLaneLookups();
    await submit("sandbox-spawn-npc", { npcId: "20002" });
    const card = openEntryCard(sheet, panel, "sandbox-spawn-npc");
    expect(variableValue(card, "sandbox.spawn.lookup")).toBe(`npc:20002 gap: ${rabbitGapReason}`);
    expect(card.querySelector('[data-variable="sandbox.spawn.lookup"] .dev-badge')!.dataset.status).toBe("native");
    expect(card.querySelector('[data-variable="sandbox.spawn.lookup"] .dev-variable-source')!.textContent).toContain("/l2/coverage.json");
  });

  it("writes a gap reason holding markup as note text, not as elements", async () => {
    const { submit, note } = attachWithLaneLookups([{ status: "gap", key: "npc:20002", reason: "<b>refused</b>", coverageStatus: "gap" }]);
    await submit("sandbox-spawn-npc", { npcId: "20002" });
    const spawnNote = note("sandbox-spawn-note")[0]!;
    expect(spawnNote.textContent).toBe("npc:20002 gap: <b>refused</b>");
    expect(spawnNote.querySelector("b")).toBeNull();
  });
});

describe("equip, cast and window picker coverage notes", () => {
  it.each([
    ["sandbox-equip-item", "sandbox-equip-note", { itemId: "22" }, "item:22 converted", "info"],
    ["sandbox-equip-item", "sandbox-equip-note", { itemId: "23" }, "item:23 gap: item-mesh-unresolved", "warning"],
    ["sandbox-equip-item", "sandbox-equip-note", { itemId: "999999" }, "item:999999 not in catalog", "warning"],
    ["sandbox-cast-skill", "sandbox-cast-note", { skillId: "3", level: "1" }, "skill:3:1 converted", "info"],
    ["sandbox-cast-skill", "sandbox-cast-note", { skillId: "7", level: "1" }, "skill:7:1 gap: native-skill-dispatch-required", "warning"],
    ["sandbox-cast-skill", "sandbox-cast-note", { skillId: "999999", level: "1" }, "skill:999999:1 not in catalog", "warning"],
    ["sandbox-window", "sandbox-window-note", { window: "StatusWnd" }, "window:StatusWnd opened", "info"],
    ["sandbox-window", "sandbox-window-note", { window: "MissingWnd" }, "window:MissingWnd not in catalog: interface windows are not converted yet (UI-01)", "warning"],
  ])("%s with %o notes %s", async (testId, noteTestId, values, expectedText, expectedTone) => {
    const { submit, note } = attachWithLaneLookups();
    await submit(testId, values);
    expect(note(noteTestId)).toHaveLength(1);
    expect(note(noteTestId)[0]!.textContent).toBe(expectedText);
    expect(note(noteTestId)[0]!.dataset.tone).toBe(expectedTone);
  });

  it("lists every catalog window with its status and gap reason in the window picker, in registry order", () => {
    const { panel } = attachWithLaneLookups();
    const optionTexts = panel.querySelector('[data-testid="sandbox-window-keys"]')!.querySelectorAll("option").map(option => option.textContent);
    expect(optionTexts).toEqual(["window:InventoryWnd gap: window-texture-missing", "window:StatusWnd converted"]);
  });

  it("still dispatches a gap item and a gap skill", async () => {
    const { dispatched, submit } = attachWithLaneLookups();
    await submit("sandbox-equip-item", { itemId: "23" });
    await submit("sandbox-cast-skill", { skillId: "7", level: "1" });
    expect(dispatched).toEqual([{ type: "equip-item", slot: "upper", itemId: 23 }, { type: "cast-skill", skillId: 7, level: 1, targetId: "native-musveren" }]);
  });

  it("never dispatches a window open, whatever its lookup", async () => {
    const { dispatched, submit } = attachWithLaneLookups();
    for (const window of ["StatusWnd", "InventoryWnd", "MissingWnd"]) await submit("sandbox-window", { window });
    expect(dispatched).toEqual([]);
  });
});
