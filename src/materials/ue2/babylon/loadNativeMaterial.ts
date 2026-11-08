import { nativeResourceUrl } from "../../../assets/native/nativeResourceUrl";
import { sha256 } from "../../../assets/package/readAssetPackage";
import { decodeNativePreviewPng, type NativePreviewPixels } from "../../../scene/world/nativeTerrainPreview";
import { parseMaterialProgram, type MaterialProgram, type MaterialTextureImage } from "../model/materialProgram";
import { compileMaterialStagePlan, type MaterialStagePlan } from "../model/stagePlan";

export interface LoadedNativeMaterial {
  readonly materialId: string;
  readonly program: MaterialProgram;
  readonly plan: MaterialStagePlan;
  readonly texturePixels: ReadonlyMap<string, NativePreviewPixels>;
}

export class NativeMaterialLoadError extends Error {
  override readonly name = "NativeMaterialLoadError";
}

const materialIdPattern = /^[a-f0-9]{64}$/;
const maximumProgramBytes = 4 * 1024 * 1024;

export function nativeMaterialProgramPath(materialId: string): string {
  if (!materialIdPattern.test(materialId)) throw new NativeMaterialLoadError(`Native material id ${JSON.stringify(materialId)} is not a program SHA-256.`);
  return `/l2/native-materials/${materialId}/program.json`;
}

async function fetchPinnedBytes(path: string, expectedSha256: string, maximumBytes: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const answer = await fetch(nativeResourceUrl(path), { signal });
  if (!answer.ok) throw new NativeMaterialLoadError(`Native material resource ${path} answered ${answer.status}.`);
  const bytes = new Uint8Array(await answer.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maximumBytes) throw new NativeMaterialLoadError(`Native material resource ${path} holds ${bytes.length} bytes, outside 1 to ${maximumBytes}.`);
  if (await sha256(bytes) !== expectedSha256) throw new NativeMaterialLoadError(`Native material resource ${path} differs from its SHA-256 ${expectedSha256}.`);
  return bytes;
}

async function loadTextureImage(image: MaterialTextureImage, signal: AbortSignal): Promise<NativePreviewPixels> {
  const bytes = await fetchPinnedBytes(image.path, image.sha256, image.bytes, signal);
  if (bytes.length !== image.bytes) throw new NativeMaterialLoadError(`Native texture ${image.path} holds ${bytes.length} bytes, not ${image.bytes}.`);
  return decodeNativePreviewPng(bytes, signal);
}

export async function loadNativeMaterial(materialId: string, signal: AbortSignal): Promise<LoadedNativeMaterial> {
  const programBytes = await fetchPinnedBytes(nativeMaterialProgramPath(materialId), materialId, maximumProgramBytes, signal);
  const program = parseMaterialProgram(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(programBytes)));
  const plan = compileMaterialStagePlan(program);
  const texturePixels = new Map<string, NativePreviewPixels>();
  if (plan.status === "compiled") {
    for (const image of plan.samplers.flatMap(sampler => sampler.frameImages)) {
      if (!texturePixels.has(image.sha256)) texturePixels.set(image.sha256, await loadTextureImage(image, signal));
    }
  }
  signal.throwIfAborted();
  return { materialId, program, plan, texturePixels };
}
