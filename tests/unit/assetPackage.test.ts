import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ResetMatrixFunctions } from "@babylonjs/core/Materials/floatingOriginMatrixOverrides";
import { readAssetPackage, validatePackageModel } from "../../src/assets/package/readAssetPackage";
import { restoreWorldPrecision } from "../../src/assets/package/restoreWorldPrecision";
import { assetFixture, fixtureGlb, storedPackage } from "../fixtures/assetPackageFixture";

describe("local asset package integrity", () => {
  it.each(["model", "audio", "texture"] as const)("reads a verified %s package without changing its content", async kind => {
    const fixture = await assetFixture(kind), result = await readAssetPackage(fixture.bytes);
    const model = fixture.manifest.model;
    expect(result.manifest).toEqual(model ? { ...fixture.manifest,
      coordinates: { unit: model.unit, sourceUnitsPerMetre: model.sourceUnitsPerMetre, sourceToGltf: model.sourceToGltf } } : fixture.manifest);
    expect(result.files.get(fixture.entries[1]!.name)).toEqual(fixture.entries[1]!.bytes);
  });
  it("rejects corrupt ZIP payloads before loading", async () => {
    const { bytes } = await assetFixture(); bytes[45] = bytes[45]! ^ 1;
    await expect(readAssetPackage(bytes)).rejects.toThrow("ZIP integrity");
  });
  it("rejects changed payloads even if their ZIP CRC was recomputed", async () => {
    const fixture = await assetFixture(); fixture.entries[1]!.bytes[25] = fixture.entries[1]!.bytes[25]! ^ 1;
    await expect(readAssetPackage(storedPackage(fixture.entries))).rejects.toThrow("SHA-256");
  });
  it.each(["../model.glb", "/model.glb", "folder//model.glb", "C:/model.glb", "folder/./model.glb"])("rejects unsafe archive path %s", async name => {
    const fixture = await assetFixture(); fixture.entries[1]!.name = name;
    await expect(readAssetPackage(storedPackage(fixture.entries))).rejects.toThrow("unsafe");
  });
  it("rejects duplicate case aliases and unlisted files", async () => {
    const fixture = await assetFixture();
    await expect(readAssetPackage(storedPackage([...fixture.entries, { name: "MODEL.GLB", bytes: new Uint8Array() }]))).rejects.toThrow("duplicate");
    await expect(readAssetPackage(storedPackage([...fixture.entries, { name: "extra.txt", bytes: new Uint8Array() }]))).rejects.toThrow("absent from");
  });
  it("rejects compressed/encrypted ZIP formats and changed local headers", async () => {
    const fixture = await assetFixture();
    const mutate = (field: number, value: number) => { const bytes = fixture.bytes.slice(), view = new DataView(bytes.buffer), directory = view.getUint32(bytes.length - 6, true); view.setUint16(directory + field, value, true); return bytes; };
    await expect(readAssetPackage(mutate(10, 8))).rejects.toThrow("ZIP_STORED");
    await expect(readAssetPackage(mutate(8, 1))).rejects.toThrow("unencrypted");
    const changed = fixture.bytes.slice(); changed[30] = 98;
    await expect(readAssetPackage(changed)).rejects.toThrow("does not match");
  });
  it("rejects unsupported editions and missing model unit evidence", async () => {
    const fixture = await assetFixture();
    const wrongEdition = await assetFixture("model", { source: { ...fixture.manifest.source, edition: "classic" as "interlude" } });
    await expect(readAssetPackage(wrongEdition.bytes)).rejects.toThrow("Interlude");
    const wrongUnit = await assetFixture("model", { model: { ...fixture.manifest.model!, unit: "centimetre" as "metre" } });
    await expect(readAssetPackage(wrongUnit.bytes)).rejects.toThrow("metre unit");
  });
  it("rejects external GLB resources while retaining embedded native animation data", () => {
    expect(() => validatePackageModel(fixtureGlb())).not.toThrow();
    expect(() => validatePackageModel(fixtureGlb({ images: [{ uri: "https://example.com/texture.png" }] }))).toThrow("external content");
    expect(() => validatePackageModel(new Uint8Array(50))).toThrow("glTF 2");
  });
});

describe("inspector disposal precision", () => {
  it("restores floating-origin GPU matrix hooks for a surviving world after another engine closes", () => {
    ResetMatrixFunctions();
    const baseline = Effect.prototype.setMatrix;
    const worldEngine = new NullEngine(), world = new Scene(worldEngine, { useFloatingOrigin: true });
    const inspectorEngine = new NullEngine(), inspector = new Scene(inspectorEngine, { useFloatingOrigin: true });
    try {
      expect(world.floatingOriginMode).toBe(true);
      expect(Effect.prototype.setMatrix).not.toBe(baseline);
      inspector.dispose(); inspectorEngine.dispose();
      expect(Effect.prototype.setMatrix).toBe(baseline); // Babylon 9.27.1 global reset regression.
      restoreWorldPrecision();
      expect(Effect.prototype.setMatrix).not.toBe(baseline);
      expect(world.isDisposed).toBe(false);
      restoreWorldPrecision(); // Safe after repeated replace/close cleanup.
      expect(Effect.prototype.setMatrix).not.toBe(baseline);
    } finally { inspector.dispose(); inspectorEngine.dispose(); world.dispose(); worldEngine.dispose(); }
  });
});
