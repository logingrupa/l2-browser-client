import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Rendering/outlineRenderer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { WorldCommand, WorldEntity, WorldPosition } from "../../world/worldTypes";
import type { WorldNavigation } from "../../world/WorldNavigation";
import type { NativeMover } from "./nativeMovers";

export interface DoorActorPort {
  player(): WorldEntity | null;
  dispatch(command: WorldCommand): void;
  onCommand(listener: (command: WorldCommand) => void): () => void;
  paused(): boolean;
}
/** Explicit browser interaction policy. Source IDs, poses and MoveTime are
 * retained separately; proximity and approach are not a native-server claim. */
export const nativeDoorInteractionPolicy = Object.freeze({ interactionDistanceMetres: 2, verticalToleranceMetres: 1.5, approachStandOffMetres: .8 });
export interface DoorTargeting {
  hover(mesh: AbstractMesh | null): void;
  activate(mesh: AbstractMesh | null): boolean;
  cancel(): void;
}
export function createNativeDoorInteractions(scene: Scene, targets: readonly NativeMover[], actor: DoorActorPort,
  navigation: WorldNavigation, capsule: { radius: number; height: number }, onStatus: (message: string) => void = () => {}) {
  const policy = nativeDoorInteractionPolicy, byMesh = new Map<AbstractMesh, NativeMover>(targets.flatMap(target => target.meshes.map(mesh => [mesh, target] as const)));
  const byId = new Map(targets.map(target => [target.source.id, target]));
  const canvas = scene.getEngine().getRenderingCanvas();
  let pending: NativeMover | null = null, hovered: NativeMover | null = null, disposed = false, ownCommand = false;
  let saved: { mesh: Mesh; overlay: boolean; color: Color3; alpha: number }[] = [], cursor: string | undefined;
  const issue = (command: WorldCommand) => { ownCommand = true; try { actor.dispatch(command); } finally { ownCommand = false; } };
  const cancel = (stopMovement = true) => {
    if (!pending) return;
    pending = null;
    if (stopMovement && actor.player()?.animation === "run") issue({ type: "set-animation", animation: "idle" });
  };
  const hover = (mesh: AbstractMesh | null) => {
    const target = !disposed && !actor.paused() && mesh && !mesh.isDisposed() ? byMesh.get(mesh) ?? null : null;
    if (hovered === target) return;
    for (const entry of saved) if (!entry.mesh.isDisposed()) {
      entry.mesh.renderOverlay = entry.overlay; entry.mesh.overlayColor = entry.color; entry.mesh.overlayAlpha = entry.alpha;
    }
    saved = []; hovered = target;
    if (canvas && cursor !== undefined) { canvas.style.cursor = cursor; cursor = undefined; }
    if (target) {
      saved = target.meshes.filter(mesh => !mesh.isDisposed()).map(mesh => ({ mesh, overlay: mesh.renderOverlay, color: mesh.overlayColor, alpha: mesh.overlayAlpha }));
      for (const entry of saved) { entry.mesh.overlayColor = new Color3(.9, .88, .75); entry.mesh.overlayAlpha = .2; entry.mesh.renderOverlay = true; }
      if (canvas) { cursor = canvas.style.cursor; canvas.style.cursor = "pointer"; }
    }
  };
  const inRange = (target: NativeMover, position: WorldPosition) => Math.abs(position.y - target.closedFootY) <= policy.verticalToleranceMetres &&
    target.distance(position) <= policy.interactionDistanceMetres;
  const activateTarget = (target: NativeMover) => {
    if (disposed || actor.paused()) return;
    const player = actor.player();
    if (!player || player.health <= 0 || target.root.isDisposed()) return;
    cancel();
    if (inRange(target, player.position)) {
      // Interaction replaces travel even when the player was walking elsewhere.
      if (actor.player()?.animation === "run") issue({ type: "set-animation", animation: "idle" });
      target.requestToggle(); return;
    }
    const near = target.nearest(player.position), dx = player.position.x - near.x, dz = player.position.z - near.z, length = Math.hypot(dx, dz);
    if (length < 1e-8 || Math.abs(player.position.y - target.closedFootY) > policy.verticalToleranceMetres) { onStatus("Move onto the same level as the door."); return; }
    const destination = navigation.destination({ x: near.x + dx / length * policy.approachStandOffMetres, y: near.y,
      z: near.z + dz / length * policy.approachStandOffMetres });
    // Existing navigation provides a direct reachable approach, not automatic
    // routing around walls. Never open remotely after a blocked walk.
    if (!destination || !inRange(target, destination) || navigation.move(player.position, destination).blocked) {
      onStatus("The door cannot be reached from here."); return;
    }
    pending = target;
    issue({ type: "move-local", position: destination });
    if (actor.player()?.animation !== "run") cancel(false);
  };
  const unsubscribe = actor.onCommand(command => {
    if (ownCommand || !pending) return;
    if (command.type === "move-local" || command.type === "set-animation" || command.type === "preview-action") cancel(false);
    else if (command.type === "teleport-local" || (command.type === "set-health" && command.entityId === "local-player" && command.health <= 0)) cancel();
  });
  const leave = () => hover(null);
  canvas?.addEventListener("pointerleave", leave);
  const observer = scene.onDisposeObservable.addOnce(() => dispose());
  function dispose() {
    if (disposed) return;
    cancel(); disposed = true; hover(null); unsubscribe(); canvas?.removeEventListener("pointerleave", leave); scene.onDisposeObservable.remove(observer);
  }
  const targeting: DoorTargeting = { hover, cancel,
    activate(mesh) { const target = mesh && byMesh.get(mesh); if (!target) return false; activateTarget(target); return true; } };
  return { targeting, dispose,
    /** The same guarded path is exposed for deterministic diagnostics. */
    activate(id: string) { const target = byId.get(id); if (!target) throw new Error("Unknown door target."); activateTarget(target); },
    update(seconds: number) {
      if (disposed) return;
      if (actor.paused()) { hover(null); return; }
      const player = actor.player();
      if (pending) {
        if (!player || player.health <= 0 || pending.root.isDisposed()) cancel();
        else if (inRange(pending, player.position)) {
          const target = pending; cancel(); target.requestToggle();
        } else if (player.animation !== "run") cancel(false);
      }
      for (const target of targets) target.advance(seconds, player ? { position: player.position, ...capsule } : undefined);
    },
    inspection: () => ({ policy: { ...policy }, pendingId: pending?.source.id ?? null, hoveredId: hovered?.source.id ?? null,
      movers: targets.map(target => target.inspection()), nativeServerVerified: false as const }),
  };
}
