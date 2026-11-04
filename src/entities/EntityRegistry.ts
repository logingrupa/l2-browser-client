import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { WorldEntity, WorldEvent } from "../world/worldTypes";
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

export class EntityRegistry {
  private readonly entities = new Map<string, EntityPresentation>();
  private readonly selectionRing: Mesh;
  private readonly selectionMaterial: StandardMaterial;
  private readonly unsubscribe: () => void;
  selectedEntityId: string | null = null;

  constructor(private readonly scene: Scene, adapter: GameWorldAdapter, private readonly labels: HTMLElement, private readonly onAssetStatus: (message: string) => void) {
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
  get localPlayer(): WorldEntity | null {
    return [...this.entities.values()].find((presentation) => presentation.entity.kind === "local-player")?.entity ?? null;
  }
  get selectedEntity(): WorldEntity | null { return this.entities.get(this.selectedEntityId ?? "")?.entity ?? null; }
  get localPlayerPosition(): Vector3 | null {
    return [...this.entities.values()].find((presentation) => presentation.entity.kind === "local-player")?.visual.root.position ?? null;
  }

  select(entityId: string | null): void {
    this.selectedEntityId = entityId && this.entities.has(entityId) ? entityId : null;
    this.entities.forEach((presentation, identifier) => presentation.label.select(identifier === this.selectedEntityId));
    this.selectionRing.setEnabled(this.selectedEntityId !== null);
  }

  private spawn(entity: WorldEntity): void {
    this.remove(entity.id);
    const visual = createCharacterVisual(this.scene, entity, this.onAssetStatus);
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
    if (presentation.entity.modelUrl !== event.entity.modelUrl || presentation.entity.kind !== event.entity.kind) {
      const wasSelected = this.selectedEntityId === event.entity.id;
      this.spawn(event.entity);
      if (wasSelected) this.select(event.entity.id);
      return;
    }
    presentation.entity = event.entity;
    presentation.interpolation.setTarget(event.entity.position, event.shouldSnap ?? false);
    const position = presentation.interpolation.position;
    presentation.visual.root.position.set(position.x, position.y, position.z);
    presentation.visual.animation.setState(event.entity.animation);
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
      const position = presentation.interpolation.update(deltaTimeSeconds);
      presentation.visual.root.position.set(position.x, position.y, position.z);
      const difference = Math.atan2(Math.sin(presentation.entity.orientationRadians - presentation.visual.root.rotation.y), Math.cos(presentation.entity.orientationRadians - presentation.visual.root.rotation.y));
      presentation.visual.root.rotation.y += difference * (1 - Math.exp(-12 * deltaTimeSeconds));
      presentation.visual.animation.update(deltaTimeSeconds);
      presentation.label.update(this.scene, presentation.visual.root.position);
    });
    const selected = this.entities.get(this.selectedEntityId ?? "");
    if (selected) this.selectionRing.position.copyFrom(selected.visual.root.position).addInPlaceFromFloats(0, 0.07, 0);
  }

  snapshot() {
    return [...this.entities.values()].map(({ entity, visual }) => {
      const bodyPosition = visual.root.position.add(new Vector3(0, 1, 0));
      const projected = projectPosition(this.scene, bodyPosition);
      return {
        id: entity.id, position: { x: visual.root.position.x, y: visual.root.position.y, z: visual.root.position.z },
        authoritativePosition: { ...entity.position }, animation: visual.animation.state,
        isFallback: visual.isFallback, screenPosition: { x: projected.x, y: projected.y },
        meshCount: visual.root.getChildMeshes().length,
        pose: visual.root.getDescendants().map((node) => "rotation" in node && node.rotation instanceof Vector3 ? node.rotation.asArray() : []),
      };
    });
  }

  dispose(): void {
    this.unsubscribe();
    [...this.entities.keys()].forEach((identifier) => this.remove(identifier));
    this.selectionRing.dispose();
    this.selectionMaterial.dispose();
  }
}
