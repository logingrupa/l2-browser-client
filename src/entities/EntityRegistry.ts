import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { WorldEntity, WorldEvent, WorldPosition } from "../world/worldTypes";
import { PositionInterpolator } from "../interpolation/PositionInterpolator";
import { createCharacterVisual, type CharacterVisual } from "../assets/CharacterVisual";
import { EntityLabel } from "../ui/EntityLabel";
import { projectPosition } from "../scene/projectPosition";

interface EntityPresentation {
  entity: WorldEntity;
  readonly visual: CharacterVisual;
  readonly label: EntityLabel;
  readonly interpolation: PositionInterpolator;
}

export interface EntityPresentationOptions {
  readonly scale?: number | ((entity: WorldEntity) => number);
  readonly ground?: (position: WorldPosition) => WorldPosition | null;
  readonly createVisual?: typeof createCharacterVisual;
}

export interface EntityPivotView {
  readonly entityId: string;
  readonly root: TransformNode;
  /** This exact visual generation must still belong to the registry. */
  isValid(): boolean;
  /** Presented actor pivot, including support clearance; never mesh bounds. */
  getWorldPositionToRef(out: Vector3): boolean;
}

export class EntityRegistry {
  private readonly entities = new Map<string, EntityPresentation>();
  private readonly selectionRing: Mesh;
  private readonly selectionMaterial: StandardMaterial;
  private readonly unsubscribe: () => void;
  private isDisposed = false;
  selectedEntityId: string | null = null;

  constructor(private readonly scene: Scene, adapter: GameWorldAdapter, private readonly labels: HTMLElement, private readonly onAssetStatus: (message: string) => void,
    private readonly options: EntityPresentationOptions = {}) {
    this.selectionMaterial = new StandardMaterial("Target indicator", scene);
    this.selectionMaterial.diffuseColor = Color3.FromHexString("#f6d884");
    this.selectionMaterial.emissiveColor = Color3.FromHexString("#b88c32");
    this.selectionRing = MeshBuilder.CreateTorus("Target selection", { diameter: 1.65, thickness: 0.065, tessellation: 48 }, scene);
    this.selectionRing.material = this.selectionMaterial;
    this.selectionRing.isPickable = false;
    this.selectionRing.setEnabled(false);
    this.unsubscribe = adapter.subscribe((event) => this.apply(event));
    adapter.getInitialState().forEach((entity) => this.spawn(entity));
  }

  get count(): number { return this.entities.size; }
  /** Await the current set, repeating if an entity is replaced while loading.
   * A removed visual's cancellation must not reject its replacement's startup. */
  async whenReady(): Promise<void> {
    for (;;) {
      if (this.isDisposed) throw new DOMException("Entity loading was cancelled.", "AbortError");
      const pending = [...this.entities.values()];
      await Promise.all(pending.map(presentation => presentation.visual.ready?.catch((error: unknown) => {
        if (this.entities.get(presentation.entity.id) === presentation) throw error;
      })));
      if (this.isDisposed) throw new DOMException("Entity loading was cancelled.", "AbortError");
      if (pending.length === this.entities.size && pending.every(presentation => this.entities.get(presentation.entity.id) === presentation)) return;
    }
  }
  get localPlayer(): WorldEntity | null {
    return [...this.entities.values()].find((presentation) => presentation.entity.kind === "local-player")?.entity ?? null;
  }
  get selectedEntity(): WorldEntity | null { return this.entities.get(this.selectedEntityId ?? "")?.entity ?? null; }
  get localPlayerPosition(): Vector3 | null {
    return [...this.entities.values()].find((presentation) => presentation.entity.kind === "local-player")?.visual.root.position ?? null;
  }

  /** Borrow an exact source-qualified attachment without enumerating scene
   * names, reparenting the rig or allocating the full diagnostic snapshot. */
  attachmentAnchor(entityId: string, anchorId: string) {
    return this.isDisposed ? null : this.entities.get(entityId)?.visual.attachmentAnchor?.(anchorId) ?? null;
  }

  /** No hierarchy, pose or material diagnostics are allocated for this clock. */
  sourceClock(entityId: string) {
    return this.isDisposed ? null : this.entities.get(entityId)?.visual.sourceClock?.() ?? null;
  }

  entity(entityId: string): WorldEntity | null {
    return this.isDisposed ? null : this.entities.get(entityId)?.entity ?? null;
  }

  /** Borrow the actor pivot without transferring node or entity ownership. */
  actorPivot(entityId: string): EntityPivotView | null {
    const owner = this.entities.get(entityId);
    if (this.isDisposed || !owner || owner.visual.root.isDisposed()) return null;
    const root = owner.visual.root;
    const isValid = () => !this.isDisposed && this.entities.get(entityId) === owner &&
      owner.visual.root === root && !root.isDisposed() && root.isEnabled();
    return { entityId, root, isValid,
      getWorldPositionToRef(out) {
        if (!isValid()) return false;
        root.computeWorldMatrix(true); out.copyFrom(root.getAbsolutePosition()); return true;
      } };
  }

  select(entityId: string | null): void {
    this.selectedEntityId = entityId && this.entities.has(entityId) ? entityId : null;
    this.entities.forEach((presentation, identifier) => presentation.label.select(identifier === this.selectedEntityId));
    this.selectionRing.setEnabled(this.selectedEntityId !== null);
  }

  private spawn(entity: WorldEntity): void {
    this.remove(entity.id);
    const visual = (this.options.createVisual ?? createCharacterVisual)(this.scene, entity, this.onAssetStatus);
    const scale = typeof this.options.scale === "function" ? this.options.scale(entity) : this.options.scale ?? 1;
    visual.root.scaling.setAll(scale);
    visual.root.position.set(entity.position.x, entity.position.y, entity.position.z);
    visual.root.rotation.y = entity.orientationRadians;
    this.entities.set(entity.id, {
      entity, visual,
      interpolation: new PositionInterpolator(entity.position),
      label: new EntityLabel(this.labels, entity, () => this.select(entity.id)),
    });
  }

  private apply(event: WorldEvent): void {
    if (event.type === "despawn") { this.remove(event.entityId); return; }
    if (event.type === "spawn") { this.spawn(event.entity); return; }
    const presentation = this.entities.get(event.entity.id);
    if (!presentation) return;
    if (presentation.entity.modelUrl !== event.entity.modelUrl || presentation.entity.appearanceId !== event.entity.appearanceId || presentation.entity.kind !== event.entity.kind) {
      const wasSelected = this.selectedEntityId === event.entity.id;
      this.spawn(event.entity);
      if (wasSelected) this.select(event.entity.id);
      return;
    }
    const shouldRetrigger = (presentation.entity.animationSequence ?? 0) !== (event.entity.animationSequence ?? 0);
    presentation.entity = event.entity;
    presentation.visual.setEntity?.(event.entity);
    presentation.interpolation.setTarget(event.entity.position, event.shouldSnap ?? false);
    const position = presentation.interpolation.position;
    presentation.visual.root.position.set(position.x, position.y, position.z);
    presentation.visual.animation.setState(event.entity.animation, shouldRetrigger);
    presentation.label.setState(event.entity);
  }

  private remove(entityId: string): void {
    const presentation = this.entities.get(entityId);
    if (!presentation) return;
    if (this.selectedEntityId === entityId) this.select(null);
    presentation.visual.dispose();
    presentation.label.dispose();
    this.entities.delete(entityId);
  }

  update(deltaTimeSeconds: number): void {
    this.entities.forEach((presentation) => {
      const interpolated = presentation.interpolation.update(deltaTimeSeconds);
      // Interpolation between supported endpoints can otherwise cut into stairs or slopes.
      const position = this.options.ground?.(interpolated) ?? interpolated;
      // Adapter positions are local support points. Place the native pivot above
      // that surface using its fixed profile/idle datum; source hierarchy stays intact.
      const clearance = this.options.ground ? (presentation.visual.groundClearance ?? 0) * presentation.visual.root.scaling.y : 0;
      presentation.visual.root.position.set(position.x, position.y + clearance, position.z);
      const difference = Math.atan2(Math.sin(presentation.entity.orientationRadians - presentation.visual.root.rotation.y), Math.cos(presentation.entity.orientationRadians - presentation.visual.root.rotation.y));
      presentation.visual.root.rotation.y += difference * (1 - Math.exp(-12 * deltaTimeSeconds));
      presentation.visual.animation.update(deltaTimeSeconds);
      presentation.label.update(this.scene, presentation.visual.root.position, presentation.visual.bounds.labelHeight * presentation.visual.root.scaling.y);
    });
    const selected = this.entities.get(this.selectedEntityId ?? "");
    if (selected) {
      const visualScale = selected.visual.root.scaling.y;
      const bounds = selected.visual.bounds;
      const ringHeight = bounds.minimum.y + Math.min(.07, Math.max(.005, (bounds.maximum.y - bounds.minimum.y) * .03));
      this.selectionRing.position.copyFrom(selected.visual.root.position).addInPlaceFromFloats(0, ringHeight * visualScale, 0);
      const scale = selected.visual.bounds.selectionRadius / 0.825 * visualScale;
      this.selectionRing.scaling.set(scale, visualScale, scale);
    }
  }

  snapshot() {
    return [...this.entities.values()].map(({ entity, visual }) => {
      const bodyPosition = visual.root.position.add(new Vector3(0, visual.bounds.pickingHeight * visual.root.scaling.y, 0));
      const projected = projectPosition(this.scene, bodyPosition);
      return {
        id: entity.id, position: { x: visual.root.position.x, y: visual.root.position.y, z: visual.root.position.z },
        groundClearance: this.options.ground ? (visual.groundClearance ?? 0) * visual.root.scaling.y : 0,
        authoritativePosition: { ...entity.position }, animation: visual.animation.state,
        locomotion: entity.locomotion ?? "run",
        actionPreview: entity.actionPreview ?? null,
        actionTargetId: entity.actionTargetId ?? null,
        orientationRadians: visual.root.rotation.y, authoritativeOrientationRadians: entity.orientationRadians,
        forwardDirection: visual.forwardDirection?.asArray() ?? null,
        isFallback: visual.isFallback, screenPosition: { x: projected.x, y: projected.y },
        modelId: visual.modelId, playback: visual.animation.playback, animationSequence: entity.animationSequence ?? 0,
        attachments: visual.attachmentSnapshot?.() ?? [],
        bounds: { minimum: visual.bounds.minimum.asArray(), maximum: visual.bounds.maximum.asArray(), labelHeight: visual.bounds.labelHeight, selectionRadius: visual.bounds.selectionRadius },
        skeletons: [...new Set(visual.root.getChildMeshes().flatMap(mesh => mesh.skeleton ? [mesh.skeleton] : []))].map(skeleton => ({ name: skeleton.name, bones: skeleton.bones.length })),
        parts: visual.root.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0).map(mesh => ({ name: mesh.name, enabled: mesh.isEnabled(), vertices: mesh.getTotalVertices(), material: mesh.material?.name ?? null })),
        meshCount: visual.root.getChildMeshes().length,
        pose: visual.root.getDescendants().map((node) => node instanceof TransformNode ? (node.rotationQuaternion?.asArray() ?? node.rotation.asArray()) : []),
      };
    });
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.unsubscribe();
    [...this.entities.keys()].forEach((identifier) => this.remove(identifier));
    this.selectionRing.dispose();
    this.selectionMaterial.dispose();
  }
}
