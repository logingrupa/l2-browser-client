import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { WorldEntity } from "../world/worldTypes";
import { projectPosition } from "../scene/projectPosition";
import { getWorldCanvas } from "../scene/getWorldCanvas";

export class EntityLabel {
  readonly element = document.createElement("button");
  private readonly name = document.createElement("span");
  private readonly health = document.createElement("span");
  private readonly fill = document.createElement("span");
  private readonly diagnostic = document.createElement("span");

  constructor(container: HTMLElement, entity: WorldEntity, onSelect: () => void) {
    this.element.type = "button";
    this.element.className = "entity-label";
    this.element.dataset.entityId = entity.id;
    this.element.dataset.kind = entity.kind;
    this.health.className = "entity-health";
    this.fill.className = "entity-health-fill";
    this.health.append(this.fill);
    this.diagnostic.className = "entity-diagnostic";
    this.diagnostic.hidden = true;
    this.element.append(this.name, this.health, this.diagnostic);
    this.element.addEventListener("click", onSelect);
    container.append(this.element);
    this.setState(entity);
  }

  setState(entity: WorldEntity): void {
    this.name.textContent = entity.displayName;
    this.element.setAttribute("aria-label", `Select ${entity.displayName}`);
    this.element.dataset.animation = entity.animation;
    this.element.dataset.health = String(entity.health);
    const fraction = entity.maximumHealth > 0 ? Math.max(0, Math.min(1, entity.health / entity.maximumHealth)) : 0;
    this.fill.style.transform = `scaleX(${fraction})`;
    this.health.setAttribute("role", "meter");
    this.health.setAttribute("aria-label", `${entity.displayName} health`);
    this.health.setAttribute("aria-valuemin", "0");
    this.health.setAttribute("aria-valuemax", String(entity.maximumHealth));
    this.health.setAttribute("aria-valuenow", String(entity.health));
  }

  update(scene: Scene, position: Vector3, height = 2.25): void {
    const camera = scene.activeCamera;
    if (!camera) return;
    const engine = scene.getEngine();
    const canvas = getWorldCanvas(engine);
    if (!canvas) return;
    const projected = projectPosition(scene, position.add(new Vector3(0, height, 0)));
    this.element.hidden = projected.z < 0 || projected.z > 1 || projected.x < 0 || projected.x > canvas.clientWidth || projected.y < 0 || projected.y > canvas.clientHeight;
    this.element.style.left = `${projected.x}px`;
    this.element.style.top = `${projected.y}px`;
    this.element.dataset.visualX = position.x.toFixed(4);
    this.element.dataset.visualZ = position.z.toFixed(4);
  }

  setDiagnostic(text: string | null): void {
    this.diagnostic.textContent = text ?? "";
    this.diagnostic.hidden = text === null;
  }

  select(isSelected: boolean): void { this.element.setAttribute("aria-pressed", String(isSelected)); }
  dispose(): void { this.element.remove(); }
}
