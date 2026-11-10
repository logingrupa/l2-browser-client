import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import { sha256 } from "../assets/package/readAssetPackage";
import { decodeNativePreviewPng } from "../scene/world/nativeTerrainPreview";
import type { EffectResource } from "./nativeEffectComponents";

const maximumTextureBytes = 32 * 1024 * 1024;

function requireTexture(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Native effect texture: ${message}`);
}

export async function createNativeEffectTexture(scene: Scene, resource: EffectResource, png: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<RawTexture> {
  signal.throwIfAborted();
  const bytes = png.slice();
  requireTexture(/^[a-f0-9]{64}$/.test(resource.sha256) && resource.file.endsWith(".png"), `${resource.object} is not a content-addressed PNG resource.`);
  requireTexture(bytes.length === resource.bytes && bytes.length > 0 && bytes.length <= maximumTextureBytes, `${resource.object} holds ${bytes.length} bytes, not ${resource.bytes}.`);
  requireTexture(await sha256(bytes) === resource.sha256, `${resource.object} differs from its SHA-256.`);
  const pixels = await decodeNativePreviewPng(bytes, signal);
  signal.throwIfAborted();
  requireTexture(!scene.isDisposed, "the scene was disposed during texture decoding.");
  const texture = RawTexture.CreateRGBATexture(pixels.rgba, pixels.width, pixels.height, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  texture.name = `Effect texture: ${resource.object}`;
  texture.gammaSpace = false;
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}
