import { describe, expect, it } from "vitest";
import {
  FOOTSTEP_SURFACES, FOOTSTEP_WATER_SURFACES, createFootstepRandom, drawSlot, pickVariation, surfaceClips, surfaceVariationCount,
  type FootstepSurfaceId, type StepSoundClip, type StepSoundLibrary, type StepSoundPlacement, type StepSoundSlotProperty, type StepSoundSurface,
} from "../../src/audio/footstepSurfaces";
import {
  createFootstepAutoSurface, pickStepSoundSlot, resolveFootstepSurface, FOOTSTEP_GROUP_ARRAYS, type FootstepGroundContext,
} from "../../src/audio/footstepSurfaceAuto";
import { footstepAttenuation, footstepGain } from "../../src/audio/nativeFootstepPreview";
import type { FootstepDecoGrassReading } from "../../src/assets/native/loadNativeStepDecoGrass";

const clip = (object: string): StepSoundClip => ({ key: `k:${object}`, object, dependencyId: `id:${object}`, sha256: "0".repeat(64), durationSeconds: .5 });
function woodPlacement(id = "interlude:20_20.StaticMeshActor930",
  properties: readonly StepSoundSlotProperty[] = ["StepSound_1", "StepSound_2", "StepSound_3"]): StepSoundPlacement {
  const names: Record<string, string> = { StepSound_1: "wood_walk_01", StepSound_2: "wood_walk_02", StepSound_3: "Wood_Walk_03" };
  const slots = properties.map(property => ({ property, reference: `StepSound.Wood.${names[property]}`, clip: clip(`stepsound.Wood.${names[property]}`) }));
  return { placementId: id, sourceMesh: "L2fortress_01_S.Fort01_tower_stair", slots, clips: slots.map(slot => slot.clip),
    references: slots.map(slot => slot.reference), surface: "Wood" };
}
function fixtureLibrary(): StepSoundLibrary {
  const surfaces = new Map<FootstepSurfaceId, StepSoundSurface>();
  for (const id of FOOTSTEP_SURFACES) {
    const water = FOOTSTEP_WATER_SURFACES.has(id), count = id === "Stone" ? 2 : 3;
    const walk = Array.from({ length: count }, (_, i) => clip(water ? `stepsound.water.${id.toLowerCase()}_0${i + 1}` : `stepsound.${id}.${id.toLowerCase()}_walk_0${i + 1}`));
    const run = water ? walk : Array.from({ length: count }, (_, i) => clip(`stepsound.${id}.${id.toLowerCase()}_run_0${i + 1}`));
    surfaces.set(id, { id, label: id, group: water ? "water" : id, gaitSplit: !water, walk, run });
  }
  const wood = woodPlacement();
  return { manifestSha256: "a".repeat(64), packageSha256: "b".repeat(64), soundCount: 93, surfaces,
    events: { Water_In: clip("stepsound.water.Water_In"), Water_Out: clip("stepsound.water.Water_Out") },
    boots: [1, 2, 3].map(i => clip(`stepsound.noise_boots.noise_0${i}`)),
    placements: new Map([[wood.placementId, wood]]), sectionManifestSha256: "c".repeat(64) };
}
const reading = (expected: number): FootstepDecoGrassReading => ({ status: "sampled", expected, threshold: 2, grass: expected >= 2, sector: 7, quad: [80, 230] });
const context = (patch: Partial<FootstepGroundContext>): FootstepGroundContext => ({ kind: "terrain", meshName: "20_20.TerrainInfo0", sourceId: "20_20.TerrainInfo0",
  material: null, nativeXY: [10536, 95034], decoGrass: null, footVolume: null, detail: null, ...patch });
const sequence = (...values: number[]) => { let index = 0; return () => values[index++ % values.length]!; };

describe("original stepsound surface vocabulary", () => {
  it("lists all 16 surface choices with the original one-l Water_Shalow spelling and separate water/boots events", () => {
    expect(FOOTSTEP_SURFACES).toEqual(["Default", "Grass", "Stone", "Stone_Hard", "Stone_Gritty", "Carpet", "Dirt", "Gravel",
      "Ice", "Marsh", "Metal", "Sand", "Snow", "Wood", "Water_Shalow", "Water_Deep"]);
    expect(FOOTSTEP_SURFACES).not.toContain("Water_In"); expect(FOOTSTEP_SURFACES).not.toContain("noise_boots");
  });

  it("derives variation counts from actual clips (ordinary Stone has two) and maps gait without a water split", () => {
    const library = fixtureLibrary();
    expect(surfaceVariationCount(library, "Stone")).toBe(2);
    expect(FOOTSTEP_SURFACES.filter(id => id !== "Stone").every(id => surfaceVariationCount(library, id) === 3)).toBe(true);
    expect(surfaceClips(library, "Stone", "run")[0]!.object).toBe("stepsound.Stone.stone_run_01");
    expect(surfaceClips(library, "Water_Deep", "run")).toBe(surfaceClips(library, "Water_Deep", "walk"));
    expect(surfaceVariationCount(null, "Grass")).toBe(0); expect(surfaceClips(null, "Grass", "run")).toEqual([]);
  });

  it("clamps explicit variations and draws Random as a uniform slot that may repeat (native appRand() % n shape)", () => {
    const clips = fixtureLibrary().surfaces.get("Stone")!.walk;
    expect(pickVariation(clips, 1, () => 0)!.index).toBe(1);
    expect(pickVariation(clips, 5, () => 0)!.index).toBe(1);
    expect([0, .49, .5, .99].map(value => pickVariation(clips, "random", () => value)!.index)).toEqual([0, 0, 1, 1]);
    expect(pickVariation([], "random", () => 0)).toBeNull();
    expect(drawSlot(() => Number.NaN, 3)).toBe(0); expect(drawSlot(() => 1, 3)).toBe(2);
  });

  it("uses a seeded, reproducible generator in [0, 1)", () => {
    const first = createFootstepRandom(), second = createFootstepRandom(), other = createFootstepRandom(7);
    const values = Array.from({ length: 1000 }, () => first());
    expect(Array.from({ length: 1000 }, () => second())).toEqual(values);
    expect(values.every(value => value >= 0 && value < 1)).toBe(true);
    expect(other()).not.toBe(values[0]);
    const slots = [0, 0, 0]; for (const value of values) slots[Math.floor(value * 3)]!++;
    expect(Math.min(...slots)).toBeGreaterThan(280);
  });
});

describe("native footstep decision order (REPORT.md Q1)", () => {
  const library = fixtureLibrary();
  it("plays the support StaticMeshActor's own StepSound declarations as native data", () => {
    const declared = resolveFootstepSurface(context({ kind: "placement", sourceId: "interlude:20_20.StaticMeshActor930" }), library);
    expect(declared).toMatchObject({ rule: "support-step-sound", group: null, surface: "Wood", status: "native", silent: false });
    expect(declared.reason).toContain("never StepSound_2");
  });

  it("returns StepSound_1 with weight 2/3 and StepSound_3 with 1/3, never StepSound_2, for any gait", () => {
    const wood = woodPlacement();
    // First draw rand%3 == 2 → StepSound_1; else an odd second draw with StepSound_2 set → StepSound_1; else StepSound_3.
    expect(pickStepSoundSlot(wood, sequence(.9))!.property).toBe("StepSound_1");
    expect(pickStepSoundSlot(wood, sequence(.1, .9))!.property).toBe("StepSound_1");
    expect(pickStepSoundSlot(wood, sequence(.1, .1))!.property).toBe("StepSound_3");
    const random = createFootstepRandom(), counts: Record<string, number> = {};
    for (let i = 0; i < 6000; i++) { const property = pickStepSoundSlot(wood, random)!.property; counts[property] = (counts[property] ?? 0) + 1; }
    expect(counts.StepSound_2).toBeUndefined();
    expect(counts.StepSound_1! / 6000).toBeCloseTo(2 / 3, 1); expect(counts.StepSound_3! / 6000).toBeCloseTo(1 / 3, 1);
    // Without StepSound_2 the odd branch falls to StepSound_3 (1/3 vs 2/3); a missing chosen slot returns no Sound.
    expect(pickStepSoundSlot(woodPlacement("p", ["StepSound_1", "StepSound_3"]), sequence(.1, .9))!.property).toBe("StepSound_3");
    expect(pickStepSoundSlot(woodPlacement("p", ["StepSound_1"]), sequence(.1, .1))).toBeNull();
  });

  it("maps every other non-terrain support (meshes, BSP) to ACTOR = the Stone_Hard walk array for both gaits", () => {
    for (const kind of ["placement", "mesh", "bsp"] as const) {
      const actor = resolveFootstepSurface(context({ kind, sourceId: kind === "placement" ? "interlude:20_20.StaticMeshActor1914" : null }), library);
      expect(actor).toMatchObject({ rule: "actor", group: "ACTOR", surface: "Stone_Hard", declared: null });
    }
    expect(resolveFootstepSurface(context({ kind: "bsp", sourceId: "interlude:20_20.Model798.Brush397" }), library).reason).toContain("Conditional");
    expect(FOOTSTEP_GROUP_ARRAYS.ACTOR).toEqual({ walk: "DefaultActorWalkSound", run: "DefaultActorWalkSound" });
    expect(FOOTSTEP_GROUP_ARRAYS.LAND).toEqual({ walk: "DefaultWalkSound", run: "DefaultRunSound" });
  });

  it("picks GRASS on terrain only for the local player when the expected deco count reaches 2, else LAND", () => {
    expect(resolveFootstepSurface(context({ decoGrass: reading(3.2) }), library)).toMatchObject({ rule: "grass", group: "GRASS", surface: "Grass", status: "presentation" });
    expect(resolveFootstepSurface(context({ decoGrass: reading(3.2) }), library).summary).toBe("Grass · deco ≈ 3.2 ≥ 2");
    expect(resolveFootstepSurface(context({ decoGrass: reading(1.9) }), library)).toMatchObject({ rule: "land", group: "LAND", surface: "Default" });
    expect(resolveFootstepSurface(context({ decoGrass: reading(9) }), library, { localPlayer: false })).toMatchObject({ group: "LAND", status: "native" });
    expect(resolveFootstepSurface(context({ kind: "terrain-patch", decoGrass: reading(9) }), library).group).toBe("GRASS");
    const unstaged = resolveFootstepSurface(context({}), library);
    expect(unstaged).toMatchObject({ group: "LAND", status: "presentation" }); expect(unstaged.reason).toContain("browser does not render decorations");
    expect(resolveFootstepSurface(context({ decoGrass: reading(3.2) }), library).reason).toContain("approximation of native deco instance count");
  });

  it("turns the deco gate off with RenderDeco grass footsteps (default on): terrain is then always LAND", () => {
    const auto = createFootstepAutoSurface(library);
    expect(auto.renderDecoGrass()).toBe(true);
    expect(auto.resolve(context({ decoGrass: reading(5) }), { localPlayer: true }).group).toBe("GRASS");
    auto.setRenderDecoGrass(false);
    expect(auto.resolve(context({ decoGrass: reading(5) }), { localPlayer: true })).toMatchObject({ group: "LAND", status: "native" });
    expect(() => auto.setRenderDecoGrass("yes" as never)).toThrow("RenderDeco");
  });

  it("keeps water and step-volume hooks ahead of ACTOR/terrain, with native silence when the pawn is in water too", () => {
    const water = { water: true, pawnInWater: false, stepSound: null };
    expect(resolveFootstepSurface(context({ kind: "bsp", footVolume: water }), library)).toMatchObject({ rule: "water-volume", group: "WATER" });
    expect(resolveFootstepSurface(context({ footVolume: { ...water, pawnInWater: true } }), library)).toMatchObject({ silent: true, surface: null });
    const step = clip("stepsound.Gravel.gravel_walk_01");
    expect(resolveFootstepSurface(context({ footVolume: { water: false, pawnInWater: false, stepSound: step } }), library))
      .toMatchObject({ rule: "step-volume", stepSound: step });
    // The support's own StepSound wins before any volume.
    expect(resolveFootstepSurface(context({ kind: "placement", sourceId: "interlude:20_20.StaticMeshActor930", footVolume: water }), library).rule)
      .toBe("support-step-sound");
  });

  it("plays LAND as a labelled presentation choice without a support contact (native Base = null is silent)", () => {
    for (const value of [null, context({ kind: "none" })]) {
      const missing = resolveFootstepSurface(value, library);
      expect(missing).toMatchObject({ rule: "no-support", group: "LAND", status: "presentation" });
      expect(missing.reason).toContain("presentation choice");
    }
  });
});

describe("footstep playback gain (presentation choice: ambient curve)", () => {
  it("uses Volume 250/255 at the pawn and the linear × inverse-clamped curve with radius 30", () => {
    expect(footstepGain(0)).toBeCloseTo(250 / 255, 12);
    expect(footstepAttenuation(30)).toBeCloseTo(1 - 30 / 1500, 12);
    expect(footstepAttenuation(150)).toBeCloseTo(.9 * 30 / 90, 12);
    expect(footstepAttenuation(1500)).toBe(0); expect(footstepGain(5000)).toBe(0);
    expect(footstepAttenuation(Number.NaN)).toBe(1);
  });
});
