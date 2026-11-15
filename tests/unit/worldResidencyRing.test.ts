import { describe, expect, it } from "vitest";
import {
  footprintDistanceMetres, neighbouringTileIds, planWorldResidency, residencyDrawLimitRules, validateWorldResidencySettings, WorldResidencyError,
  worldResidencySettingsForChunkEdge, type WorldResidencyChunk, type WorldResidencySettings,
} from "../../src/scene/world/worldResidencyRing";

const settings: WorldResidencySettings = { visualRadiusMetres: 10, collisionRadiusMetres: 20, retainRadiusMetres: 30, lodCullDistanceMetres: 10 };
const origin = { x: 0, z: 0 };

function chunkStartingAt(cellId: string, minimumX: number): WorldResidencyChunk {
  return { cellId, footprint: { minimumX, minimumZ: -1, maximumX: minimumX + 5, maximumZ: 1 } };
}

describe("world residency footprint distance", () => {
  it("is zero inside or on the edge of the closed rectangle and the x/z distance outside it", () => {
    const footprint = { minimumX: 0, minimumZ: 0, maximumX: 10, maximumZ: 10 };
    expect(footprintDistanceMetres({ x: 5, z: 5 }, footprint)).toBe(0);
    expect(footprintDistanceMetres({ x: 10, z: 0 }, footprint)).toBe(0);
    expect(footprintDistanceMetres({ x: 13, z: 5 }, footprint)).toBe(3);
    expect(footprintDistanceMetres({ x: -3, z: 14 }, footprint)).toBe(5);
  });
});

describe("world residency plan", () => {
  it("lists a chunk at exactly the visual radius as visible and one 0.001 m further as required but not visible", () => {
    const atRadius = planWorldResidency([chunkStartingAt("a/chunk-0-0", 10)], origin, settings);
    expect(atRadius.visibleCellIds).toEqual(["a/chunk-0-0"]);
    const beyond = planWorldResidency([chunkStartingAt("a/chunk-0-0", 10.001)], origin, settings);
    expect(beyond.visibleCellIds).toEqual([]);
    expect(beyond.requiredCellIds).toEqual(["a/chunk-0-0"]);
  });

  it("puts each ring boundary inside its ring and one step beyond it outside", () => {
    const chunks = [chunkStartingAt("a/chunk-1-0", 20), chunkStartingAt("a/chunk-2-0", 20.001), chunkStartingAt("a/chunk-3-0", 30), chunkStartingAt("a/chunk-4-0", 30.001)];
    const plan = planWorldResidency(chunks, origin, settings);
    expect(plan.requiredCellIds).toEqual(["a/chunk-1-0"]);
    expect(plan.retainedCellIds).toEqual(["a/chunk-1-0", "a/chunk-2-0", "a/chunk-3-0"]);
  });

  it("nests visible in required in retained, sorts the lists by cell id and the load order by distance then cell id", () => {
    const chunks = [chunkStartingAt("b/chunk-0-0", 15), chunkStartingAt("a/chunk-0-0", 15), chunkStartingAt("c/chunk-0-0", -2), chunkStartingAt("d/chunk-0-0", 25)];
    const plan = planWorldResidency(chunks, origin, settings);
    expect(plan.visibleCellIds).toEqual(["c/chunk-0-0"]);
    expect(plan.requiredCellIds).toEqual(["a/chunk-0-0", "b/chunk-0-0", "c/chunk-0-0"]);
    expect(plan.retainedCellIds).toEqual(["a/chunk-0-0", "b/chunk-0-0", "c/chunk-0-0", "d/chunk-0-0"]);
    expect(plan.loadOrder).toEqual(["c/chunk-0-0", "a/chunk-0-0", "b/chunk-0-0"]);
    for (const cellId of plan.visibleCellIds) expect(plan.requiredCellIds).toContain(cellId);
    for (const cellId of plan.requiredCellIds) expect(plan.retainedCellIds).toContain(cellId);
  });

  it("returns an equal plan for equal input and four empty lists for no chunks", () => {
    const chunks = [chunkStartingAt("b/chunk-0-0", 3), chunkStartingAt("a/chunk-0-0", 12)];
    expect(planWorldResidency(chunks, origin, settings)).toEqual(planWorldResidency([...chunks].reverse(), origin, settings));
    expect(planWorldResidency([], origin, settings)).toEqual({ visibleCellIds: [], requiredCellIds: [], retainedCellIds: [], loadOrder: [] });
  });
});

describe("world residency settings", () => {
  it("refuses a collision ring that is not wider than the visual ring, a retain ring inside the collision ring and zero or non-finite values", () => {
    const refused: WorldResidencySettings[] = [
      { ...settings, collisionRadiusMetres: settings.visualRadiusMetres },
      { ...settings, retainRadiusMetres: settings.collisionRadiusMetres - 1 },
      { ...settings, visualRadiusMetres: 0 },
      { ...settings, lodCullDistanceMetres: 0 },
      { ...settings, retainRadiusMetres: Number.POSITIVE_INFINITY },
      { ...settings, visualRadiusMetres: Number.NaN },
    ];
    for (const candidate of refused) expect(() => validateWorldResidencySettings(candidate)).toThrow(WorldResidencyError);
    expect(() => validateWorldResidencySettings({ ...settings, retainRadiusMetres: settings.collisionRadiusMetres })).not.toThrow();
  });

  it("derives one, two and three chunk edges for the rings and one chunk edge for the culling distance", () => {
    const derived = worldResidencySettingsForChunkEdge(81.92);
    expect(derived.visualRadiusMetres).toBeCloseTo(81.92, 9);
    expect(derived.collisionRadiusMetres).toBeCloseTo(163.84, 9);
    expect(derived.retainRadiusMetres).toBeCloseTo(245.76, 9);
    expect(derived.lodCullDistanceMetres).toBeCloseTo(81.92, 9);
    expect(() => worldResidencySettingsForChunkEdge(0)).toThrow(WorldResidencyError);
  });

  it("reports the visual ring and the null level-of-detail cull as presentation draw limit rows of decision row 735 in metres", () => {
    const rows = residencyDrawLimitRules(worldResidencySettingsForChunkEdge(81.92));
    expect(rows.map(({ id, status, provenance, unit }) => ({ id, status, provenance, unit }))).toEqual([
      { id: "residency-visual-ring-radius", status: "presentation", provenance: "OVERNIGHT-DECISIONS row 735", unit: "metres" },
      { id: "residency-null-lod-cull-distance", status: "presentation", provenance: "OVERNIGHT-DECISIONS row 735", unit: "metres" },
    ]);
    for (const row of rows) expect(row.runtimeDefault).toBeCloseTo(81.92, 9);
    expect(residencyDrawLimitRules(settings).map(row => row.runtimeDefault)).toEqual([settings.visualRadiusMetres, settings.lodCullDistanceMetres]);
  });
});

describe("neighbouring tile ids", () => {
  it("lists the eight sorted grid neighbours inside 00 to 99 and refuses a malformed id", () => {
    expect(neighbouringTileIds("20_21")).toEqual(["19_20", "19_21", "19_22", "20_20", "20_22", "21_20", "21_21", "21_22"]);
    expect(neighbouringTileIds("00_10")).toEqual(["00_09", "00_11", "01_09", "01_10", "01_11"]);
    expect(neighbouringTileIds("99_99")).toEqual(["98_98", "98_99", "99_98"]);
    for (const malformed of ["2021", "20_2", "../20_21", "20_21 "]) expect(() => neighbouringTileIds(malformed)).toThrow(WorldResidencyError);
  });
});
