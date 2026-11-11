import { sha256 } from "../package/readAssetPackage";
import { nativeResourceUrl } from "./nativeResourceUrl";

export async function fetchVerifiedNativeResource(url: string, hash: string, signal: AbortSignal, length?: number): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(nativeResourceUrl(url), { signal });
  if (!response.ok) throw new Error(`Native resource returned HTTP ${response.status}: ${url}`);
  const buffer = await response.arrayBuffer();
  signal.throwIfAborted();
  const bytes = new Uint8Array(buffer);
  if (length !== undefined && bytes.byteLength !== length || await sha256(bytes) !== hash) throw new Error(`Native resource hash/length mismatch: ${url}`);
  return bytes;
}
