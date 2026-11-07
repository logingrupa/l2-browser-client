import { readAssetPackage, sha256, type AssetPackageManifest } from "../../src/assets/package/readAssetPackage";
import { storedPackage } from "./assetPackageFixture";

export const nativeVisualClips = { idle: "Native_Wait", run: "Native_Run", attack: "Native_Attack", death: "Native_Death" } as const;

/** Original embedded geometry with optional independent rigs and vertical keys.
 * The default keeps the simple mesh-node clips used by presentation tests. */
export async function nativeVisualFixture(options: {
  material?: string; parts?: string[]; omitDeath?: boolean; height?: number; minimumY?: number; skinned?: boolean;
  verticalMotion?: Partial<Record<keyof typeof nativeVisualClips, readonly [number, number]>>;
  nativeParentTranslation?: readonly [number, number, number];
} = {}) {
  const parts = options.parts ?? ["Upper", "Lower"], material = options.material ?? "base", height = options.height ?? 2;
  const minimumY = options.minimumY ?? 0, maximumY = minimumY + height;
  const bytes: number[] = [], bufferViews: Record<string, unknown>[] = [], accessors: Record<string, unknown>[] = [];
  function accessor(values: Float32Array | Uint16Array, type: string, width: number, extra: Record<string, unknown> = {}) {
    while (bytes.length % 4) bytes.push(0);
    const bufferView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: bytes.length, byteLength: values.byteLength });
    bytes.push(...new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
    accessors.push({ bufferView, componentType: values instanceof Float32Array ? 5126 : 5123, type, count: values.length / width, ...extra });
    return accessors.length - 1;
  }
  const position = accessor(new Float32Array([-.5, minimumY, 0, .5, minimumY, 0, 0, maximumY, 0]), "VEC3", 3,
    { min: [-.5, minimumY, 0], max: [.5, maximumY, 0] });
  const times = accessor(new Float32Array([0, 1]), "SCALAR", 1, { min: [0], max: [1] });
  const skinAttributes = options.skinned ? {
    JOINTS_0: accessor(new Uint16Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), "VEC4", 4),
    WEIGHTS_0: accessor(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), "VEC4", 4),
  } : {};
  const nodes: Record<string, unknown>[] = [], roots: number[] = [], targets: number[] = [], skins: Record<string, unknown>[] = [];
  for (const [mesh, name] of parts.entries()) {
    const node = nodes.length;
    nodes.push({ name, mesh, ...options.skinned ? { skin: mesh } : {} }); roots.push(node);
    if (options.skinned) {
      nodes.push({ name: "NativeRoot", children: [node + 2] }, { name: "NativeBone" });
      roots.push(node + 1); targets.push(node + 2); skins.push({ joints: [node + 1, node + 2], skeleton: node + 1 });
    } else targets.push(node);
  }
  const animations = (Object.entries(nativeVisualClips) as [keyof typeof nativeVisualClips, string][])
    .filter(([state]) => !(state === "death" && options.omitDeath)).map(([state, name]) => {
      const vertical = options.verticalMotion?.[state];
      const output = accessor(new Float32Array(vertical ? [0, vertical[0], 0, 0, vertical[1], 0] : [0, 0, 0, 0, .1, 0]), "VEC3", 3);
      return { name, extras: { nativeDurationSeconds: 2 }, samplers: [{ input: times, output, interpolation: "LINEAR" }],
        channels: targets.map(node => ({ sampler: 0, target: { node, path: "translation" } })) };
    });
  const binary = new Uint8Array(bytes);
  if (options.nativeParentTranslation) {
    const parent = nodes.length;
    nodes.push({ name: "NativeMeshTransform", translation: options.nativeParentTranslation, children: roots.slice() });
    roots.splice(0, roots.length, parent);
  }
  const document = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: roots }], nodes, ...options.skinned ? { skins } : {},
    meshes: parts.map((name, index) => ({ name, primitives: [{ material: index, attributes: { POSITION: position, ...skinAttributes } }] })),
    materials: parts.map(part => ({ name: `${material}:${part}`, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 } })),
    buffers: [{ byteLength: binary.byteLength }], bufferViews, accessors, animations,
  };
  const json = new TextEncoder().encode(JSON.stringify(document)), padded = Math.ceil(json.length / 4) * 4;
  const glb = new Uint8Array(28 + padded + binary.byteLength), view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, glb.length, true);
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true); glb.fill(32, 20, 20 + padded); glb.set(json, 20);
  view.setUint32(20 + padded, binary.byteLength, true); view.setUint32(24 + padded, 0x004e4942, true); glb.set(new Uint8Array(binary.buffer), 28 + padded);
  const sourceObject = parts.length === 1 ? `Fixture.${parts[0]}` : "Fixture.Assembly";
  const manifest: AssetPackageManifest = { schemaVersion: 1, id: `fixture:${material}`, name: material, kind: "model",
    source: { edition: "interlude", package: "Fixture", object: sourceObject, sha256: "a".repeat(64),
      ...parts.length > 1 ? { assembly: parts.map(part => `Fixture.${part}`) } : {} },
    model: { file: "model.glb", unit: "metre", sourceUnitsPerMetre: 100, sourceToGltf: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    files: [{ path: "model.glb", bytes: glb.length, sha256: await sha256(glb), mime: "model/gltf-binary" }],
    limitations: ["Original synthetic test geometry."],
  };
  return readAssetPackage(storedPackage([{ name: "asset.json", bytes: new TextEncoder().encode(JSON.stringify(manifest)) }, { name: "model.glb", bytes: glb }]));
}
