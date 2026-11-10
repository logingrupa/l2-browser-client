import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { WorldGroundContact } from "../world/WorldNavigation";
import type { WorldPosition } from "../world/worldTypes";

const downward = new Vector3(0, -1, 0);

function carriesEntityIdentifier(mesh: AbstractMesh): boolean {
  const metadata: unknown = mesh.metadata;
  return typeof metadata === "object" && metadata !== null && "clientEntityId" in metadata;
}

const isSurfaceMesh = (mesh: AbstractMesh) => mesh.isPickable && mesh.isEnabled() && mesh.getTotalVertices() > 0 && !carriesEntityIdentifier(mesh);

export function sampleFootstepSurfaceContact(scene: Scene, feetPosition: WorldPosition | null, probeHalfLengthMetres: number): WorldGroundContact | null {
  if (feetPosition === null || scene.isDisposed || ![feetPosition.x, feetPosition.y, feetPosition.z].every(Number.isFinite)) return null;
  const ray = new Ray(new Vector3(feetPosition.x, feetPosition.y + probeHalfLengthMetres, feetPosition.z), downward, 2 * probeHalfLengthMetres);
  const picked = scene.pickWithRay(ray, isSurfaceMesh);
  if (!picked?.hit || !picked.pickedMesh || !picked.pickedPoint || picked.faceId < 0) return null;
  const position = { x: picked.pickedPoint.x, y: picked.pickedPoint.y, z: picked.pickedPoint.z };
  return { queryPosition: { x: feetPosition.x, y: feetPosition.y, z: feetPosition.z }, position, controllingSample: 0,
    samples: [{ meshId: picked.pickedMesh.id, meshUniqueId: picked.pickedMesh.uniqueId, meshName: picked.pickedMesh.name,
      indexOffset: picked.faceId * 3, triangleIndex: picked.faceId, position }] };
}
