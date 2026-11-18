import { nativeResourceUrl } from "../../../assets/native/nativeResourceUrl";
import { sha256 } from "../../../assets/package/readAssetPackage";
import { decodeNativeStorePng, type NativeStorePngPixels } from "../../../assets/native/decodeNativeStorePng";
import { parseMaterialProgram, type MaterialProgram, type MaterialTextureImage } from "../model/materialProgram";
import { compileMaterialStagePlan, type MaterialStagePlan, type MaterialTextureSize } from "../model/stagePlan";
import type { TextureMipChainFormat, TextureMipChainPin } from "../model/textureMipChain";

export interface LoadedTextureMipLevel {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array<ArrayBuffer>;
}

export interface LoadedTextureMipChain {
  readonly format: TextureMipChainFormat;
  readonly levels: readonly LoadedTextureMipLevel[];
}

export interface LoadedNativeMaterial {
  readonly materialId: string;
  readonly program: MaterialProgram;
  readonly plan: MaterialStagePlan;
  readonly texturePixels: ReadonlyMap<string, NativeStorePngPixels>;
  readonly textureMipChains: ReadonlyMap<string, LoadedTextureMipChain>;
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

async function loadTextureImage(image: MaterialTextureImage, signal: AbortSignal): Promise<NativeStorePngPixels> {
  const bytes = await fetchPinnedBytes(image.path, image.sha256, image.bytes, signal);
  if (bytes.length !== image.bytes) throw new NativeMaterialLoadError(`Native texture ${image.path} holds ${bytes.length} bytes, not ${image.bytes}.`);
  return decodeNativeStorePng(bytes, signal);
}

async function loadTextureMipChain(chain: TextureMipChainPin, frameNode: string, size: MaterialTextureSize, signal: AbortSignal): Promise<LoadedTextureMipChain> {
  const [firstLevel] = chain.levels;
  if (firstLevel?.width !== size.width || firstLevel.height !== size.height) {
    throw new NativeMaterialLoadError(`Native texture ${frameNode} mip chain starts at ${firstLevel?.width} x ${firstLevel?.height}, not its Engine.Texture USize x VSize ${size.width} x ${size.height}.`);
  }
  const levels: LoadedTextureMipLevel[] = [];
  for (const level of chain.levels) {
    const data = await fetchPinnedBytes(level.path, level.sha256, level.bytes, signal);
    if (data.length !== level.bytes) throw new NativeMaterialLoadError(`Native texture mip level ${level.path} holds ${data.length} bytes, not ${level.bytes}.`);
    levels.push({ width: level.width, height: level.height, data });
  }
  return { format: chain.format, levels };
}

export async function loadNativeMaterial(materialId: string, signal: AbortSignal): Promise<LoadedNativeMaterial> {
  const programBytes = await fetchPinnedBytes(nativeMaterialProgramPath(materialId), materialId, maximumProgramBytes, signal);
  const program = parseMaterialProgram(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(programBytes)));
  const plan = compileMaterialStagePlan(program);
  const texturePixels = new Map<string, NativeStorePngPixels>();
  const textureMipChains = new Map<string, LoadedTextureMipChain>();
  if (plan.status === "compiled") {
    for (const sampler of plan.samplers) {
      for (const [frameIndex, image] of sampler.frameImages.entries()) {
        const pixels = texturePixels.get(image.sha256) ?? await loadTextureImage(image, signal);
        const size = sampler.frameSizes[frameIndex]!;
        if (pixels.width !== size.width || pixels.height !== size.height) {
          throw new NativeMaterialLoadError(`Native texture ${sampler.frameNodes[frameIndex]} decodes to ${pixels.width} x ${pixels.height}, not its Engine.Texture USize x VSize ${size.width} x ${size.height}.`);
        }
        texturePixels.set(image.sha256, pixels);
        if (image.mips && !textureMipChains.has(image.sha256)) {
          textureMipChains.set(image.sha256, await loadTextureMipChain(image.mips, sampler.frameNodes[frameIndex]!, size, signal));
        }
      }
    }
  }
  signal.throwIfAborted();
  return { materialId, program, plan, texturePixels, textureMipChains };
}
