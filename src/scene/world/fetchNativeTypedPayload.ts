import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { decodeNativeJsonResource } from "./loadNativeSection";

export interface NativeTypedPayloadFiles {
  readonly assetJson: unknown;
  readonly payloadBytes: Uint8Array;
}

interface TypedPayloadPin {
  readonly sha256: string;
  readonly bytes: number;
}

const typedPayloadAssetName = "asset.json";
const typedPayloadFileName = "payload.bin";
const sha256Pattern = /^[a-f0-9]{64}$/;
const maximumTypedPayloadBytes = 128 * 1024 * 1024;

function readTypedPayloadPin(assetJson: unknown, label: string): TypedPayloadPin {
  const pin = typeof assetJson === "object" && assetJson !== null ? (assetJson as Record<string, unknown>).payload : undefined;
  if (typeof pin !== "object" || pin === null) throw new Error(`${label} has no payload pin.`);
  const { file, sha256, bytes } = pin as Record<string, unknown>;
  if (file !== typedPayloadFileName || typeof sha256 !== "string" || !sha256Pattern.test(sha256) || typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximumTypedPayloadBytes) {
    throw new Error(`${label} payload pin must name ${typedPayloadFileName} with its SHA-256 and a byte count.`);
  }
  return { sha256, bytes };
}

export async function fetchNativeTypedPayloadFiles(resource: string, sha256: string, signal: AbortSignal, resourceLabel: string, bytes?: number):
  Promise<NativeTypedPayloadFiles> {
  const label = `${resourceLabel} ${resource}`;
  if (!resource.endsWith(`/${typedPayloadAssetName}`)) throw new Error(`${label} is not a typed payload ${typedPayloadAssetName}.`);
  const assetJson = decodeNativeJsonResource(await fetchVerifiedNativeResource(resource, sha256, signal, bytes), label);
  const pin = readTypedPayloadPin(assetJson, label);
  const payloadPath = `${resource.slice(0, -typedPayloadAssetName.length)}${typedPayloadFileName}`;
  const payloadBytes = await fetchVerifiedNativeResource(payloadPath, pin.sha256, signal, pin.bytes);
  return { assetJson, payloadBytes };
}
