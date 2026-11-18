import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import fixturesText from "../fixtures/environment/shared-sky-visibility-fixtures.json?raw";
import { computeSkyLevelVisibilityFrame, decodeSkyLevelVisibility } from "../../src/scene/world/bspVisibility/core/skyLevelVisibilityFrame";
import type { NativeViewFrustum } from "../../src/scene/world/bspVisibility/core/nativeViewFrustum";
import { committedBspWalkRules } from "../../src/scene/world/bspVisibility/sharedSkyVisibilityRules";
import { bindSkyDrawQueue, type SkyPartMesh } from "../../src/scene/world/skyDrawQueueBinding";
import { compareTransparentSubMeshes } from "../../src/runtime/transparentRenderingOrder";

const fixtures = JSON.parse(fixturesText) as { frusta: readonly { role: string; eyeHex: string; planesHex: string }[] };
const stagedFolder = new URL("../fixtures/environment/skylevel-visibility/", import.meta.url);
const model = decodeSkyLevelVisibility(JSON.parse(readFileSync(new URL("visibility.json", stagedFolder), "utf8")),
  new Uint8Array(readFileSync(new URL("payload.bin", stagedFolder))));
const float32Array = (hex: string) => new Float32Array(Uint8Array.from(hex.match(/../g)!, byte => parseInt(byte, 16)).buffer);
const liveSky = fixtures.frusta.find(frustum => frustum.role === "main-sky")!;
const eye = float32Array(liveSky.eyeHex);
const frame = computeSkyLevelVisibilityFrame(model, { eye: { x: eye[0]!, y: eye[1]!, z: eye[2]! },
  frustum: { planes: float32Array(liveSky.planesHex) } as NativeViewFrustum }, committedBspWalkRules.selector);
const partSourceMaterials = Array.from({ length: model.partCount }, (_, part) => `Sky.Shaders.Part${part}`);

function partMesh(scene: Scene, part: number, sourceReference: string | null = partSourceMaterials[part]!): SkyPartMesh {
  let indexCount = 0;
  model.rangePart.forEach((rangePart, range) => {
    if (rangePart === part) indexCount = Math.max(indexCount, model.rangeFirstIndex[range]! + model.rangeIndexCount[range]!);
  });
  const mesh = new Mesh(`sky part ${part}`, scene), vertexData = new VertexData();
  vertexData.positions = new Float32Array(indexCount * 3);
  vertexData.indices = Uint32Array.from({ length: indexCount }, (_, index) => index);
  vertexData.applyToMesh(mesh, true);
  return { mesh, sourceReference };
}

describe("sky draw queue binding", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { scene.dispose(); engine.dispose(); });

  it("rewrites one mesh per material into one submesh per run whose queue ranks follow the native draw order", () => {
    const meshes = Array.from({ length: model.partCount }, (_, part) => partMesh(scene, part));
    const binding = bindSkyDrawQueue([...meshes].reverse(), partSourceMaterials, model);
    expect(binding.apply(frame)).toBe(true);
    expect(binding.apply(frame)).toBe(false);
    const drawnParts = new Set(frame.runs.map(run => run.part));
    const subMeshes = meshes.filter(entry => entry.mesh.isVisible).flatMap(entry => entry.mesh.subMeshes);
    expect(subMeshes).toHaveLength(frame.runs.length);
    const ordered = [...subMeshes].sort(compareTransparentSubMeshes);
    expect(ordered.map(subMesh => meshes.findIndex(entry => entry.mesh === subMesh.getMesh()))).toEqual(frame.runs.map(run => run.part));
    const firstRun = frame.runs[0]!, firstSubMesh = ordered[0]!, indices = (firstSubMesh.getMesh() as Mesh).getIndices()!;
    const expected = firstRun.nodes.flatMap(node => {
      const range = model.nodeRange[node]!;
      return Array.from({ length: model.rangeIndexCount[range]! }, (_, offset) => model.rangeFirstIndex[range]! + offset);
    });
    expect([...indices.slice(firstSubMesh.indexStart, firstSubMesh.indexStart + firstSubMesh.indexCount)]).toEqual(expected);
    expect(binding).toMatchObject({ appliedRunCount: frame.runs.length, orderWrites: drawnParts.size });
  });

  it("hides a material mesh that the frame does not draw and every mesh while the sky is not triggered", () => {
    const meshes = Array.from({ length: model.partCount }, (_, part) => partMesh(scene, part));
    const binding = bindSkyDrawQueue(meshes, partSourceMaterials, model);
    binding.apply(frame);
    const drawnParts = new Set(frame.runs.map(run => run.part));
    meshes.forEach((entry, part) => expect(entry.mesh.isVisible).toBe(drawnParts.has(part)));
    binding.hide();
    expect(meshes.some(entry => entry.mesh.isVisible)).toBe(false);
    expect(binding.apply(frame)).toBe(true);
    expect(binding.orderWrites).toBe(drawnParts.size);
    meshes.forEach((entry, part) => expect(entry.mesh.isVisible).toBe(drawnParts.has(part)));
  });

  it("refuses a part whose material names no mesh or two meshes, and a mesh that shares its geometry", () => {
    const meshes = Array.from({ length: model.partCount }, (_, part) => partMesh(scene, part));
    expect(() => bindSkyDrawQueue([...meshes.slice(1), partMesh(scene, 0, null)], partSourceMaterials, model)).toThrow("Sky.Shaders.Part0 matches 0 meshes");
    expect(() => bindSkyDrawQueue([...meshes, partMesh(scene, 1)], partSourceMaterials, model)).toThrow("Sky.Shaders.Part1 matches 2 meshes");
    const shared = meshes[2]!.mesh.clone("shared geometry", null);
    expect(shared.geometry).toBe(meshes[2]!.mesh.geometry);
    expect(() => bindSkyDrawQueue(meshes, partSourceMaterials, model)).toThrow("shares its geometry");
  });
});
