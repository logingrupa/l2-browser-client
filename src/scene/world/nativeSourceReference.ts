import type { Material } from "@babylonjs/core/Materials/material";
import { isPlainRecord } from "./nativeManifestRecordGuards";

const sourceReferenceExtrasField = "nativeSourceReference";

export function readNativeSourceReference(material: Material | null): string | null {
  const metadata: unknown = material?.metadata;
  const extras: unknown = isPlainRecord(metadata) && isPlainRecord(metadata.gltf) ? metadata.gltf.extras : undefined;
  const reference = isPlainRecord(extras) ? extras[sourceReferenceExtrasField] : undefined;
  return typeof reference === "string" && reference.trim() ? reference : null;
}
