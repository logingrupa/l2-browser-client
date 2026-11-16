import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { bindTerrainVertexLighting, terrainLightMaskSectorOriginUnstagedReason } from "../../src/scene/world/lighting/bindTerrainVertexLighting";
import { decodeTileLighting } from "../../src/scene/world/lighting/decodeTileLighting";
import { terrainSampleKeysUnstagedReason } from "../../src/scene/world/lighting/terrainVertexSampleIndices";
import { hourlyEnvironmentAt, probeColumn, probeRow, terrainIntensityArrays, terrainLightMaskArrays } from "../support/hourlyLightingInputsFixture";
import { fixtureNumber, fixtureNumbers, readHourlyLightingFixtures } from "../support/hourlyLightingFixtures";
import { tileLightingArrays, tileLightingPayload } from "../support/tileLightingFixture";
import type { TypedPayloadFixtureArray } from "../support/typedPayloadFixture";

const scenes: Scene[] = [];
const gridOrigin = [probeColumn - 1, probeRow - 1] as const, gridQuads = [2, 2] as const;
const probeVertex = 4;
const seamKeys = [[256, 129]] as const;

afterEach(() => {
  for (const scene of scenes.splice(0)) {
    const engine = scene.getEngine();
    scene.dispose();
    engine.dispose();
  }
});

function hourlyInputs(arrays: readonly TypedPayloadFixtureArray[]) {
  const payload = tileLightingPayload([...tileLightingArrays(), ...arrays]);
  return decodeTileLighting(payload.assetRecord, payload.payloadBytes).hourly;
}

function terrainMesh(extras: Record<string, unknown> | null): Mesh {
  const scene = new Scene(new NullEngine());
  scenes.push(scene);
  const mesh = new Mesh("TerrainSector136 rectangle", scene);
  const vertexCount = (gridQuads[0] + 1) * (gridQuads[1] + 1) + seamKeys.length;
  Object.assign(new VertexData(), { positions: Array.from({ length: vertexCount * 3 }, (_, index) => index), indices: [0, 1, 3] }).applyToMesh(mesh);
  mesh.metadata = extras === null ? null : { gltf: { extras } };
  return mesh;
}

const keyedExtras = { nativeSampleGrid: { offset: [...gridOrigin], quads: [...gridQuads] }, seamSampleKeys: seamKeys.map(key => [...key]) };
const terrainFixtureRows = () => readHourlyLightingFixtures().fixtures.filter(row => row.surfaceType === "terrain" && row.controlWord === "0x7f");

describe("bindTerrainVertexLighting", () => {
  it.each(terrainFixtureRows().map(row => [row.hour, row] as const))("writes the DB-7 vertex colour of sample (134,129) at hour %s", (hour, row) => {
    const mesh = terrainMesh(keyedExtras);
    const inputs = hourlyInputs([...terrainIntensityArrays(), ...terrainLightMaskArrays([0, 0, 0])]);
    const binding = bindTerrainVertexLighting(inputs.terrainIntensityMaps, inputs.terrainLightMasks);
    binding.addChunk("chunk-0-0", [mesh], () => hourlyEnvironmentAt(hour, false));
    const expectedBgra = fixtureNumbers(row.output, "vertexBGRA");
    const inspection = binding.inspection();
    expect(inspection).toMatchObject({ gap: null, rebuildCount: 1, lastRebuildHour: hour, colouredMeshCount: 1, colouredVertexCount: 10,
      staticBase: { status: "resolved", lightsCoveringAVertex: 0 }, drawn: { value: false, reason: "library-terrain-layers-unported" },
      refreshThreshold: { reason: "terrain-refresh-threshold-unresolved" } });
    expect(inspection.probe).toEqual({ column: probeColumn, row: probeRow, intensity: fixtureNumber(row.input, "truncatedIntensity"), bgra: expectedBgra });
    expect(inspection.mapBlend).toMatchObject({ index: fixtureNumbers(row.input, "mapIndices")[0], nextIndex: fixtureNumbers(row.input, "mapIndices")[1] });
    const colours = mesh.getVerticesData(VertexBuffer.ColorKind)!;
    expect(Array.from(colours).slice(probeVertex * 4, probeVertex * 4 + 4).map(channel => Math.round(channel * 255)))
      .toEqual([expectedBgra[2], expectedBgra[1], expectedBgra[0], expectedBgra[3]]);
    expect(mesh.useVertexColors).toBe(false);
  });

  it("rebuilds only when the environment manager raises its lighting dirty flag and holds the last colours through a type transition", () => {
    const mesh = terrainMesh(keyedExtras);
    const inputs = hourlyInputs(terrainIntensityArrays());
    const binding = bindTerrainVertexLighting(inputs.terrainIntensityMaps, inputs.terrainLightMasks);
    binding.addChunk("chunk-0-0", [mesh], () => hourlyEnvironmentAt(0, false));
    const coloursAtZero = Array.from(mesh.getVerticesData(VertexBuffer.ColorKind)!);
    binding.update(() => hourlyEnvironmentAt(12, false));
    expect(binding.inspection()).toMatchObject({ rebuildCount: 1, lastRebuildHour: 0 });
    binding.update(() => hourlyEnvironmentAt(12, true));
    expect(binding.inspection()).toMatchObject({ rebuildCount: 2, lastRebuildHour: 12, heldReason: null });
    expect(Array.from(mesh.getVerticesData(VertexBuffer.ColorKind)!)).not.toEqual(coloursAtZero);
    const coloursAtNoon = Array.from(mesh.getVerticesData(VertexBuffer.ColorKind)!);
    binding.update(() => hourlyEnvironmentAt(18, true, { oldType: 0, targetType: 3, weight: 0.5 }));
    expect(binding.inspection()).toMatchObject({ rebuildCount: 2, lastRebuildHour: 12, heldReason: "env-color-transition-unresolved" });
    expect(Array.from(mesh.getVerticesData(VertexBuffer.ColorKind)!)).toEqual(coloursAtNoon);
  });

  it("names the static base gap when a serialized terrain light covers a vertex the payload cannot place", () => {
    const inputs = hourlyInputs([...terrainIntensityArrays(), ...terrainLightMaskArrays([0, 0x80, 0])]);
    const binding = bindTerrainVertexLighting(inputs.terrainIntensityMaps, inputs.terrainLightMasks);
    expect(binding.inspection().staticBase).toEqual({ status: "unresolved", lightsCoveringAVertex: 1,
      reasons: ["terrain-general-staticlight-sampleintensity", terrainLightMaskSectorOriginUnstagedReason] });
  });

  it("reports a visible gap and writes no colours for terrain converted before the TIntMap or the sample keys", () => {
    const unstagedMesh = terrainMesh(keyedExtras);
    const unstaged = hourlyInputs([]);
    const unstagedBinding = bindTerrainVertexLighting(unstaged.terrainIntensityMaps, unstaged.terrainLightMasks);
    unstagedBinding.addChunk("chunk-0-0", [unstagedMesh], () => hourlyEnvironmentAt(0, true));
    unstagedBinding.update(() => hourlyEnvironmentAt(0, true));
    expect(unstagedBinding.inspection()).toMatchObject({ gap: "hourly-lighting-input-unstaged:TINT.time", rebuildCount: 0, probe: null, colouredMeshCount: 0 });
    expect(unstagedMesh.isVerticesDataPresent(VertexBuffer.ColorKind)).toBe(false);
    const unkeyedMesh = terrainMesh(null);
    const staged = hourlyInputs(terrainIntensityArrays());
    const binding = bindTerrainVertexLighting(staged.terrainIntensityMaps, staged.terrainLightMasks);
    binding.addChunk("chunk-0-0", [unkeyedMesh], () => hourlyEnvironmentAt(0, true));
    expect(binding.inspection()).toMatchObject({ meshGaps: { [terrainSampleKeysUnstagedReason]: 1 }, colouredMeshCount: 0 });
    expect(unkeyedMesh.isVerticesDataPresent(VertexBuffer.ColorKind)).toBe(false);
    binding.removeChunk("chunk-0-0");
    expect(binding.inspection().meshGaps).toEqual({});
  });
});
