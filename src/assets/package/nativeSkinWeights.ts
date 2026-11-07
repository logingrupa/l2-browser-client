import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { GLTF2 } from "@babylonjs/loaders/glTF";
import type { IAccessor } from "@babylonjs/loaders/glTF/2.0/glTFLoaderInterfaces";

const weightsAttribute = "_L2_NATIVE_WEIGHTS", jointsAttribute = "_L2_NATIVE_JOINTS";

function nativeAccessor(accessor: IAccessor | undefined, components: readonly number[], context: string): IAccessor {
  if (!accessor || accessor.type !== "VEC4" || !components.includes(accessor.componentType) || accessor.normalized ||
    !Number.isSafeInteger(accessor.count) || accessor.count <= 0) throw new Error(`${context}: invalid native skin accessor.`);
  return accessor;
}

/** The portable glTF skin may use a standards-compatible derivative. Native
 * float weights (including repeated joint entries) remain independent custom
 * attributes. Apply them before the loader resolves, without normalizing them.
 * The primitive mapping uses Babylon 9.27.1's pinned glTF loader contract.
 * Editor rewrites loader imports to its UMD root, which exposes the registry
 * through GLTF2; the same namespace is available in the browser ESM package. */
GLTF2.registerGLTFExtension("L2NativeSkinWeights", false, loader => ({
  name: "L2NativeSkinWeights",
  enabled: true,
  dispose() {},
  loadNodeAsync(context, node, assign) {
    const source = node.mesh === undefined ? undefined : loader.gltf.meshes?.[node.mesh];
    if (!source?.primitives.some(primitive => primitive.attributes[weightsAttribute] !== undefined || primitive.attributes[jointsAttribute] !== undefined)) return null;
    const skin = node.skin === undefined ? undefined : loader.gltf.skins?.[node.skin];
    if (!skin) throw new Error(`${context}: native skin attributes require a skin.`);
    return loader.loadNodeAsync(context, node, assign).then(async result => {
      for (const [index, primitive] of source.primitives.entries()) {
        const weightIndex = primitive.attributes[weightsAttribute], jointIndex = primitive.attributes[jointsAttribute];
        if (weightIndex === undefined && jointIndex === undefined) continue;
        const mesh = node._primitiveBabylonMeshes?.[index];
        if (!(mesh instanceof Mesh)) throw new Error(`${context}: native primitive mapping is unavailable.`);
        const weightAccessor = nativeAccessor(loader.gltf.accessors?.[weightIndex ?? -1], [5126], context);
        const jointAccessor = nativeAccessor(loader.gltf.accessors?.[jointIndex ?? -1], [5121, 5123, 5126], context);
        if (weightAccessor.count !== mesh.getTotalVertices() || jointAccessor.count !== weightAccessor.count) throw new Error(`${context}: native skin vertex count differs.`);
        const [weights, joints] = await Promise.all([
          loader._loadFloatAccessorAsync(`/accessors/${weightIndex}`, weightAccessor),
          loader._loadFloatAccessorAsync(`/accessors/${jointIndex}`, jointAccessor),
        ]);
        let minSum = Infinity, maxSum = -Infinity;
        for (let vertex = 0; vertex < weightAccessor.count; vertex++) {
          let sum = 0;
          for (let component = 0; component < 4; component++) {
            const offset = vertex * 4 + component, weight = weights[offset]!, joint = joints[offset]!;
            if (!Number.isFinite(weight) || weight < 0 || weight > 1 || !Number.isInteger(joint) || joint < 0 || joint >= skin.joints.length) {
              throw new Error(`${context}: native skin has an invalid weight or joint.`);
            }
            sum += weight;
          }
          if (sum <= 0) throw new Error(`${context}: native skin has a vertex with no influence.`);
          minSum = Math.min(minSum, sum); maxSum = Math.max(maxSum, sum);
        }
        mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, weights.slice(), false, 4);
        mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, joints.slice(), false, 4);
        mesh.numBoneInfluencers = 4;
        mesh.metadata = { ...mesh.metadata, l2NativeSkinWeights: {
          applied: true, vertices: weightAccessor.count, normalized: false, minSum, maxSum,
        } };
      }
      return result;
    });
  },
}));
