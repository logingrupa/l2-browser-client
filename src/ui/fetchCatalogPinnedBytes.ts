import { nativeResourceUrl } from "../assets/native/nativeResourceUrl";
import { sha256 } from "../assets/package/readAssetPackage";

export async function fetchCatalogPinnedBytes(path: string, byteLength: number, expectedSha256: string, signal: AbortSignal,
  label: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(nativeResourceUrl(path), { signal });
  if (!response.ok) throw new Error(`${label} ${path} returned HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal.throwIfAborted();
  if (bytes.length !== byteLength || await sha256(bytes) !== expectedSha256) throw new Error(`${label} ${path} differs from its catalog length or SHA-256.`);
  return bytes;
}
