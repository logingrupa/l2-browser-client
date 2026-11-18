import type { NativePlane } from "../environment/model/nativePlane";
import type { EnvironmentResult } from "../environment/model/nativeEnvironmentColours";
import type { RgbBytes } from "../environment/model/sampleNativeTimeTables";
import type { TileLightingRuntimeInspection } from "../scene/world/lighting/attachTileLighting";
import type { SunAffectNodeSet } from "../scene/world/lighting/tileLightingVisibility";
import { terrainProbeSample } from "../scene/world/lighting/bindTerrainVertexLighting";
import type { HourlyAmbientInspection } from "../scene/world/lighting/hourlyLightingTerms";
import type { VariableInfo } from "../ui/devSheet/types";

export type TileLightingReading = TileLightingRuntimeInspection | { readonly gap: string };

interface HourlyReading {
  readonly text: string;
  readonly native: boolean;
}

const hourlyLightingReport = "DB-7 hourly-lighting-composition.json f0a6eb0f, claim audit verified-hourly-lighting.md";
export const staticMeshVisibilityProbeActor = "20_21.StaticMeshActor1905";

const sunAffectNodeSetText: Readonly<Record<SunAffectNodeSet, string>> = {
  "visibility-walk": "submitted nodes from the visibility walk",
  "every-node-culling-off": "every node counts as submitted: culling off",
  "every-node-no-frame": "every node counts as submitted: no visibility frame",
};

const nativeReading = (text: string): HourlyReading => ({ text, native: true });
const unverifiedReading = (text: string): HourlyReading => ({ text, native: false });
const planeText = (plane: NativePlane) => plane.map(component => String(component)).join(", ");

function environmentText<Value>(result: EnvironmentResult<Value>, text: (value: Value) => string): HourlyReading {
  return result.status === "resolved" ? nativeReading(text(result.value)) : unverifiedReading(result.reason);
}

function ambientText(ambient: HourlyAmbientInspection): HourlyReading {
  return ambient.status === "resolved" ? nativeReading(`${ambient.value.join(", ")} (${ambient.condition})`) : unverifiedReading(`${ambient.reason} (${ambient.condition})`);
}

function terrainReadings(lighting: TileLightingRuntimeInspection): Record<string, () => HourlyReading> {
  const terrain = () => lighting.hourly.terrain;
  const latched = (text: (value: TileLightingRuntimeInspection["hourly"]["terrain"]) => string | null) => () => {
    const current = terrain();
    if (current.gap !== null) return unverifiedReading(current.gap);
    const value = text(current);
    return value === null ? unverifiedReading(current.heldReason ?? "terrain-vertex-colour-unbuilt") : nativeReading(value);
  };
  return {
    "lighting.terrain.rebuild": latched(current => current.lastRebuildHour === null ? null
      : `${current.rebuildCount} rebuilds, last at hour ${current.lastRebuildHour}${current.heldReason === null ? "" : `, held (${current.heldReason})`}`),
    "lighting.terrain.mapBlend": latched(current => current.mapBlend === null ? null
      : `TIntMap ${current.mapBlend.index} > ${current.mapBlend.nextIndex} at weight ${current.mapBlend.weight} (keys ${current.mapTimes.join(", ")})`),
    "lighting.terrain.ambientHalved": latched(current => current.halvedAmbient?.join(", ") ?? null),
    "lighting.terrain.light": latched(current => current.light === null ? null : planeText(current.light)),
    "lighting.terrain.probe": latched(current => current.probe === null ? null
      : `(${current.probe.column}, ${current.probe.row}) intensity ${current.probe.intensity}, BGRA ${current.probe.bgra.join(", ")}`),
    "lighting.terrain.vertices": latched(current => `${current.colouredVertexCount} vertices in ${current.colouredMeshCount} meshes; gaps ${JSON.stringify(current.meshGaps)}`),
    "lighting.terrain.staticBase": () => {
      const { staticBase } = terrain();
      return staticBase.status === "resolved" ? nativeReading("black, alpha 255 (no serialized light covers a vertex)") : unverifiedReading(staticBase.reasons.join(", "));
    },
    "lighting.terrain.drawn": () => unverifiedReading(`not drawn (${terrain().drawn.reason})`),
    "lighting.terrain.refreshThreshold": () => unverifiedReading(terrain().refreshThreshold.reason),
  };
}

function bspReadings(lighting: TileLightingRuntimeInspection): Record<string, () => HourlyReading> {
  const gapCount = (reason: string) => lighting.sections.filter(section => section.reasons.includes(reason)).length;
  const operations = () => {
    const lightmapped = lighting.sections.filter(section => section.colourOperation !== null);
    const modulate = lightmapped.filter(section => section.colourOperation?.operation === "modulate").length;
    return `${modulate} MODULATE (ColorModifier), ${lightmapped.length - modulate} global op at the MODULATE2X image default (d3d-device-live-state)`;
  };
  const nodeSet = sunAffectNodeSetText[lighting.sunAffectNodeSet];
  return {
    "lighting.bsp.slots": () => unverifiedReading(`${lighting.textureSlots.map(slot => `${slot.texture}: ${slot.sunAffectedSlot ?? "-"} of ${slot.childCount}`).join(" | ")}`
      + ` (${nodeSet})`),
    "lighting.bsp.sunAffect": () => unverifiedReading(`${lighting.sunAffectedSectionCount} of ${lighting.lightmappedSectionCount} lightmapped sections sun-affected this frame; `
      + `others use slot 0 (${nodeSet})`),
    "lighting.bsp.gaps": () => {
      const gaps = lighting.sections.filter(section => section.lighting === "gap").map(section => section.reasons[0] ?? "lighting-gap");
      const counts = Object.entries(gaps.reduce<Record<string, number>>((sum, reason) => ({ ...sum, [reason]: (sum[reason] ?? 0) + 1 }), {}));
      return counts.length === 0 ? nativeReading("none") : unverifiedReading(counts.map(([reason, count]) => `${reason} ${count}`).join(", "));
    },
    "lighting.bsp.compressedGate": () => gapCount("bsp-live-cache-state") === 0 ? nativeReading("every bound page has revision == compressed revision")
      : unverifiedReading(`${gapCount("bsp-live-cache-state")} sections bsp-live-cache-state`),
    "lighting.bsp.colourOperation": () => unverifiedReading(operations()),
    "lighting.bsp.upload": () => unverifiedReading(`${lighting.lightmapUpload.format} (${lighting.lightmapUpload.reason})`),
    "lighting.bsp.rebuildAmbient": () => {
      const reading = environmentText(lighting.hourly.terms.bsp.rebuildAmbient, (rgb: RgbBytes) => rgb.join(", "));
      return { ...reading, text: `${reading.text} (rebuild only, not bound)` };
    },
  };
}

function meshAndDeviceReadings(lighting: TileLightingRuntimeInspection): Record<string, () => HourlyReading> {
  const terms = () => lighting.hourly.terms;
  return {
    "lighting.staticMesh.ambient": () => ambientText(terms().staticMesh.ambient),
    "lighting.staticMesh.levelOfDetailSunTerm": () => {
      const reading = ambientText(terms().staticMesh.levelOfDetailSunTermAmbient);
      return unverifiedReading(`${reading.text}; which placements take it is ${terms().staticMesh.levelOfDetailSelection.reason}`);
    },
    "lighting.staticMesh.visibility": () => {
      const visibility = lighting.hourly.staticMeshVisibility;
      if (visibility.gap !== null) return unverifiedReading(visibility.gap);
      const probe = visibility.placements.find(placement => placement.sourceActor === staticMeshVisibilityProbeActor);
      const probeText = probe === undefined ? `${staticMeshVisibilityProbeActor} not placed`
        : `${staticMeshVisibilityProbeActor} vertex 0 ${probe.vertexZeroVisibility} (entries ${probe.entryBlend.index} > ${probe.entryBlend.nextIndex} at ${probe.entryBlend.weight})`;
      return nativeReading(`${visibility.placements.length} of ${visibility.placementCount} placements hourly; ${probeText}`);
    },
    "lighting.staticMesh.colour0": () => {
      const lit = lighting.staticMeshSlots.lighting;
      const unlit = Object.entries(lit.unlitPlacementReasons).map(([reason, count]) => `${reason} ${count}`).join(", ") || "none";
      return unverifiedReading(`${lit.litPlacements} placements (${lit.litMeshes} meshes) drawn with the hourly instance colour; unlit: ${unlit}; `
        + `composition ${lit.composition.status} (${lit.composition.reasons.join(", ")})`);
    },
    "lighting.staticMesh.colour1": () => unverifiedReading(`${terms().staticMesh.colour1.drawn} (${terms().staticMesh.colour1.reasons.join(", ")})`),
    "lighting.staticMesh.instanceColour": () => unverifiedReading(terms().staticMesh.serializedInstanceColour),
    "lighting.actor.ambient": () => ambientText(terms().actor.ambient),
    "lighting.dynamicLights": () => unverifiedReading(`not applied (${terms().dynamicLights.reasons.join(", ")})`),
    "lighting.device.modulationOperation": () => unverifiedReading(`image default opcode ${terms().device.modulationOperation.imageDefaultOpcode} (${terms().device.modulationOperation.reason})`),
    "lighting.device.gl2Shader": () => unverifiedReading(terms().device.gl2Shader.reason),
    "lighting.device.materialSourceBit": () => unverifiedReading(terms().device.materialSourceBit.reason),
    "lighting.device.lightList": () => unverifiedReading(terms().device.lightList.reason),
    "lighting.device.finalShaderColour": () => unverifiedReading(terms().device.finalShaderColour.reason),
    "lighting.unresolved": () => unverifiedReading(terms().unresolvedItems.join(", ")),
  };
}

const hourlyVariableSources: Readonly<Record<string, string>> = {
  "lighting.terrain.rebuild": "SetIntensityMap 0x10729bc0 rebuilds on the manager refresh event; the DB-4 lightingDirty flag drives it (claim terrain-rebuild)",
  "lighting.terrain.mapBlend": "TIntMap Time keys, last key <= hour else n-1, +24 unwrap (claim terrain-intensity-interpolation)",
  "lighting.terrain.ambientHalved": "TerrainAmbient >> 1 with alpha 255, added inside the vertex colour (claim terrain-vertex-colour)",
  "lighting.terrain.light": "HSVTerrainLight plane, scaled by 0.5 and intensity / 255 (claim terrain-vertex-colour)",
  "lighting.terrain.probe": terrainProbeSample.source,
  "lighting.terrain.vertices": "COLOR vertex buffer written per terrain vertex from nativeSampleGrid and seamSampleKeys",
  "lighting.terrain.staticBase": "TLIT serialized light masks; a covered vertex needs SampleIntensity (terrain-general-staticlight-sampleintensity)",
  "lighting.terrain.drawn": "layer texture x vertex colour with the global op waits for terrain lighting in the library terrain layer material",
  "lighting.terrain.refreshThreshold": "manager +0x160 threshold; DB-7 did not confirm it holds Env.int ShadowTick",
  "lighting.bsp.slots": "slot = trunc(f32(hour) * N / 24) % N per lightmap texture (claim bsp-discrete-selection); a section draw takes it in a frame when any visible node range "
    + "it submits is sun-affected, else slot 0, and a sorted section picks per node (DB-15 bsp-sun-affect-scope.json 6a300d07, Engine.dll 0x10669de0); "
    + "the visible node set is our port of the visibility walk, not a recorded native draw list",
  "lighting.bsp.sunAffect": "LMNR.sunAffect per drawn node range: the front zone ZoneInfo bSunAffect, or the LevelInfo bSunAffect for a zone without a ZoneInfo; "
    + "hasSun resets on every draw call and is chosen per frame from the visible nodes (DB-15 bsp-sun-affect-scope.json 6a300d07, Engine.dll 0x10669de0); "
    + "the visible node set is our port of the visibility walk, not a recorded native draw list",
  "lighting.bsp.gaps": "sections without a bound lightmap, by reason",
  "lighting.bsp.compressedGate": "LMPG.revision == LMPG.compressedRevision selects the compressed child (claim bsp-compressed-choice)",
  "lighting.bsp.colourOperation": "EnableLighting argument 3: MODULATE for UColorModifier, the global op otherwise (claim bsp-compressed-choice, d3d-modulation)",
  "lighting.bsp.upload": "the DXT1 child is decoded to RGBA on the CPU; mip 0 only",
  "lighting.bsp.rebuildAmbient": "GetBSPAmbientColor * 0.5 starts a texel rebuild only; compressed atlases already hold ambient (claim bsp-ambient-build)",
  "lighting.staticMesh.ambient": "StaticMeshAmbient >> 1, alpha 255, only as D3DRS_AMBIENT (claim ma-static-ambient)",
  "lighting.staticMesh.levelOfDetailSunTerm": "+ low byte of trunc(HSVStaticMeshLight * 32) on LOD 2 with no instance (claim ma-static-ambient, ma-static-lod)",
  "lighting.staticMesh.visibility": "SMEN hourly masks, key 24 (i + 0.5) / n, (1 - w) bit(prev) + w bit(next) (claim ma-hour-keys)",
  "lighting.staticMesh.colour0": "instance FRawColorStream COLOR0, the emissive source (claim ma-stream-colours)",
  "lighting.staticMesh.colour1": "authored FStaticMeshColorStream COLOR1; the mesh+0x188 selector and device+0x4244 bit 0x02 are unresolved",
  "lighting.staticMesh.instanceColour": "StaticMeshInstance serialized colours, read and not staged",
  "lighting.actor.ambient": "ActorAmbient >> 1, alpha 255, light ambient only, COLORVERTEX off (claim ma-actor-ambient)",
  "lighting.dynamicLights": "no Babylon light or scene ambient reaches native materials",
  "lighting.device.modulationOperation": "D3DDrv.dll 0x1011c578 image default 5 (D3DTOP_MODULATE2X); vendor 0x121a writes 4",
  "lighting.device.gl2Shader": "GL2Shader decides the static mesh shader-visibility path",
  "lighting.device.materialSourceBit": "device+0x4244 bit 0x02 makes COLOR1 the diffuse and ambient source",
  "lighting.device.lightList": "the enabled D3D light list of mesh and actor draws",
  "lighting.device.finalShaderColour": "the GL2Shader equations are not decoded; no surface claims a framebuffer colour",
  "lighting.unresolved": "the 13 DB-7 unresolved items and the 4 RM-10 composition items (nativeDrawLightingStates.ts)",
};

function hourlyReadings(lighting: TileLightingRuntimeInspection): Record<string, () => HourlyReading> {
  return { ...terrainReadings(lighting), ...bspReadings(lighting), ...meshAndDeviceReadings(lighting) };
}

interface LightingTaskSnapshot {
  readonly readingByName: Record<string, () => HourlyReading> | null;
  readonly gap: string;
  readonly readings: Map<string, HourlyReading>;
}

function lightingTaskSnapshot(lighting: TileLightingReading): LightingTaskSnapshot {
  return "hourly" in lighting ? { readingByName: hourlyReadings(lighting), gap: "", readings: new Map() }
    : { readingByName: null, gap: lighting.gap, readings: new Map() };
}

function readingsOncePerTask(readLighting: () => TileLightingReading): (name: string) => HourlyReading {
  let snapshot: LightingTaskSnapshot | null = null;
  return name => {
    if (snapshot === null) {
      snapshot = lightingTaskSnapshot(readLighting());
      queueMicrotask(() => { snapshot = null; });
    }
    const known = snapshot.readings.get(name);
    if (known !== undefined) return known;
    if (snapshot.readingByName === null) return unverifiedReading(snapshot.gap);
    const reading = snapshot.readingByName[name];
    if (reading === undefined) throw new Error(`No hourly lighting reading ${name}.`);
    const value = reading();
    snapshot.readings.set(name, value);
    return value;
  };
}

export function hourlyLightingVariables(readLighting: () => TileLightingReading): VariableInfo[] {
  const read = readingsOncePerTask(readLighting);
  return Object.entries(hourlyVariableSources).map(([name, source]): VariableInfo => ({
    name, values: "value | named gap", source: `${source}. ${hourlyLightingReport}`, value: () => read(name).text,
    get status() { return read(name).native ? "native" : "unverified"; },
  }));
}
