import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { NativeMover } from "../../src/scene/world/nativeMovers";
import { parseNativeMoverManifest, nativeMoverMapSha256, type NativeMoverRecord } from "../../src/scene/world/nativeMoverManifest";
import { createNativeDoorInteractions } from "../../src/scene/world/nativeDoorInteractions";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { WorldNavigation } from "../../src/world/WorldNavigation";
import type { WorldCommand, WorldPosition } from "../../src/world/worldTypes";
import { createMovementPresenter } from "../../src/scene/world/movement/movementPresenter";
import { sourcePositionToWorld } from "../../src/world/sourceFrame";
import { boxVolumeWorld, floorSlab, pawnRules } from "../fixtures/movement/pawnWorldFixtures";

const releases: (() => void)[] = [];
afterEach(() => { for (const release of releases.splice(0).reverse()) release(); });
const matrix = (x = 0, y = 0, angle = 0) => Array.from(Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Up(), angle), new Vector3(x, y, 0)).asArray());
function record(id = 194, x = 0): NativeMoverRecord {
  return { id: `interlude:20_20.Mover${id}`, modelId: "interlude:l2fortress_02_s.Fort02_indoor", serverObject: { id, realId: 20200000 + id, type: 1 },
    closedMatrix: matrix(x), openMatrix: matrix(x, 0, Math.PI / 2), moveTimeSeconds: 1, initialKey: 0, initiallyClosed: true };
}
function manifest() {
  const archive = "a".repeat(64);
  return { schemaVersion: 1, kind: "native-map-movers", sourceMap: { packageSha256: nativeMoverMapSha256 },
    models: [{ id: "interlude:l2fortress_02_s.Fort02_indoor", sourceObject: "l2fortress_02_s.Fort02_indoor",
      model: { file: `models/${archive}/model.glb`, sha256: "b".repeat(64), bytes: 100 },
      archive: { file: `models/${archive}/asset.l2asset`, sha256: archive, bytes: 200 } }], movers: [record(), record(195, 4)] };
}
function fixture(origin: WorldPosition = { x: .75, y: 0, z: -1.5 }) {
  const engine = new NullEngine(), scene = new Scene(engine); scene.useRightHandedSystem = true;
  releases.push(() => { scene.dispose(); engine.dispose(); });
  const material = new StandardMaterial("shared original door material", scene);
  const targets = [record(), record(195, 4)].map(source => {
    const root = new TransformNode(source.id, scene), mesh = MeshBuilder.CreateBox("source panel", { width: 1.5, height: 3, depth: .08 }, scene);
    mesh.position.set(.75, 1.5, 0); mesh.parent = root; mesh.material = material;
    return new NativeMover(source, root, [mesh]);
  });
  let blocked = false;
  const navigation: WorldNavigation = { origin, ground: p => ({ ...p, y: 0 }), destination: p => ({ ...p, y: 0 }), spawn: () => origin,
    move: (from, to) => ({ position: blocked ? from : to, blocked }) };
  const adapter = new NativeSliceAdapter(origin, navigation, null, undefined, { walkSupported: false, collision: { radius: 9, height: 75 } });
  const presenter = createMovementPresenter({ collisionWorld: boxVolumeWorld([floorSlab(0)]), rules: pawnRules,
    reportIntent: intent => adapter.dispatch(intent), pawnTraits: () => ({ isLocalPlayer: true, walkAnimationFramesInMove: null, flies: false }) });
  adapter.subscribe(event => { if (event.type === "move" || event.type === "stop") presenter.applyEvent(event); });
  const dispatch = (command: WorldCommand) => adapter.dispatch(command);
  const status: string[] = [];
  const doors = createNativeDoorInteractions(scene, targets, {
    player: () => {
      const entity = adapter.getInitialState().find(candidate => candidate.id === "local-player") ?? null;
      const pawn = presenter.inspection().pawns.find(candidate => candidate.entityId === "local-player");
      return entity && pawn ? { ...entity, position: sourcePositionToWorld(pawn.feetPosition), animation: pawn.isMoving ? "run" : entity.animation } : entity;
    }, dispatch,
    onCommand: listener => adapter.subscribeCommands(listener), paused: () => adapter.isPaused,
  }, navigation, { radius: .09, height: 1.5 }, text => status.push(text));
  releases.push(() => { doors.dispose(); adapter.dispose(); });
  return { scene, material, targets, adapter, dispatch, doors, status, block: () => { blocked = true; },
    frame(seconds = .1) { if (!adapter.isPaused) presenter.advance(seconds); doors.update(seconds); } };
}

describe("native mover source contract", () => {
  it("keeps independent source IDs and rigid endpoint transforms", () => {
    const input = manifest(), parsed = parseNativeMoverManifest(input);
    expect(parsed).toBe(input); expect(parsed.movers.map(m => m.id)).toEqual([record().id, record(195).id]);
  });
  it.each(["source", "duplicate", "path", "server", "reflection", "scale", "timing"])("rejects invalid %s data", reason => {
    const input = manifest();
    if (reason === "source") input.sourceMap.packageSha256 = "0".repeat(64);
    if (reason === "duplicate") input.movers[1]!.id = input.movers[0]!.id;
    if (reason === "path") input.models[0]!.model.file = "../model.glb";
    if (reason === "server") input.movers[1]!.serverObject.realId = input.movers[0]!.serverObject.realId;
    if (reason === "reflection") input.movers[0]!.openMatrix[0] = -1;
    if (reason === "scale") input.movers[0]!.closedMatrix[0] = 2;
    if (reason === "timing") input.movers[0]!.moveTimeSeconds = 0;
    expect(() => parseNativeMoverManifest(input)).toThrow(/mover/i);
  });
});

describe("independent doors and proximity interaction", () => {
  it("highlights only the hovered leaf without changing shared materials and restores prior overlays", () => {
    const f = fixture(), first = f.targets[0]!.meshes[0]!, second = f.targets[1]!.meshes[0]!;
    const color = first.overlayColor = new Color3(.1, .2, .3); first.overlayAlpha = .45;
    f.doors.targeting.hover(first); expect(first.renderOverlay).toBe(true); expect(second.renderOverlay).toBeFalsy();
    expect(first.material).toBe(f.material); expect(second.material).toBe(f.material);
    f.doors.targeting.hover(second); expect(first.renderOverlay).toBeFalsy(); expect(first.overlayColor).toBe(color); expect(first.overlayAlpha).toBe(.45);
    expect(second.renderOverlay).toBe(true); f.doors.dispose(); expect(second.renderOverlay).toBeFalsy();
  });
  it("opens and closes one leaf independently and picks the same leaf after it moves", () => {
    const f = fixture(), first = f.targets[0]!;
    expect(f.doors.targeting.activate(first.meshes[0]!)).toBe(true);
    for (let i = 0; i < 11; i++) f.frame();
    expect(first.inspection().state).toBe("open"); expect(f.targets[1]!.inspection().state).toBe("closed");
    expect(first.distance({ x: 0, y: 0, z: -1 })).toBeLessThan(.1);
    f.doors.targeting.activate(first.meshes[0]!);
    for (let i = 0; i < 11; i++) f.frame();
    expect(first.inspection().state).toBe("closed");
  });
  it("walks into proximity before activating and stops the approach at that point", () => {
    const f = fixture({ x: .75, y: 0, z: -5 });
    f.doors.activate(f.targets[0]!.source.id);
    expect(f.doors.inspection().pendingId).toBe(f.targets[0]!.source.id); expect(f.targets[0]!.inspection().state).toBe("closed");
    for (let i = 0; i < 20; i++) f.frame();
    expect(f.targets[0]!.inspection().state).toBe("closed");
    for (let i = 0; i < 40; i++) f.frame();
    const player = f.adapter.getInitialState()[0]!;
    expect(f.targets[0]!.distance(player.position)).toBeLessThanOrEqual(2);
    expect(player.position.z).toBeGreaterThan(-2.1); expect(player.position.z).toBeLessThan(-1.8);
    expect(player.animation).toBe("idle"); expect(f.doors.inspection().pendingId).toBeNull(); expect(f.targets[0]!.inspection().state).toBe("open");
  });
  it("cancels an approach replaced by ground movement without remote activation", () => {
    const f = fixture({ x: .75, y: 0, z: -5 }); f.doors.activate(f.targets[0]!.source.id);
    f.dispatch({ type: "move-local", position: { x: -6, y: 0, z: -5 } });
    for (let i = 0; i < 100; i++) f.frame();
    expect(f.doors.inspection().pendingId).toBeNull(); expect(f.targets[0]!.inspection().state).toBe("closed");
  });
  it("rejects a blocked direct route, and cancels if an accepted approach later reports cannot-move", () => {
    const f = fixture({ x: .75, y: 0, z: -5 }); f.doors.activate(f.targets[0]!.source.id); f.block();
    f.dispatch({ type: "cannot-move", position: { x: 75, y: -500, z: 0 }, heading: 0 }); f.frame();
    expect(f.doors.inspection().pendingId).toBeNull(); expect(f.targets[0]!.inspection().state).toBe("closed");
    f.doors.activate(f.targets[0]!.source.id); expect(f.status.at(-1)).toMatch(/cannot be reached/); expect(f.doors.inspection().pendingId).toBeNull();
  });
  it("requires the same level and a living player", () => {
    const f = fixture({ x: .75, y: 4, z: -1 }); f.doors.activate(f.targets[0]!.source.id);
    expect(f.status.at(-1)).toMatch(/same level/); expect(f.doors.inspection().pendingId).toBeNull();
    f.dispatch({ type: "set-health", entityId: "local-player", health: 0 }); f.doors.activate(f.targets[0]!.source.id); f.frame();
    expect(f.targets[0]!.inspection().state).toBe("closed");
  });
  it("cancels a pending approach on death, action, other target or disposal", () => {
    const f = fixture({ x: .75, y: 0, z: -5 });
    f.doors.activate(f.targets[0]!.source.id); f.dispatch({ type: "set-health", entityId: "local-player", health: 0 });
    expect(f.doors.inspection().pendingId).toBeNull();
    f.dispatch({ type: "set-health", entityId: "local-player", health: 100 }); f.doors.activate(f.targets[0]!.source.id);
    f.dispatch({ type: "set-animation", animation: "attack" }); expect(f.doors.inspection().pendingId).toBeNull();
    f.doors.activate(f.targets[0]!.source.id); f.doors.activate(f.targets[1]!.source.id); expect(f.doors.inspection().pendingId).toBe(f.targets[1]!.source.id);
    f.doors.dispose(); expect(f.doors.inspection().pendingId).toBeNull(); expect(f.adapter.getInitialState()[0]!.animation).toBe("idle");
  });
  it("pauses motion and resumes without a wall-clock jump", () => {
    const f = fixture(); f.doors.activate(f.targets[0]!.source.id); f.frame(.2);
    f.dispatch({ type: "set-paused", isPaused: true }); const fraction = f.targets[0]!.inspection().fraction; f.frame(5);
    expect(f.targets[0]!.inspection().fraction).toBe(fraction); f.dispatch({ type: "set-paused", isPaused: false }); f.frame(.2);
    expect(f.targets[0]!.inspection().fraction).toBeCloseTo(fraction + .2);
  });
  it("blocks a leaf sweeping through the player and resumes after the player leaves", () => {
    const f = fixture(), target = f.targets[0]!; target.requestToggle();
    target.advance(1, { position: { x: .7, y: 0, z: -.7 }, radius: .09, height: 1.5 });
    expect(target.inspection().state).toBe("blocked"); expect(target.inspection().fraction).toBe(0);
    target.advance(1, { position: { x: 4, y: 0, z: -4 }, radius: .09, height: 1.5 }); expect(target.inspection().state).toBe("open");
  });
  it("interpolates translating gate keys without changing mesh-local geometry", () => {
    const f = fixture(), root = new TransformNode("gate", f.scene), mesh = MeshBuilder.CreateBox("gate source", { width: 2, height: 2, depth: .1 }, f.scene);
    mesh.position.y = 1; mesh.parent = root; const vertices = [...mesh.getVerticesData("position")!];
    const source = { ...record(1), openMatrix: matrix(0, 1.36) }, gate = new NativeMover(source, root, [mesh]); gate.requestToggle(); gate.advance(.5);
    expect(gate.inspection().matrix[13]).toBeCloseTo(.68); expect([...mesh.getVerticesData("position")!]).toEqual(vertices);
    gate.advance(.5); expect(gate.inspection().matrix[13]).toBeCloseTo(1.36);
  });
});
