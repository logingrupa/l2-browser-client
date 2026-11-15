import type { AssetPackage } from "../package/readAssetPackage";

export interface NativeGlbBoneIdentity {
  readonly gltfMeshPointer: string;
  readonly gltfMeshNodePointer: string;
  readonly gltfSkinPointer: string;
  readonly gltfNodePointer: string;
  readonly jointIndex: number;
}

interface GlbJsonDocument {
  readonly meshes?: { name?: string }[];
  readonly nodes?: { name?: string; mesh?: number; skin?: number }[];
  readonly skins?: { joints?: number[] }[];
}

const glbJsonChunkLengthOffset = 12;
const glbJsonChunkDataOffset = 20;

function readGlbJsonDocument(asset: AssetPackage): GlbJsonDocument {
  const modelFile = asset.manifest.model?.file;
  const bytes = modelFile === undefined ? undefined : asset.files.get(modelFile);
  if (!bytes) throw new Error("Native model bytes are missing.");
  const jsonSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(glbJsonChunkLengthOffset, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(glbJsonChunkDataOffset, glbJsonChunkDataOffset + jsonSize))) as GlbJsonDocument;
}

export function readRetainedGlbBoneIdentity(asset: AssetPackage, sourceObject: string, boneName: string): NativeGlbBoneIdentity {
  const document = readGlbJsonDocument(asset);
  const name = sourceObject.split(".").at(-1);
  const meshes = document.meshes?.flatMap((mesh, index) => mesh.name === name ? [index] : []) ?? [];
  if (meshes.length !== 1 || !Array.isArray(document.nodes) || !Array.isArray(document.skins)) throw new Error("Native bone source mesh or skin identity is missing or ambiguous.");
  const meshIndex = meshes[0]!;
  const nodes = document.nodes.flatMap((node, index) => node.mesh === meshIndex ? [index] : []);
  if (nodes.length !== 1) throw new Error("Native bone source mesh node identity is missing or ambiguous.");
  const meshNodeIndex = nodes[0]!, skinIndex = document.nodes[meshNodeIndex]!.skin;
  const joints = typeof skinIndex === "number" && Number.isInteger(skinIndex) && skinIndex >= 0 ? document.skins[skinIndex]?.joints : undefined;
  if (!Array.isArray(joints) || joints.some(index => !Number.isInteger(index) || index < 0 || !document.nodes![index]) || new Set(joints).size !== joints.length) {
    throw new Error("Native bone source skin joints are missing or ambiguous.");
  }
  const matches = joints.flatMap((nodeIndex, index) => document.nodes![nodeIndex]!.name === boneName ? [{ nodeIndex, index }] : []);
  if (matches.length !== 1) throw new Error("Native bone name is missing or ambiguous in the source skin.");
  return { gltfMeshPointer: `/meshes/${meshIndex}`, gltfMeshNodePointer: `/nodes/${meshNodeIndex}`,
    gltfSkinPointer: `/skins/${skinIndex}`, gltfNodePointer: `/nodes/${matches[0]!.nodeIndex}`, jointIndex: matches[0]!.index };
}
