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
import { bindSkyDrawQueue } from "../../src/scene/world/skyDrawQueueBinding";
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

function partMesh(scene: Scene, part: number): Mesh {
  let indexCount = 0;
  model.rangePart.forEach((rangePart, range) => {
    if (rangePart === part) indexCount = Math.max(indexCount, model.rangeFirstIndex[range]! + model.rangeIndexCount[range]!);
  });
  const mesh = new Mesh(`sky part ${part}`, scene), vertexData = new VertexData();
  vertexData.positions = new Float32Array(indexCount * 3);
  vertexData.indices = Uint32Array.from({ length: indexCount }, (_, index) => index);
  vertexData.applyToMesh(mesh, true);
  return mesh;
}

describe("sky draw queue binding", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { scene.dispose(); engine.dispose(); });

  it("rewrites one mesh per material into one submesh per run whose queue ranks follow the native draw order", () => {
    const meshes = Array.from({ length: model.partCount }, (_, part) => partMesh(scene, part));
    const binding = bindSkyDrawQueue(meshes, model);
    expect(binding.apply(frame)).toBe(true);
    expect(binding.apply(frame)).toBe(false);
    const subMeshes = meshes.filter(mesh => mesh.isVisible).flatMap(mesh => mesh.subMeshes);
    expect(subMeshes).toHaveLength(frame.runs.length);
    const ordered = [...subMeshes].sort(compareTransparentSubMeshes);
    expect(ordered.map(subMesh => meshes.indexOf(subMesh.getMesh() as Mesh))).toEqual(frame.runs.map(run => run.part));
    const firstRun = frame.runs[0]!, firstSubMesh = ordered[0]!, indices = (firstSubMesh.getMesh() as Mesh).getIndices()!;
    const expected = firstRun.nodes.flatMap(node => {
      const range = model.nodeRange[node]!;
      return Array.from({ length: model.rangeIndexCount[range]! }, (_, offset) => model.rangeFirstIndex[range]! + offset);
    });
    expect([...indices.slice(firstSubMesh.indexStart, firstSubMesh.indexStart + firstSubMesh.indexCount)]).toEqual(expected);
    expect(binding).toMatchObject({ appliedRunCount: frame.runs.length, orderWrites: 1 });
  });

  it("hides a material mesh that the frame does not draw", () => {
    const meshes = Array.from({ length: model.partCount }, (_, part) => partMesh(scene, part));
    bindSkyDrawQueue(meshes, model).apply(frame);
    const drawnParts = new Set(frame.runs.map(run => run.part));
    meshes.forEach((mesh, part) => expect(mesh.isVisible).toBe(drawnParts.has(part)));
  });
});
