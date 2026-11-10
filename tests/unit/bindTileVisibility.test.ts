import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Culling/ray";
import { sceneTileViewSource, tileVisibilityTargets, type TileVisibilityBspChunk } from "../../src/scene/world/bspVisibility/babylonTileVisibilityTargets";
import {
  bindTileVisibility, cullingVariableName, type IndexBlock, type TileViewSource, type TileVisibilityTargets, type VisibilityTarget,
} from "../../src/scene/world/bspVisibility/bindTileVisibility";
import { createTileVisibilityFrameSource, type TileVisibilityLimits } from "../../src/scene/world/bspVisibility/core/tileVisibilityFrame";
import type { ViewPose } from "../../src/scene/world/bspVisibility/core/viewFrustum";
import type { NativeBspSection } from "../../src/scene/world/nativeBspResources";
import { threeRoomMembers, threeRoomSections, threeRoomVisibilityModel } from "../support/bspVisibilityFixture";

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

function bindThreeRooms(initialPose: ViewPose) {
  const model = threeRoomVisibilityModel();
  const sections = [recordingTarget(), recordingTarget()], meshBehindWall = recordingTarget(), terrain = recordingTarget();
  const reorders: (readonly IndexBlock[])[] = [];
  const targets: TileVisibilityTargets = { sections, members: new Map([[threeRoomMembers.meshBehindWall.member, meshBehindWall]]), terrain: [terrain],
    translucentSections: new Map([[threeRoomSections.translucentWalls, { reorderIndexBlocks: blocks => { reorders.push(blocks); } }]]), translucentOrderErrors: [] };
  const manual = manualView(initialPose);
  const binding = bindTileVisibility({ tileId: "fixture", model, view: manual.view, targets, limitRules: [],
    frameSource: createTileVisibilityFrameSource(model, [threeRoomSections.translucentWalls], mostVisible) });
  return { binding, manual, sections, meshBehindWall, terrain, reorders };
}

describe("bindTileVisibility", () => {
  it("leaves every section enabled with culling off and draws only visible sections with culling on", () => {
    const { binding, manual, sections, meshBehindWall, terrain } = bindThreeRooms(poseAt(-500));
    manual.render();
    expect(sections.map(target => target.calls)).toEqual([[], []]);
    expect(binding.frame()?.cameraZone).toBe(1);
    expect(binding.inspection()).toMatchObject({ culling: false, cameraZone: 1, visibleSectionCount: 2, hiddenSectionCount: 0, translucentSectionCount: 1 });
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

  it("rewrites translucent index blocks back to front only when the order changes", () => {
    const { manual, reorders } = bindThreeRooms(poseAt(-500));
    manual.render();
    manual.render(poseAt(-400));
    manual.render(poseAt(2000));
    expect(reorders).toEqual([[{ firstIndex: 3, indexCount: 3 }, { firstIndex: 0, indexCount: 3 }], [{ firstIndex: 0, indexCount: 3 }, { firstIndex: 3, indexCount: 3 }]]);
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
  const threeRoomChunks = (walls: Mesh, floor: Mesh): TileVisibilityBspChunk[] => [
    { chunkOrdinal: 0, sections: [section(true)], meshes: [walls],
      nodeRanges: [{ node: 2, primitive: 0, firstIndex: 0, indexCount: 3 }, { node: 3, primitive: 0, firstIndex: 3, indexCount: 3 }] },
    { chunkOrdinal: 1, sections: [section(false)], meshes: [floor], nodeRanges: [{ node: 4, primitive: 0, firstIndex: 0, indexCount: 3 }] },
  ];

  it("rewrites the index buffer of an unshared translucent mesh and refuses a shared one", () => {
    const model = threeRoomVisibilityModel(), walls = triangleMesh("walls", 2);
    const bound = tileVisibilityTargets(model, { bspChunks: threeRoomChunks(walls, triangleMesh("floor", 1)), placements: [], terrainMeshes: [] });
    if (bound.kind !== "bound") throw new Error(bound.reason);
    bound.targets.translucentSections.get(threeRoomSections.translucentWalls)!.reorderIndexBlocks([{ firstIndex: 3, indexCount: 3 }, { firstIndex: 0, indexCount: 3 }]);
    expect([...walls.getIndices()!]).toEqual([3, 4, 5, 0, 1, 2]);
    const sharedWalls = triangleMesh("shared walls", 2);
    sharedWalls.clone("shared walls clone");
    const shared = tileVisibilityTargets(model, { bspChunks: threeRoomChunks(sharedWalls, triangleMesh("floor", 1)), placements: [], terrainMeshes: [] });
    expect(shared.kind === "bound" && shared.targets.translucentOrderErrors).toEqual(["section 0: shared walls shares its geometry; file order kept"]);
  });

  it("reports an unmapped section as a gap instead of binding", () => {
    const model = threeRoomVisibilityModel();
    const result = tileVisibilityTargets(model, { bspChunks: threeRoomChunks(triangleMesh("walls", 2), triangleMesh("floor", 1)).slice(0, 1), placements: [],
      terrainMeshes: [] });
    expect(result).toMatchObject({ kind: "gap", reason: expect.stringMatching(/^bsp-visibility-section-unmapped: range of node 4/) });
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
      targets: { sections: [sectionTarget(wall), sectionTarget(behindWall)], members: new Map(), terrain: [], translucentSections: new Map(), translucentOrderErrors: [] },
      frameSource: createTileVisibilityFrameSource(model, [], mostVisible) });
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
