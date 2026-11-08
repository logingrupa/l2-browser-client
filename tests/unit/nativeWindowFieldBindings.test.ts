import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readWindowCatalogRecord } from "../../src/assets/native/nativeCatalogRecords";
import { readNativeWindowFieldBindings } from "../../src/ui/nativeWindows/nativeWindowFieldBindings";
import { parseNativeWindowManifest, type NativeWindowNode } from "../../src/ui/nativeWindows/nativeWindowLayoutTree";

const laneStoreRoot = "artifacts/lane-store/data-ui";
const laneCatalogPath = `${laneStoreRoot}/l2/catalog.json`;
const committedRecipeText = readFileSync("recipes/data/window-field-bindings.json", "utf8");

function nodeNames(node: NativeWindowNode): string[] {
  return [node.name, ...node.children.flatMap(nodeNames)];
}

function recipeWithFirstBinding(changes: Record<string, unknown>): string {
  const recipe = JSON.parse(committedRecipeText) as { bindings: Record<string, unknown>[] };
  return JSON.stringify({ ...recipe, bindings: [{ ...recipe.bindings[0], ...changes }] });
}

describe("readNativeWindowFieldBindings", () => {
  it("reads the committed recipe: one bound gauge and adapter-field-absent rows, each citing a pinned source", () => {
    const bindings = readNativeWindowFieldBindings();
    expect(bindings.filter(binding => binding.worldField === "health")).toHaveLength(1);
    expect(bindings.map(binding => binding.gapReason).filter(reason => reason !== null)).toEqual(["adapter-field-absent:cp", "adapter-field-absent:mp"]);
    bindings.forEach(binding => {
      expect(binding.status).toBe("unverified");
      expect(binding.source.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(binding.source.excerpt.length).toBeGreaterThan(0);
    });
  });

  it("refuses a row with both a world field and a gap reason, an unknown field and a repeated control", () => {
    expect(() => readNativeWindowFieldBindings(recipeWithFirstBinding({ gapReason: "adapter-field-absent:cp" }))).toThrow(/either a world field/);
    expect(() => readNativeWindowFieldBindings(recipeWithFirstBinding({ worldField: "mana" }))).toThrow(/worldField/);
    expect(() => readNativeWindowFieldBindings(recipeWithFirstBinding({ extra: 1 }))).toThrow(/exactly/);
    const recipe = JSON.parse(committedRecipeText) as { bindings: unknown[] };
    expect(() => readNativeWindowFieldBindings(JSON.stringify({ ...recipe, bindings: [recipe.bindings[0], recipe.bindings[0]] }))).toThrow(/twice/);
  });

  it.skipIf(!existsSync(laneCatalogPath))("binds each row to exactly one decoded control and a fill texture of its window", () => {
    const catalog = JSON.parse(readFileSync(laneCatalogPath, "utf8")) as { windows: unknown[] };
    for (const binding of readNativeWindowFieldBindings()) {
      const record = catalog.windows.map(readWindowCatalogRecord).find(windowRecord => windowRecord.window === binding.windowId);
      expect(record, binding.windowId).toBeDefined();
      const manifest = parseNativeWindowManifest(JSON.parse(readFileSync(`${laneStoreRoot}${record!.manifest}`, "utf8")));
      expect(nodeNames(manifest.root).filter(name => name === binding.controlName)).toHaveLength(1);
      if (binding.fillTextureRef !== null) expect(manifest.textureRefs).toContain(binding.fillTextureRef);
    }
  });
});
