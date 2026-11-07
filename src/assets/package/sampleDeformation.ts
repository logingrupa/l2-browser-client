import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AssetContainer } from "@babylonjs/core/assetContainer";

/** Read-only CPU skin evaluation from Babylon's current bone palettes. */
export function samplePackageDeformation(container: AssetContainer | undefined) {
  if (!container) return null;
  for (const node of container.transformNodes) node.computeWorldMatrix(true);
  for (const skeleton of container.skeletons) skeleton.prepare(true);
  const local = Vector3.Zero(), world = Vector3.Zero();
  const parts = [];
  let finite = true;
  for (const mesh of container.meshes) {
    if (!mesh.getTotalVertices()) continue;
    mesh.computeWorldMatrix(true);
    const values = mesh.getPositionData(true, true);
    if (!values) throw new Error(`No position data in ${mesh.name}.`);
    const minimum = new Vector3(Infinity, Infinity, Infinity), maximum = new Vector3(-Infinity, -Infinity, -Infinity);
    let checksum = 0;
    for (let index = 0; index < values.length; index += 3) {
      local.set(values[index]!, values[index + 1]!, values[index + 2]!);
      Vector3.TransformCoordinatesToRef(local, mesh.getWorldMatrix(), world);
      finite &&= Number.isFinite(world.x) && Number.isFinite(world.y) && Number.isFinite(world.z);
      minimum.minimizeInPlace(world); maximum.maximizeInPlace(world);
      checksum += world.x * (index + 1) + world.y * (index + 2) + world.z * (index + 3);
    }
    parts.push({ name: mesh.name, vertices: values.length / 3, minimum: minimum.asArray(), maximum: maximum.asArray(), checksum });
  }
  return { finite, parts };
}
