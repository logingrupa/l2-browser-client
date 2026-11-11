import type { Material } from "@babylonjs/core/Materials/material";

export const NATIVE_MATERIAL_PROGRAM_EXTRAS_FIELD = "nativeMaterialProgram";
const programSha256Pattern = /^[a-f0-9]{64}$/;

export function readNativeMaterialProgramPin(material: Material | null): string | null {
  const metadata: unknown = material?.metadata;
  const extras: unknown = typeof metadata === "object" && metadata !== null ? (metadata as { gltf?: { extras?: unknown } }).gltf?.extras : undefined;
  const value: unknown = typeof extras === "object" && extras !== null ? (extras as Record<string, unknown>)[NATIVE_MATERIAL_PROGRAM_EXTRAS_FIELD] : undefined;
  if (value === undefined || value === null) return null;
  const { directory, programSha256 } = typeof value === "object" ? value as Record<string, unknown> : { directory: undefined, programSha256: undefined };
  if (typeof programSha256 !== "string" || !programSha256Pattern.test(programSha256) || directory !== `native-materials/${programSha256}`) {
    throw new Error(`Material ${material?.name}: ${NATIVE_MATERIAL_PROGRAM_EXTRAS_FIELD} ${JSON.stringify(value)} is not a native-materials program pin.`);
  }
  return programSha256;
}
