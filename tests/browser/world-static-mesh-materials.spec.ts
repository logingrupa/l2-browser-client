import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport } from "./browserViewports";
import { environmentTimeTablesRequirement, environmentTimeTablesStaged } from "./stagedEnvironmentTimeTables";

interface TileCatalogRecord { readonly id: string; readonly manifest: string }
interface TileManifest { readonly resources: readonly { readonly kind: string; readonly manifest: string }[] }
interface StaticMeshSlot {
  readonly sourceObject: string | null;
  readonly status: string;
  readonly programMaterialId: string | null;
  readonly reasons: readonly string[];
  readonly meshes: number;
}
interface StaticMeshSlotsInspection {
  readonly gap: string | null;
  readonly lighting: string;
  readonly lightingReasons: readonly string[];
  readonly meshCount: number;
  readonly statusCounts: Record<string, number>;
  readonly slots: readonly StaticMeshSlot[];
}
interface LightingInspection { readonly gap: string | null; readonly staticMeshSlots?: StaticMeshSlotsInspection }

const laneName = "world";
const tileId = "20_21";
const laneFolder = resolve("artifacts/lane-store", laneName);
const laneStoreFile = (manifest: string) => resolve(laneFolder, "l2", manifest.replace(/^\/l2\//, ""));
const readJson = <Value>(path: string): Value => JSON.parse(readFileSync(path, "utf8")) as Value;
const laneCatalogPath = resolve(laneFolder, "l2/catalog.json");
const laneCatalog: { tiles?: TileCatalogRecord[] } | null = existsSync(laneCatalogPath) ? readJson(laneCatalogPath) : null;
const tileRecord = laneCatalog?.tiles?.find(record => record.id === tileId) ?? null;
const tileManifest = tileRecord ? readJson<TileManifest>(laneStoreFile(tileRecord.manifest)) : null;
const staticMeshMaterialsResource = tileManifest?.resources.find(resource => resource.kind === "static-mesh-materials") ?? null;
const evidenceFolder = resolve("artifacts/ui-evidence");
const tileLoadTimeout = 300_000;

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(!environmentTimeTablesStaged(laneName), environmentTimeTablesRequirement);
test.skip(staticMeshMaterialsResource === null,
  "the world lane store has no tile 20_21 with a static-mesh-materials resource; run convert_tile.py --map 20_21 --step static-mesh-materials, then --step manifest");

const staticMeshSlots = (page: Page) => page.evaluate(() => {
  const lighting = window.__nativeSlice?.snapshot().world?.lighting as LightingInspection | undefined;
  return lighting === undefined ? null : lighting;
});

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test("draws tile 20_21 static mesh slots through the UE2 material library and lists every other slot with its reasons at 1440 x 900", async ({ page }) => {
    test.setTimeout(tileLoadTimeout + 60_000);
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`/?map=${tileId}`);
    await expect.poll(async () => (await staticMeshSlots(page))?.staticMeshSlots?.meshCount ?? 0, { timeout: tileLoadTimeout, intervals: [1_000] })
      .toBeGreaterThan(0);
    const lighting = (await staticMeshSlots(page))!;
    expect(lighting.gap).toBeNull();
    const slots = lighting.staticMeshSlots!;
    expect(slots.gap).toBeNull();
    expect(slots.lighting).toBe("unlit");
    expect(slots.lightingReasons).toEqual(["library-vertex-lighting-unported"]);
    expect(Object.values(slots.statusCounts).reduce((sum, count) => sum + count, 0)).toBe(slots.meshCount);
    expect(slots.slots.reduce((sum, slot) => sum + slot.meshes, 0)).toBe(slots.meshCount);
    expect(slots.statusCounts["library-compiled"], "a 20_21 static mesh slot draws through the UE2 material library").toBeGreaterThan(0);
    for (const slot of slots.slots) {
      if (slot.status === "library-compiled") expect(slot.programMaterialId).toMatch(/^[a-f0-9]{64}$/);
      else expect(slot.reasons.length, `${slot.sourceObject} names why it keeps its texture material`).toBeGreaterThan(0);
    }
    mkdirSync(evidenceFolder, { recursive: true });
    await page.screenshot({ path: resolve(evidenceFolder, "world-static-mesh-materials-20_21-desktop.png") });
    writeFileSync(resolve(evidenceFolder, "world-static-mesh-materials-20_21-inspection.json"), JSON.stringify(slots, null, 2));
    expect(pageErrors).toEqual([]);
  });
});
