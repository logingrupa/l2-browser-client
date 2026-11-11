import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { Scene } from "@babylonjs/core/scene";
import { NativeActor } from "../../src/assets/native/NativeActor";
import type { NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { NativeEquippedBodyPartItems, type EquippedItemPresenter } from "../../src/assets/native/nativeEquippedBodyPartItems";
import { presentEquippedItem, type GeneratedCharacterProfile } from "../../src/assets/native/nativeEquippedItemPresentation";
import type { NativeEquippedItemSource } from "../../src/assets/native/nativeEquippedItemSource";
import type { AssetPackage } from "../../src/assets/package/readAssetPackage";
import { nativeVisualFixture } from "../fixtures/nativeVisualFixture";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(settle => { resolve = settle; });
  return { promise, resolve };
}

const weaponCatalogId = (itemId: number) => `interlude:item:${itemId}:body-part:7:weapon`;
const convertedWeapon = (itemId: number): NativeCatalogLookup => ({ status: "converted", key: `item:${itemId}`,
  record: { itemId, slot: "body-part:7", catalogIds: [weaponCatalogId(itemId)], playerProfileIds: [] } });
const generatedProfile: GeneratedCharacterProfile = { chargrpIndex: 0, sourceObject: "Fixture.Upper", sourceEvidence: { actorClassDefaults: {
  class: "LineageWarrior.Fixture", classPackageSha256: "b".repeat(64), HeadBone: "NativeRoot", RightHandBone: "NativeBone" } } };

function drainPendingCallbacks(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

const releases: (() => void)[] = [];
afterEach(() => { for (const release of releases.splice(0).reverse()) release(); vi.restoreAllMocks(); });

async function fixture() {
  const engine = new NullEngine(), scene = new Scene(engine); GetEnvironmentBRDFTexture(scene);
  const lifetime = new AbortController();
  releases.push(() => { lifetime.abort(); scene.dispose(); engine.dispose(); });
  const characterAsset = await nativeVisualFixture({ skinned: true });
  const character = await NativeActor.create(scene, characterAsset, lifetime.signal);
  const presentAtGeneratedHand: EquippedItemPresenter = (slot, lookup) => presentEquippedItem(slot, lookup, { asset: characterAsset, generatedProfile });
  releases.push(() => character.dispose());
  const weapon = await nativeVisualFixture({ skinned: true, parts: ["Sword"], material: "sword" });
  const pendingLookups = new Map<number, Deferred<NativeCatalogLookup>>(), pendingModels = new Map<string, Deferred<AssetPackage>>();
  const lookupRequests: number[] = [], modelRequests: string[] = [];
  const source: NativeEquippedItemSource = {
    lookup(itemId) {
      lookupRequests.push(itemId);
      const lookup = deferred<NativeCatalogLookup>(); pendingLookups.set(itemId, lookup);
      return lookup.promise;
    },
    loadModel(catalogId) {
      modelRequests.push(catalogId);
      const model = deferred<AssetPackage>(); pendingModels.set(catalogId, model);
      return model.promise;
    },
  };
  const diagnostics: string[] = [];
  const items = new NativeEquippedBodyPartItems(scene, source, lifetime.signal, diagnostic => diagnostics.push(diagnostic));
  releases.push(() => items.dispose());
  const createdModels = vi.spyOn(NativeActor, "create");
  const modelCreationsSettled = async () => { await Promise.allSettled(createdModels.mock.results.map(result => result.value)); await drainPendingCallbacks(); };
  const baseline = { meshes: scene.meshes.length, transformNodes: scene.transformNodes.length };
  return { scene, lifetime, character, weapon, source, items, diagnostics, pendingLookups, pendingModels, lookupRequests, modelRequests,
    modelCreationsSettled, baseline, equip: (equipment: Partial<Record<"body-part:6" | "body-part:7", number>>) => items.update(character, equipment, presentAtGeneratedHand) };
}

describe("native equipped body-part item lifecycle", () => {
  it("attaches a converted weapon under the hand anchor and disposes the anchor and model on dispose", async () => {
    const f = await fixture();
    f.equip({ "body-part:7": 1 });
    f.pendingLookups.get(1)!.resolve(convertedWeapon(1));
    await vi.waitFor(() => expect(f.modelRequests).toEqual([weaponCatalogId(1)]));
    f.pendingModels.get(weaponCatalogId(1))!.resolve(f.weapon);
    await vi.waitFor(() => expect(f.items.anchorSnapshots().map(anchor => anchor.id)).toEqual(["body-part:7"]));
    expect(f.scene.meshes.length).toBeGreaterThan(f.baseline.meshes);
    f.items.dispose();
    expect(f.items.anchorSnapshots()).toEqual([]);
    expect({ meshes: f.scene.meshes.length, transformNodes: f.scene.transformNodes.length }).toEqual(f.baseline);
  });

  it("never loads a model for an item unequipped while its lookup is pending", async () => {
    const f = await fixture();
    f.equip({ "body-part:7": 1 });
    f.equip({});
    f.pendingLookups.get(1)!.resolve(convertedWeapon(1));
    await drainPendingCallbacks();
    expect(f.modelRequests).toEqual([]);
    expect(f.items.diagnostic).toBeNull();
    expect(f.diagnostics).toEqual([]);
  });

  it("leaves no model in the scene for an item unequipped while its model loads", async () => {
    const f = await fixture();
    f.equip({ "body-part:7": 1 });
    f.pendingLookups.get(1)!.resolve(convertedWeapon(1));
    await vi.waitFor(() => expect(f.modelRequests).toEqual([weaponCatalogId(1)]));
    f.equip({});
    f.pendingModels.get(weaponCatalogId(1))!.resolve(f.weapon);
    await f.modelCreationsSettled();
    expect(f.items.anchorSnapshots()).toEqual([]);
    expect(f.diagnostics).toEqual([]);
    expect({ meshes: f.scene.meshes.length, transformNodes: f.scene.transformNodes.length }).toEqual(f.baseline);
  });

  it("presents only the replacement when one slot swaps items before the first resolves", async () => {
    const f = await fixture();
    f.equip({ "body-part:7": 1 });
    f.equip({ "body-part:7": 2 });
    expect(f.lookupRequests).toEqual([1, 2]);
    f.pendingLookups.get(2)!.resolve(convertedWeapon(2));
    f.pendingLookups.get(1)!.resolve(convertedWeapon(1));
    await vi.waitFor(() => expect(f.modelRequests).toEqual([weaponCatalogId(2)]));
    f.pendingModels.get(weaponCatalogId(2))!.resolve(f.weapon);
    await vi.waitFor(() => expect(f.items.anchorSnapshots().map(anchor => anchor.id)).toEqual(["body-part:7"]));
    await f.modelCreationsSettled();
    expect(f.modelRequests).toEqual([weaponCatalogId(2)]);
  });

  it("joins gap diagnostics in equipment slot order whatever order the lookups resolve in", async () => {
    const f = await fixture();
    f.equip({ "body-part:6": 26, "body-part:7": 5 });
    f.pendingLookups.get(5)!.resolve({ status: "gap", key: "item:5", reason: "no-mesh-in-row", coverageStatus: "gap" });
    f.pendingLookups.get(26)!.resolve({ status: "not-in-catalog", key: "item:26", reason: "not in catalog" });
    await vi.waitFor(() => expect(f.diagnostics).toHaveLength(2));
    expect(f.diagnostics).toEqual(["item:5 gap: no-mesh-in-row", "item:26 not in catalog"]);
    expect(f.items.diagnostic).toBe("item:26 not in catalog; item:5 gap: no-mesh-in-row");
    f.equip({ "body-part:7": 5 });
    expect(f.items.diagnostic).toBe("item:5 gap: no-mesh-in-row");
  });

  it("drops a model that finishes loading after the character is disposed", async () => {
    const f = await fixture();
    f.equip({ "body-part:7": 1 });
    f.pendingLookups.get(1)!.resolve(convertedWeapon(1));
    await vi.waitFor(() => expect(f.modelRequests).toEqual([weaponCatalogId(1)]));
    f.items.dispose();
    f.pendingModels.get(weaponCatalogId(1))!.resolve(f.weapon);
    await f.modelCreationsSettled();
    expect(f.items.anchorSnapshots()).toEqual([]);
    expect(f.diagnostics).toEqual([]);
    expect({ meshes: f.scene.meshes.length, transformNodes: f.scene.transformNodes.length }).toEqual(f.baseline);
  });
});
