import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { CharacterJoints } from "../animation/ProceduralAnimator";
import type { WorldEntity } from "../world/worldTypes";

export interface ProceduralCharacter {
  readonly root: TransformNode;
  readonly joints: CharacterJoints;
  dispose(): void;
}

export function createProceduralCharacter(scene: Scene, entity: WorldEntity): ProceduralCharacter {
  let isDisposed = false;
  const root = new TransformNode(`${entity.id}:placeholder`, scene);
  const body = new TransformNode(`${entity.id}:pose`, scene);
  body.parent = root;
  const isMonster = entity.kind === "monster";
  const armorColor = isMonster ? "#AF795B" : entity.kind === "local-player" ? "#54B8AD" : "#6B8BB8";
  const materials: StandardMaterial[] = [];
  const material = (name: string, color: string, isEmissive = false): StandardMaterial => {
    const created = new StandardMaterial(`${entity.id}:${name}`, scene);
    created.diffuseColor = Color3.FromHexString(color);
    created.specularColor = new Color3(0.12, 0.12, 0.12);
    if (isEmissive) created.emissiveColor = Color3.FromHexString(color).scale(0.65);
    materials.push(created);
    return created;
  };
  const armor = material("armor", armorColor);
  const undercoat = material("undercoat", isMonster ? "#57483E" : "#233940");
  const trim = material("trim", isMonster ? "#D8B57B" : "#D6D4B5");
  const visor = material("visor", isMonster ? "#F2BC72" : "#ACE5DB", true);

  const attach = (mesh: Mesh, parent: TransformNode, surface: StandardMaterial): Mesh => {
    mesh.parent = parent;
    mesh.material = surface;
    mesh.isPickable = true;
    mesh.metadata = { entityId: entity.id };
    mesh.receiveShadows = true;
    return mesh;
  };
  const box = (
    name: string, width: number, height: number, depth: number,
    parent: TransformNode, surface: StandardMaterial,
    positionX: number, positionY: number, positionZ = 0,
  ): Mesh => {
    const mesh = attach(CreateBox(`${entity.id}:${name}`, { width, height, depth }, scene), parent, surface);
    mesh.position.set(positionX, positionY, positionZ);
    return mesh;
  };

  const torso = attach(CreateCylinder(`${entity.id}:torso`, {
    height: 0.58, diameterTop: isMonster ? 0.78 : 0.69,
    diameterBottom: 0.45, tessellation: 6,
  }, scene), body, armor);
  torso.position.y = 1.07;
  torso.rotation.y = Math.PI / 6;
  box("belt", 0.48, 0.12, 0.35, body, trim, 0, 0.78);
  box("crest", 0.14, 0.22, 0.04, body, trim, 0, 1.17, 0.33);
  const head = attach(CreateCylinder(`${entity.id}:head`, {
    height: 0.4, diameterTop: 0.32, diameterBottom: 0.4, tessellation: 6,
  }, scene), body, armor);
  head.position.y = 1.6;
  head.rotation.y = Math.PI / 6;
  box("visor", 0.28, 0.065, 0.05, body, visor, 0, 1.62, 0.18);
  box("collar", 0.34, 0.10, 0.30, body, undercoat, 0, 1.37);

  const limb = (name: string, positionX: number, positionY: number): TransformNode => {
    const joint = new TransformNode(`${entity.id}:${name}`, scene);
    joint.parent = body;
    joint.position.set(positionX, positionY, 0);
    return joint;
  };
  const leftArm = limb("left-arm", -0.4, 1.27);
  const rightArm = limb("right-arm", 0.4, 1.27);
  for (const [name, arm] of [["left", leftArm], ["right", rightArm]] as const) {
    box(`${name}-shoulder`, 0.28, 0.23, 0.35, arm, armor, 0, 0);
    box(`${name}-sleeve`, 0.17, 0.35, 0.19, arm, undercoat, 0, -0.25);
    box(`${name}-glove`, 0.22, 0.22, 0.25, arm, trim, 0, -0.47);
  }
  const leftLeg = limb("left-leg", -0.16, 0.68);
  const rightLeg = limb("right-leg", 0.16, 0.68);
  for (const [name, leg] of [["left", leftLeg], ["right", rightLeg]] as const) {
    box(`${name}-leg`, 0.22, 0.43, 0.24, leg, undercoat, 0, -0.22);
    box(`${name}-shin`, 0.24, 0.24, 0.26, leg, armor, 0, -0.43);
    box(`${name}-boot`, 0.25, 0.16, 0.39, leg, undercoat, 0, -0.58, 0.06);
  }
  if (!isMonster) {
    box("blade", 0.07, 0.62, 0.06, rightArm, trim, 0, -0.79, 0.13);
    box("guard", 0.24, 0.06, 0.09, rightArm, armor, 0, -0.55, 0.13);
  }

  return {
    root,
    joints: { body, leftArm, rightArm, leftLeg, rightLeg },
    dispose: () => {
      if (isDisposed) return;
      isDisposed = true;
      root.dispose();
      for (const ownedMaterial of materials) ownedMaterial.dispose();
    },
  };
}
