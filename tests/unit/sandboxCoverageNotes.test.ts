import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DevSheet } from "../../src/ui/devSheet/DevSheet";
import type { NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { describeSandboxCatalogLookup } from "../../src/runtime/sandboxCatalogLookupNote";
import { installMiniDom, type MiniDom } from "./support/miniDom";
import { attachSandboxSheetWithFakes, fakeCatalogIndexOver } from "./support/sandboxCommandSheetFakes";

const rabbitGapReason = "converter-refused:Mesh bone has no unique native parent/name mapping: bip01 r finger0nub";
const gremlinLookup: NativeCatalogLookup = { status: "converted", key: "npc:20001",
  record: { npcId: 20001, profileId: "interlude:npc-profiles:pack-b01bce43a24fdadd", modelCatalogId: "npc-model:gremlin", join: "model-catalog-id" } };
const rabbitLookup: NativeCatalogLookup = { status: "gap", key: "npc:20002", reason: rabbitGapReason, coverageStatus: "gap" };

describe("describeSandboxCatalogLookup", () => {
  it("notes a converted key with the info tone", () => {
    expect(describeSandboxCatalogLookup(gremlinLookup)).toEqual({ tone: "info", text: "npc:20001 converted" });
  });

  it("notes a gap with the warning tone and the coverage reason verbatim", () => {
    expect(describeSandboxCatalogLookup(rabbitLookup)).toEqual({ tone: "warning", text: `npc:20002 gap: ${rabbitGapReason}` });
  });

  it("notes a key the catalog does not hold with the warning tone", () => {
    expect(describeSandboxCatalogLookup({ status: "not-in-catalog", key: "npc:999999", reason: "not in catalog" }))
      .toEqual({ tone: "warning", text: "npc:999999 not in catalog" });
  });

  it("names a not-in-catalog reason other than the plain one after the status", () => {
    expect(describeSandboxCatalogLookup({ status: "not-in-catalog", key: "npc:999999", reason: "npc profile names no converted model" }))
      .toEqual({ tone: "warning", text: "npc:999999 not in catalog: npc profile names no converted model" });
  });

  it("keeps a reason holding markup as literal text", () => {
    expect(describeSandboxCatalogLookup({ status: "gap", key: "npc:20002", reason: "<b>refused</b>", coverageStatus: "failed" }).text)
      .toBe("npc:20002 gap: <b>refused</b>");
  });
});

let dom: MiniDom;
const openSheets: DevSheet[] = [];

function attachWithLaneLookups() {
  const attached = attachSandboxSheetWithFakes(dom, { index: fakeCatalogIndexOver(new Map([[gremlinLookup.key, gremlinLookup], [rabbitLookup.key, rabbitLookup]])) });
  openSheets.push(attached.sheet);
  return attached;
}

beforeEach(() => { dom = installMiniDom(); });
afterEach(() => { for (const sheet of openSheets.splice(0)) sheet.dispose(); dom.restore(); });

describe("sandbox spawn NPC coverage notes", () => {
  it.each([
    ["20001", "npc:20001 converted", "info"],
    ["20002", `npc:20002 gap: ${rabbitGapReason}`, "warning"],
    ["999999", "npc:999999 not in catalog", "warning"],
  ])("still dispatches npc %s and notes its lookup", (npcId, expectedText, expectedTone) => {
    const { dispatched, submit, note } = attachWithLaneLookups();
    submit("sandbox-spawn-npc", { npcId });
    expect(dispatched).toEqual([{ type: "spawn-npc", npcId: Number(npcId) }]);
    expect(note("sandbox-spawn-npc")).toHaveLength(1);
    expect(note("sandbox-spawn-npc")[0]!.textContent).toBe(expectedText);
    expect(note("sandbox-spawn-npc")[0]!.dataset.tone).toBe(expectedTone);
  });

  it("writes a gap reason holding markup as note text, not as elements", () => {
    const markupLookup: NativeCatalogLookup = { status: "gap", key: "npc:20002", reason: "<b>refused</b>", coverageStatus: "gap" };
    const attached = attachSandboxSheetWithFakes(dom, { index: fakeCatalogIndexOver(new Map([[markupLookup.key, markupLookup]])) });
    openSheets.push(attached.sheet);
    attached.submit("sandbox-spawn-npc", { npcId: "20002" });
    const spawnNote = attached.note("sandbox-spawn-npc")[0]!;
    expect(spawnNote.textContent).toBe("npc:20002 gap: <b>refused</b>");
    expect(spawnNote.querySelector("b")).toBeNull();
  });
});
