import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import type { AssetPackage } from "../../src/assets/package/readAssetPackage";
import type { NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { presentEquippedItem, type GeneratedCharacterProfile } from "../../src/assets/native/nativeEquippedItemPresentation";
import type { NativeEquippedItemSource } from "../../src/assets/native/nativeEquippedItemSource";
import { nativeCharacterFactory } from "../../src/assets/native/NativeCharacterVisual";
import type { WorldEntity } from "../../src/world/worldTypes";
import { nativeVisualClips, nativeVisualFixture } from "../fixtures/nativeVisualFixture";

const weaponRecordId = "interlude:item:1:body-part:7:weapon";
const weaponLookup: NativeCatalogLookup = { status: "converted", key: "item:1",
  record: { itemId: 1, slot: "body-part:7", catalogIds: [weaponRecordId], playerProfileIds: [] } };
const armorLookup: NativeCatalogLookup = { status: "converted", key: "item:26", record: { itemId: 26, slot: "body-part:6",
  catalogIds: ["interlude:item:26:body-part:6:armor:0", "interlude:item:26:body-part:6:armor:2"], playerProfileIds: [] } };
const upperLookup: NativeCatalogLookup = { status: "converted", key: "item:22",
  record: { itemId: 22, slot: "upper", catalogIds: ["fighter-equipment:0"], playerProfileIds: ["human-male-fighter"] } };
const classDefaults = { class: "LineageWarrior.Fixture", classPackageSha256: "b".repeat(64), HeadBone: "NativeRoot", RightHandBone: "NativeBone" };
const generatedProfile: GeneratedCharacterProfile = { chargrpIndex: 0, sourceObject: "Fixture.Upper", sourceEvidence: { actorClassDefaults: classDefaults } };

async function reviewedMaleFighterRig(): Promise<AssetPackage> {
  const asset = await nativeVisualFixture();
  asset.manifest.id = "interlude:assembly:MFighter-native-body-face0-hair0";
  asset.manifest.source = { edition: "interlude", package: "Fighter", object: "Fighter.MFighter_m001_u", assembly: ["Fighter.MFighter_m001_u"],
    sha256: "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c" };
  asset.manifest.files[0]!.sha256 = "448dd406d001a45057f41a564f022ef1068623921605b1206bd5483e630704ce";
  return asset;
}

describe("presentEquippedItem", () => {
  it("attaches a weapon at the reviewed rig hand anchor, labelled presentation because the native transform is unverified", async () => {
    expect(presentEquippedItem("body-part:7", weaponLookup, { asset: await reviewedMaleFighterRig() })).toEqual({ kind: "attached",
      catalogId: weaponRecordId, sourceObject: "Fighter.MFighter_m001_u", boneName: "Weapon_R_Bone", status: "presentation" });
  });

  it("attaches a weapon on a generated character at the RightHandBone of its class defaults", async () => {
    expect(presentEquippedItem("body-part:7", weaponLookup, { asset: await nativeVisualFixture({ skinned: true }), generatedProfile })).toEqual({
      kind: "attached", catalogId: weaponRecordId, sourceObject: "Fixture.Upper", boneName: "NativeBone", status: "presentation" });
  });

  it.each([
    ["a weapon on a model without a qualified rig", weaponLookup, "body-part:7", false, "item:1 gap: This model has no qualified human right-hand rig binding."],
    ["armor in its body-part slot", armorLookup, "body-part:6", true, "item:26 gap: equipment-slot-meaning-undecoded:6"],
    ["an item equipped into another body-part slot", weaponLookup, "body-part:3", true, "item:1 converted for body-part:7, not body-part:3"],
    ["an upper-slot item equipped into a body-part slot", upperLookup, "body-part:10", true, "item:22 converted for upper, not body-part:10"],
    ["an item not in the catalog", { status: "not-in-catalog", key: "item:9", reason: "not in catalog" }, "body-part:7", true, "item:9 not in catalog"],
    ["an item with a coverage gap", { status: "gap", key: "item:5", reason: "no-mesh-in-row", coverageStatus: "gap" }, "body-part:7", true,
      "item:5 gap: no-mesh-in-row"],
  ] as const)("gives a gap with the reason text for %s", async (_label, lookup, slot, reviewedRig, reason) => {
    const asset = reviewedRig ? await reviewedMaleFighterRig() : await nativeVisualFixture();
    expect(presentEquippedItem(slot, lookup, { asset })).toEqual({ kind: "gap", reason });
  });

  it("gives the class defaults reason for a generated character whose class names no RightHandBone", async () => {
    const asset = await nativeVisualFixture({ skinned: true });
    expect(presentEquippedItem("body-part:7", weaponLookup, { asset, generatedProfile: { ...generatedProfile, sourceEvidence: {} } }))
      .toEqual({ kind: "gap", reason: "item:1 gap: class-template-mapping-undecoded" });
    expect(presentEquippedItem("body-part:7", weaponLookup, { asset,
      generatedProfile: { ...generatedProfile, sourceEvidence: { actorClassDefaults: { ...classDefaults, RightHandBone: null } } } }))
      .toEqual({ kind: "gap", reason: "item:1 gap: actor-default-unresolved:RightHandBone" });
  });
});

describe("body-part items on a native character visual", () => {
  const releases: (() => void)[] = [];
  afterEach(() => { for (const release of releases.splice(0).reverse()) release(); });
  const initial: WorldEntity = { id: "generated-character", kind: "remote-player", appearanceId: "fixture", displayName: "Fixture",
    health: 100, maximumHealth: 100, animation: "idle", position: { x: 0, y: 0, z: 0 }, orientationRadians: 0 };

  it("attaches a weapon under the class-default hand anchor, shows armor as its gap and removes both on unequip", async () => {
    const engine = new NullEngine(), scene = new Scene(engine); GetEnvironmentBRDFTexture(scene);
    releases.push(() => { scene.dispose(); engine.dispose(); });
    const weapon = await nativeVisualFixture({ skinned: true, parts: ["Sword"], material: "sword" });
    const lookups = new Map([[1, weaponLookup], [26, armorLookup]]);
    const loadedCatalogIds: string[] = [];
    const source: NativeEquippedItemSource = {
      lookup: async itemId => lookups.get(itemId) ?? { status: "not-in-catalog", key: `item:${itemId}`, reason: "not in catalog" },
      loadModel: async catalogId => { loadedCatalogIds.push(catalogId); return weapon; },
    };
    const statuses: string[] = [];
    const visual = nativeCharacterFactory(new Map([["fixture", { asset: await nativeVisualFixture({ skinned: true }), clips: nativeVisualClips,
      generatedProfile }]]), source)(scene, initial, message => statuses.push(message));
    releases.push(() => visual.dispose());
    await visual.ready;
    const meshesBeforeEquip = scene.meshes.length;
    visual.setEntity({ ...initial, equipment: { "body-part:6": 26, "body-part:7": 1 } });
    await vi.waitFor(() => expect(visual.attachmentSnapshot().find(anchor => anchor.id === "body-part:7")?.attachedMeshNames).toEqual(["Sword"]));
    expect(visual.attachmentSnapshot()).toMatchObject([{ id: "body-part:7", sourceObject: "Fixture.Upper", boneName: "NativeBone", status: "ready" }]);
    expect(visual.missingAssetDiagnostic).toBe("item:26 gap: equipment-slot-meaning-undecoded:6");
    expect(statuses).toContain("item:26 gap: equipment-slot-meaning-undecoded:6");
    expect(loadedCatalogIds).toEqual([weaponRecordId]);
    visual.setEntity({ ...initial, equipment: {} });
    expect(visual.attachmentSnapshot()).toEqual([]);
    expect(visual.missingAssetDiagnostic).toBeNull();
    expect(scene.meshes.length).toBe(meshesBeforeEquip);
  });
});
