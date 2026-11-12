import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Culling/ray";
import { attachTileVisibility, type BoundTileVisibilityRuntimeInspection } from "../../src/scene/world/bspVisibility/attachTileVisibility";
import { chunkVisibilityTargets, sceneTileViewSource, type TileVisibilityBspMeshes } from "../../src/scene/world/bspVisibility/babylonTileVisibilityTargets";
import {
  bindTileVisibility, cullingVariableName, type ChunkVisibilityTargets, type IndexBlock, type TileViewSource, type VisibilityTarget,
} from "../../src/scene/world/bspVisibility/bindTileVisibility";
import { createTileVisibilityFrameSource, type TileVisibilityLimits } from "../../src/scene/world/bspVisibility/core/tileVisibilityFrame";
import type { ViewPose } from "../../src/scene/world/bspVisibility/core/viewFrustum";
import type { NativeTileBspChunk } from "../../src/scene/world/loadNativeTileChunks";
import type { NativeBspSection } from "../../src/scene/world/nativeBspResources";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";
import { threeRoomMembers, threeRoomSections, threeRoomVisibilityModel } from "../support/bspVisibilityFixture";

vi.mock("../../src/scene/world/bspVisibility/loadBspVisibility", async () => {
  const { threeRoomVisibilityModel: model } = await import("../support/bspVisibilityFixture");
  return { loadBspVisibility: async () => model() };
});

const mostVisible: TileVisibilityLimits = { portalRange: Infinity, portalDepthCap: Infinity, staticMeshRange: Infinity, emitterRange: Infinity };
const poseAt = (x: number): ViewPose => ({ position: { x, y: 0, z: 0 }, forward: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 },
  verticalFieldOfView: Math.PI / 3, aspectRatio: 16 / 9, near: 10, far: Infinity });

interface RecordingTarget extends VisibilityTarget { readonly calls: boolean[] }
const recordingTarget = (): RecordingTarget => {
  const calls: boolean[] = [];
  return { calls, setVisible: visible => { calls.push(visible); } };
};

function manualView(initialPose: ViewPose) {
  let step: (() => void) | null = null, current = initialPose;
  const view: TileViewSource = { onFrame(callback) { step = callback; return () => { step = null; }; }, pose: () => current };
  return { view, render(nextPose: ViewPose = current) { current = nextPose; step?.(); }, stopped: () => step === null };
}

function chunkTargets(sections: ReadonlyMap<number, VisibilityTarget>, terrain: VisibilityTarget, extra: Partial<ChunkVisibilityTargets> = {}): ChunkVisibilityTargets {
  return { sections, members: new Map(), terrain, translucentSections: new Map(), translucentOrderErrors: [], ...extra };
}

function bindThreeRooms(initialPose: ViewPose) {
  const model = threeRoomVisibilityModel();
  const sections = [recordingTarget(), recordingTarget()], meshBehindWall = recordingTarget(), terrain = recordingTarget(), floorTerrain = recordingTarget();
  const reorders: (readonly IndexBlock[])[] = [];
  const manual = manualView(initialPose);
  const binding = bindTileVisibility({ tileId: "fixture", model, view: manual.view, limitRules: [], frameSource: createTileVisibilityFrameSource(model, mostVisible) });
  binding.addChunkTargets("chunk-0-0", chunkTargets(new Map([[threeRoomSections.translucentWalls, sections[0]!]]), terrain, {
    members: new Map([[threeRoomMembers.meshBehindWall.member, meshBehindWall]]),
    translucentSections: new Map([[threeRoomSections.translucentWalls, { reorderIndexBlocks: blocks => { reorders.push(blocks); } }]]) }));
  binding.addChunkTargets("chunk-1-0", chunkTargets(new Map([[threeRoomSections.behindWallFloor, sections[1]!]]), floorTerrain));
  return { binding, manual, sections, meshBehindWall, terrain, reorders };
}

describe("bindTileVisibility", () => {
  it("leaves every section enabled with culling off and draws only visible sections with culling on", () => {
    const { binding, manual, sections, meshBehindWall, terrain } = bindThreeRooms(poseAt(-500));
    manual.render();
    expect(sections.map(target => target.calls)).toEqual([[], []]);
    expect(binding.frame()?.cameraZone).toBe(1);
    expect(binding.inspection()).toMatchObject({ culling: false, cameraZone: 1, visibleSectionCount: 2, hiddenSectionCount: 0, translucentSectionCount: 1,
      targetChunkIds: ["chunk-0-0", "chunk-1-0"], targetSectionCount: 2 });
    binding.setCulling(true);
    manual.render();
    expect(sections.map(target => target.calls)).toEqual([[], [false]]);
    expect({ mesh: meshBehindWall.calls, terrain: terrain.calls }).toEqual({ mesh: [false], terrain: [false] });
    expect(binding.inspection()).toMatchObject({ culling: true, visibleZoneCount: 2, openedPortalCount: 1, hiddenSectionCount: 1 });
    binding.setCulling(false);
    manual.render();
    expect(sections.map(target => target.calls)).toEqual([[], [false, true]]);
    expect({ mesh: meshBehindWall.calls, terrain: terrain.calls }).toEqual({ mesh: [false, true], terrain: [false, true] });
    binding.dispose();
    expect(manual.stopped()).toBe(true);
  });

  it("gives a chunk added after culling ran the shown state of its sections and stops driving a removed chunk", () => {
    const model = threeRoomVisibilityModel();
    const manual = manualView(poseAt(-500));
    const binding = bindTileVisibility({ tileId: "fixture", model, view: manual.view, limitRules: [], frameSource: createTileVisibilityFrameSource(model, mostVisible) });
    const walls = recordingTarget(), floor = recordingTarget(), wallsTerrain = recordingTarget(), floorTerrain = recordingTarget();
    binding.addChunkTargets("chunk-0-0", chunkTargets(new Map([[threeRoomSections.translucentWalls, walls]]), wallsTerrain));
    binding.setCulling(true);
    manual.render();
    expect(binding.inspection().targetChunkIds).toEqual(["chunk-0-0"]);
    binding.addChunkTargets("chunk-1-0", chunkTargets(new Map([[threeRoomSections.behindWallFloor, floor]]), floorTerrain));
    expect({ floor: floor.calls, floorTerrain: floorTerrain.calls }).toEqual({ floor: [false], floorTerrain: [false] });
    binding.removeChunkTargets("chunk-1-0");
    binding.setCulling(false);
    manual.render();
    expect({ walls: walls.calls, floor: floor.calls, floorTerrain: floorTerrain.calls }).toEqual({ walls: [], floor: [false], floorTerrain: [false] });
    expect(wallsTerrain.calls).toEqual([false, true]);
    expect(binding.inspection()).toMatchObject({ targetChunkIds: ["chunk-0-0"], targetSectionCount: 1 });
    binding.dispose();
  });

  it("answers memberVisible for map emitter placements by export index", () => {
    const { binding, manual } = bindThreeRooms(poseAt(-500));
    const { emitterInCameraRoom, emitterBehindWall } = threeRoomMembers;
    manual.render();
    expect([binding.memberVisible(emitterInCameraRoom.exportIndex), binding.memberVisible(emitterBehindWall.exportIndex)]).toEqual([true, true]);
    binding.setCulling(true);
    manual.render();
    expect([binding.memberVisible(emitterInCameraRoom.exportIndex), binding.memberVisible(emitterBehindWall.exportIndex)]).toEqual([true, false]);
    expect(binding.memberVisible(999)).toBe(true);
  });

  it("rewrites translucent index blocks back to front only when the order changes and stops once the chunk leaves", () => {
    const { binding, manual, reorders } = bindThreeRooms(poseAt(-500));
    manual.render();
    manual.render(poseAt(-400));
    manual.render(poseAt(2000));
    expect(reorders).toEqual([[{ firstIndex: 3, indexCount: 3 }, { firstIndex: 0, indexCount: 3 }], [{ firstIndex: 0, indexCount: 3 }, { firstIndex: 3, indexCount: 3 }]]);
    binding.removeChunkTargets("chunk-0-0");
    manual.render(poseAt(-500));
    expect(reorders).toHaveLength(2);
    expect(binding.inspection().translucentSectionCount).toBe(0);
  });

  it("describes the culling switch as an off-by-default presentation variable", () => {
    const { binding } = bindThreeRooms(poseAt(-500));
    const [row] = binding.describe();
    expect({ name: row!.name, value: row!.value(), values: row!.values, status: row!.status }).toEqual({ name: cullingVariableName, value: "off", values: "off | on",
      status: "presentation" });
    binding.setCulling(true);
    expect(row!.value()).toBe("on");
  });
});

describe("Babylon targets and picking", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); scene.useRightHandedSystem = true; });
  afterEach(() => { scene.dispose(); engine.dispose(); });

  const section = (translucent: boolean): NativeBspSection => ({ primitive: 0, material: "fixture", unlit: false, lightmap: null, outdoor: false, translucent });
  const triangleMesh = (name: string, triangleCount: number) => {
    const mesh = new Mesh(name, scene), data = new VertexData();
    data.positions = Array.from({ length: triangleCount * 9 }, (_, index) => index);
    data.indices = Array.from({ length: triangleCount * 3 }, (_, index) => index);
    data.applyToMesh(mesh, false);
    return mesh;
  };
  const wallsChunk = (walls: Mesh): TileVisibilityBspMeshes => ({ sections: [section(true)], meshes: [walls],
    nodeRanges: [{ node: 2, primitive: 0, firstIndex: 0, indexCount: 3 }, { node: 3, primitive: 0, firstIndex: 3, indexCount: 3 }] });
  const floorChunk = (floor: Mesh): TileVisibilityBspMeshes => ({ sections: [section(false)], meshes: [floor], nodeRanges: [{ node: 4, primitive: 0, firstIndex: 0, indexCount: 3 }] });
  const residentChunk = (chunkOrdinal: number, bspChunk: TileVisibilityBspMeshes | null) => ({ chunkOrdinal, bspChunk, placements: [], terrainMeshes: [] });

  it("rewrites the index buffer of an unshared translucent mesh and refuses a shared one", () => {
    const model = threeRoomVisibilityModel(), walls = triangleMesh("walls", 2);
    const bound = chunkVisibilityTargets(model, residentChunk(0, wallsChunk(walls)));
    if (bound.kind !== "bound") throw new Error(bound.reason);
    bound.targets.translucentSections.get(threeRoomSections.translucentWalls)!.reorderIndexBlocks([{ firstIndex: 3, indexCount: 3 }, { firstIndex: 0, indexCount: 3 }]);
    expect([...walls.getIndices()!]).toEqual([3, 4, 5, 0, 1, 2]);
    const sharedWalls = triangleMesh("shared walls", 2);
    sharedWalls.clone("shared walls clone");
    const shared = chunkVisibilityTargets(model, residentChunk(0, wallsChunk(sharedWalls)));
    expect(shared.kind === "bound" && shared.targets.translucentOrderErrors).toEqual(["section 0: shared walls shares its geometry; file order kept"]);
  });

  it("maps the sections of a resident chunk without naming a chunk that is not resident", () => {
    const model = threeRoomVisibilityModel();
    const walls = chunkVisibilityTargets(model, residentChunk(0, wallsChunk(triangleMesh("walls", 2))));
    expect(walls.kind === "bound" && [...walls.targets.sections.keys()]).toEqual([threeRoomSections.translucentWalls]);
    const floor = chunkVisibilityTargets(model, residentChunk(1, floorChunk(triangleMesh("floor", 1))));
    expect(floor.kind === "bound" && [...floor.targets.sections.keys()]).toEqual([threeRoomSections.behindWallFloor]);
  });

  it("reports a resident chunk whose BSP lacks its ranges as an unmapped section", () => {
    const result = chunkVisibilityTargets(threeRoomVisibilityModel(), residentChunk(1, null));
    expect(result).toMatchObject({ kind: "gap", reason: expect.stringMatching(/^bsp-visibility-section-unmapped: range of node 4/) });
  });

  it("culls the resident chunks of a tile, keeps a non-resident chunk out of the walk and lists an unmapped resident chunk", async () => {
    const visibilitySha256 = "c".repeat(64);
    const manifest = parseNativeTileManifest({
      kind: "native-tile-runtime", schemaVersion: 1, tileId: "20_21", sourceMap: "maps/20_21.unr", sourceSha256: "e".repeat(64),
      frame: { terrainInfo: "20_21.TerrainInfo0", location: [0, 0, 0], terrainScale: [1, 1, 1] }, anchor: { playerStart: "20_21.PlayerStart0", location: [0, 0, 0] },
      chunks: ["chunk-0-0", "chunk-1-0"].map((chunkId, ordinal) => ({ chunkId, manifest: `/l2/maps/${String(ordinal + 1).repeat(64)}/native-tile-chunk-runtime/manifest.json`,
        manifestSha256: String(ordinal + 1).repeat(64), manifestBytes: 100 })),
      resources: [{ kind: "bsp-visibility", manifest: `/l2/maps/${visibilitySha256}/native-tile-bsp-visibility/asset.json`, manifestSha256: visibilitySha256,
        manifestBytes: 100 }],
      gaps: [],
    });
    const visibility = await attachTileVisibility(scene, manifest, new AbortController().signal);
    const wallsBsp: NativeTileBspChunk = { chunkId: "chunk-0-0", resource: "/l2/bsp/walls", ...wallsChunk(triangleMesh("walls", 2)) };
    visibility.addChunk({ chunkId: "chunk-0-0", bspChunk: wallsBsp, placements: [], terrainMeshes: [] });
    expect(visibility.inspection()).toMatchObject({ gap: null, targetChunkIds: ["chunk-0-0"], unmappedChunks: [] });
    visibility.addChunk({ chunkId: "chunk-1-0", bspChunk: null, placements: [], terrainMeshes: [] });
    const withUnmapped = visibility.inspection() as BoundTileVisibilityRuntimeInspection;
    expect(withUnmapped.targetChunkIds).toEqual(["chunk-0-0"]);
    expect(withUnmapped.unmappedChunks).toEqual([{ chunkId: "chunk-1-0", reason: expect.stringMatching(/^bsp-visibility-section-unmapped: range of node 4/) }]);
    visibility.removeChunk("chunk-1-0");
    visibility.removeChunk("chunk-0-0");
    expect(visibility.inspection()).toMatchObject({ gap: null, targetChunkIds: [], unmappedChunks: [] });
    visibility.dispose();
  });

  it("gives the same door hover, door activation and targeting picks with culling on and off", () => {
    const camera = new FreeCamera("camera", new Vector3(-5, 0, 0), scene);
    camera.setTarget(new Vector3(10, 0, 0));
    const wall = CreateBox("wall", { width: 0.1, height: 20, depth: 20 }, scene);
    wall.position.x = 10;
    const behindWall = CreateBox("behind wall", { size: 4 }, scene);
    behindWall.position.x = 20;
    const door = CreateBox("door", { width: 0.5, height: 3, depth: 2 }, scene);
    door.position.x = 5;
    const fighter = CreateBox("fighter", { size: 1 }, scene);
    fighter.position.set(3, 0, 1.5);
    fighter.metadata = { clientEntityId: "fighter" };
    const sectionTarget = (mesh: Mesh): VisibilityTarget => ({ setVisible: visible => { mesh.isVisible = visible; } });
    const model = threeRoomVisibilityModel();
    const binding = bindTileVisibility({ tileId: "fixture", model, view: sceneTileViewSource(scene), limitRules: [],
      frameSource: createTileVisibilityFrameSource(model, mostVisible) });
    binding.addChunkTargets("chunk-0-0", chunkTargets(new Map([[0, sectionTarget(wall)]]), { setVisible() {} }));
    binding.addChunkTargets("chunk-1-0", chunkTargets(new Map([[1, sectionTarget(behindWall)]]), { setVisible() {} }));
    const pickGrid = () => {
      scene.render();
      const answers: string[] = [];
      for (let column = 0; column <= 16; column++) for (let row = 0; row <= 8; row++) {
        const picked = scene.pick(column * engine.getRenderWidth() / 16, row * engine.getRenderHeight() / 8)?.pickedMesh ?? null;
        answers.push(picked === door ? "door" : picked?.metadata?.clientEntityId ?? "none");
      }
      return answers;
    };
    const cullingOff = pickGrid();
    binding.setCulling(true);
    const cullingOn = pickGrid();
    expect(binding.inspection()).toMatchObject({ culling: true, cameraZone: 1, hiddenSectionCount: 1 });
    expect(behindWall.isVisible).toBe(false);
    expect(cullingOn).toEqual(cullingOff);
    expect(cullingOff).toEqual(expect.arrayContaining(["door", "fighter"]));
    binding.dispose();
  });
});
