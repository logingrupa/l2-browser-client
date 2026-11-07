import { Constants } from "@babylonjs/core/Engines/constants";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Material } from "@babylonjs/core/Materials/material";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { sha256 } from "../../assets/package/readAssetPackage";
import type { NativeFlamePlan } from "./nativeMaterialGraph";
import { decodeNativePreviewPng } from "./nativeTerrainPreview";

type RGBA = [number, number, number, number];
type Fade = NativeFlamePlan["fade"];
type Animation = Pick<NativeFlamePlan["animation"], "maxFrameRate" | "totalFrameNum">;
export interface NativeFlameReplayTime { textureSeconds: number; fadeSeconds: number; }
/** Each binding is a whole render mesh already resolved to a native section.
 * slot is the source shader slot, not a Babylon MultiMaterial submaterial index. */
export interface NativeFlameMaterialBinding {
  readonly mesh: AbstractMesh; readonly slot: 0 | 1; readonly expectedMaterial: Material | null;
}
export interface NativeFlameMaterialInspection {
  status: "source-formulas-native-parity-unverified";
  disposed: boolean;
  graphSha256: string;
  bindingCounts: { requested: number; active: number; skipped: number; released: number };
  textureCount: number;
  materialCount: number;
  current: NativeFlameReplayTime & { frameIndex: number; frameObject: string; fadeRgbaBytes: RGBA };
  errors: { meshId: string; slot: number; reason: string }[];
  numericalModel: string;
  clocks: { texture: string; fade: string; synchronization: "unverified" };
  lighting: "unlit-encoded-color";
  nativeParity: "unverified";
  limitations: readonly string[];
}
export interface NativeFlameMaterials {
  update(time: NativeFlameReplayTime): void;
  inspect(): NativeFlameMaterialInspection;
  dispose(): void;
}

const SOURCE = "FX_E_S.Flameset.Default_Flame01";
const NUMERICAL_MODEL = "Texture: JavaScript binary64 repeated subtraction, precision53 probe model. Fade: binary32 stores and byte floor, JavaScript Math.cos. Native x87/Core arithmetic is unverified.";
const LIMITATIONS = [
  "Explicit independent replay seconds; native clock origins, pause behavior and synchronization are unverified.",
  "Verified PNG mip0 bytes, bilinear sampling, no generated mips or color conversion. Native GPU filtering, orientation and color space are unverified.",
  "Recovered fixed-function stages and blend factors; unlit output. Native lighting, fog, shader-generation path and draw ordering are unverified.",
  "Glow uses MODULATE2X; the retained old 3dfx MODULATE exception is not selected.",
  "No billboard or transform evaluation is performed by this owner. This owner alone is not a native visual pass.",
] as const;
const vertexSource = `precision highp float;
attribute vec3 position; attribute vec2 uv;
uniform mat4 worldViewProjection; varying vec2 nativeUV;
void main(){nativeUV=uv;gl_Position=worldViewProjection*vec4(position,1.0);}`;
const fragmentSources = [
  `precision highp float; varying vec2 nativeUV; uniform sampler2D sourceTexture;
void main(){gl_FragColor=texture2D(sourceTexture,nativeUV);}`,
  `precision highp float; varying vec2 nativeUV; uniform sampler2D sourceTexture; uniform vec3 quantizedFade;
void main(){vec3 rgb=clamp(2.0*texture2D(sourceTexture,nativeUV).rgb*quantizedFade,0.0,1.0);gl_FragColor=vec4(rgb,0.0);}`,
] as const;

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Native flame materials: ${message}`);
}
function finite(value: number, label: string): void { requireValue(Number.isFinite(value), `${label} must be finite.`); }
function validateFade(fade: Fade): void {
  requireValue(fade.colorFadeType === 1, "unsupported FadeColor operation.");
  requireValue(Number.isFinite(Math.fround(fade.fadePeriod)) && Math.fround(fade.fadePeriod) > 0 && Number.isFinite(Math.fround(fade.fadePhase)), "unsupported FadeColor period/phase.");
  for (const color of [fade.color1, fade.color2]) requireValue(color.rgbaBytes.length === 4 && color.rgbaBytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255), "invalid source color bytes.");
}

/** Source store boundaries with an explicitly bounded JS numerical model.
 * Math.cos is not established as native Core.appCos, nor JS as x87 extended FP. */
export function evaluateNativeFlameFade(fadeSeconds: number, fade: Fade) {
  finite(fadeSeconds, "fadeSeconds"); validateFade(fade);
  const timeFloat32 = Math.fround(fadeSeconds);
  const qFloat32 = Math.fround((timeFloat32 + Math.fround(fade.fadePhase)) / Math.fround(fade.fadePeriod));
  requireValue(Number.isFinite(qFloat32), "fade input exceeds the finite binary32 model.");
  const cosArgumentFloat64 = qFloat32 * Math.PI * 0.5;
  const weightFloat32 = Math.fround(0.5 + 0.5 * Math.cos(cosArgumentFloat64));
  const oppositeWeightFloat32 = Math.fround(1 - weightFloat32);
  const planeFloat32 = fade.color1.rgbaBytes.map((value, index) => Math.fround(
    Math.fround(Math.fround(value / 255) * weightFloat32) + Math.fround(Math.fround(fade.color2.rgbaBytes[index]! / 255) * oppositeWeightFloat32),
  )) as RGBA;
  const scaledFloat32 = planeFloat32.map(value => Math.fround(value * 255)) as RGBA;
  const rgbaBytes = scaledFloat32.map(value => Math.min(255, Math.max(0, Math.floor(value)))) as RGBA;
  return { timeFloat32, qFloat32, cosArgumentFloat64, weightFloat32, oppositeWeightFloat32, planeFloat32, scaledFloat32, rgbaBytes };
}

/** Tick(double) precision53 model, including its repeated subtraction stores.
 * Deliberately does not use floor(modulo * fps), which differs at frame seams. */
export function selectNativeFlameFrame(textureSeconds: number, animation: Animation) {
  requireValue(Number.isFinite(textureSeconds) && textureSeconds >= 0, "textureSeconds must be finite and nonnegative.");
  requireValue(Number.isFinite(animation.maxFrameRate) && animation.maxFrameRate > 0 && Number.isInteger(animation.totalFrameNum) && animation.totalFrameNum >= 1 && animation.totalFrameNum <= 64, "unsupported texture animation parameters.");
  const stepSeconds = 1 / Math.min(100, Math.max(0.1, animation.maxFrameRate));
  const cycleSeconds = animation.totalFrameNum * stepSeconds;
  const quotient = textureSeconds / cycleSeconds;
  requireValue(quotient <= 0x7fffffff, "texture time exceeds the reviewed signed-int truncation path.");
  const initialPhase = textureSeconds - Math.trunc(quotient) * cycleSeconds;
  let remainingPhase = initialPhase, index = 0, ticks = 0;
  while (remainingPhase >= stepSeconds) {
    requireValue(ticks++ <= animation.totalFrameNum, "texture phase exceeds its bounded cycle.");
    index = (index + 1) % animation.totalFrameNum;
    remainingPhase -= stepSeconds;
  }
  return { index, initialPhase, remainingPhase, stepSeconds, cycleSeconds };
}

function validatePlan(plan: NativeFlamePlan): void {
  requireValue(plan.modelId === `interlude:${SOURCE}` && plan.sourceMesh === SOURCE, "unsupported source mesh.");
  requireValue(plan.shaders.length === 2 && plan.shaders.every((shader, slot) => shader.slot === slot && shader.outputBlending === (slot === 0 ? 5 : 3) && typeof shader.twoSided === "boolean" && shader.zWrite === false && shader.alphaTest === false && shader.alphaRef === 0), "unsupported shader blend/depth/alpha operation.");
  const combine = plan.combiner;
  requireValue(combine.combineOperation === 2 && combine.alphaOperation === 0 && combine.modulate2X === true && combine.modulate4X === false && combine.mask === null && combine.invertMask === false, "unsupported combiner operation.");
  requireValue(plan.animation.frames.length === plan.animation.totalFrameNum && plan.shaders[0].diffuse === plan.animation.frames[0]?.object && plan.shaders[1].diffuse === combine.object && combine.material1 === plan.glow.object && combine.material2 === plan.fade.object, "shader dependency differs from the validated plan.");
  validateFade(plan.fade); selectNativeFlameFrame(0, plan.animation);
  requireValue(plan.fade.color1.rgbaBytes[3] === 0 && plan.fade.color2.rgbaBytes[3] === 0, "unsupported nonzero combiner constant alpha.");
  for (const texture of [...plan.animation.frames, plan.glow]) requireValue(
    Number.isInteger(texture.width) && Number.isInteger(texture.height) && texture.width > 0 && texture.height > 0 && texture.width <= 1024 && texture.height <= 1024 &&
    (texture.uClampMode === 0 || texture.uClampMode === 1) && (texture.vClampMode === 0 || texture.vClampMode === 1) && texture.format === (texture === plan.glow ? 8 : 3), "unsupported texture dimensions, format or addressing.");
}

/** Create a scene-local, reversible projection of a prepared source graph.
 * Preparation never changes source assignments. A changed binding is permanently
 * relinquished; later updates cannot reacquire an authored assignment. */
export async function createNativeFlameMaterials(scene: Scene, plan: NativeFlamePlan, bindings: readonly NativeFlameMaterialBinding[], signal: AbortSignal): Promise<NativeFlameMaterials> {
  signal.throwIfAborted(); requireValue(!scene.isDisposed, "scene is disposed."); validatePlan(plan);
  requireValue(bindings.length <= 256 && new Set(bindings.map(binding => binding.mesh)).size === bindings.length, "duplicate or excessive mesh bindings.");
  for (const { mesh, slot, expectedMaterial } of bindings) requireValue((slot === 0 || slot === 1) && mesh.getScene() === scene && (!expectedMaterial || expectedMaterial.getScene() === scene) &&
    !mesh.skeleton && !mesh.morphTargetManager && !mesh.isAnInstance && !mesh.hasInstances && !mesh.hasThinInstances && mesh.isVerticesDataPresent("position") && mesh.isVerticesDataPresent("uv"), "binding requires a same-scene static mesh with source UVs.");

  // Snapshot mutable caller data before any await; resources are copied and
  // rehashed before decode, so caller edits cannot become a later upload.
  const animation = { ...plan.animation, frames: plan.animation.frames.map(texture => ({ ...texture, image: { ...texture.image } })) };
  const glow = { ...plan.glow, image: { ...plan.glow.image } };
  const fade: Fade = { ...plan.fade, color1: { ...plan.fade.color1, rgbaBytes: [...plan.fade.color1.rgbaBytes] }, color2: { ...plan.fade.color2, rgbaBytes: [...plan.fade.color2.rgbaBytes] } };
  const shaders = plan.shaders.map(shader => ({ ...shader }));
  const graphSha256 = plan.graph.sha256;
  const textures: RawTexture[] = [], materials: ShaderMaterial[] = [], errors: NativeFlameMaterialInspection["errors"] = [];
  const records = bindings.map(binding => ({ ...binding, state: "pending" as "pending" | "active" | "skipped" | "released", replacement: undefined as ShaderMaterial | undefined }));
  const lifetime = new AbortController(), removers: (() => void)[] = [];
  let disposed = false, writing = false;
  let current: NativeFlameMaterialInspection["current"] = { textureSeconds: 0, fadeSeconds: 0, frameIndex: 0, frameObject: animation.frames[0]!.object, fadeRgbaBytes: evaluateNativeFlameFade(0, fade).rgbaBytes };
  const lose = (entry: typeof records[number], reason: string) => {
    if (entry.state !== "pending" && entry.state !== "active") return;
    entry.state = entry.state === "pending" ? "skipped" : "released";
    errors.push({ meshId: entry.mesh.id, slot: entry.slot, reason });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); signal.removeEventListener("abort", dispose);
    for (const remove of removers) remove();
    for (const entry of records) if (entry.state === "active") {
      if (!entry.mesh.isDisposed() && entry.mesh.material === entry.replacement) entry.mesh.material = entry.expectedMaterial;
      entry.state = "released";
    }
    // Do not let Material.dispose walk unrelated source meshes/geometry.
    for (const material of materials) material.dispose(false, false, true);
    for (const texture of textures) texture.dispose();
  };
  const sceneObserver = scene.onDisposeObservable.add(dispose);
  removers.push(() => scene.onDisposeObservable.remove(sceneObserver));
  signal.addEventListener("abort", dispose, { once: true });
  const alive = () => { lifetime.signal.throwIfAborted(); signal.throwIfAborted(); requireValue(!scene.isDisposed && !disposed, "scene lifetime ended."); };
  for (const entry of records) {
    const changed = entry.mesh.onMaterialChangedObservable.add(() => { if (!writing) lose(entry, "material-assignment-changed"); });
    const removed = entry.mesh.onDisposeObservable.add(() => lose(entry, "mesh-disposed"));
    removers.push(() => entry.mesh.onMaterialChangedObservable.remove(changed), () => entry.mesh.onDisposeObservable.remove(removed));
    if (entry.mesh.isDisposed()) lose(entry, "mesh-disposed");
    else if (entry.mesh.material !== entry.expectedMaterial) lose(entry, "expected-material-mismatch");
  }
  const abortable = async <T>(operation: () => Promise<T>): Promise<T> => {
    alive(); let cancel!: () => void;
    const aborted = new Promise<never>((_, reject) => { cancel = () => reject(new DOMException("Native flame preparation aborted.", "AbortError")); lifetime.signal.addEventListener("abort", cancel, { once: true }); });
    try { const result = await Promise.race([operation(), aborted]); alive(); return result; }
    finally { lifetime.signal.removeEventListener("abort", cancel); }
  };
  // Own the readiness timer so abort/scene teardown cancels it. Babylon's
  // forceCompilationAsync has an internal polling timer without cancellation.
  const compile = (material: ShaderMaterial, mesh: AbstractMesh) => new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined, attempts = 0;
    const finish = (error?: unknown) => { if (timer !== undefined) clearTimeout(timer); lifetime.signal.removeEventListener("abort", cancel); error === undefined ? resolve() : reject(error); };
    const cancel = () => finish(new DOMException("Native flame compilation aborted.", "AbortError"));
    const poll = () => {
      try {
        alive(); if (mesh.isDisposed()) { finish(); return; }
        if (material.isReady(mesh)) { finish(); return; }
        const effect = material.getEffect(), error = effect?.getCompilationError();
        if (error && effect?.allFallbacksProcessed()) throw new Error(error);
        requireValue(attempts++ < 1800, "shader readiness timed out."); timer = setTimeout(poll, 16);
      } catch (error) { finish(error); }
    };
    lifetime.signal.addEventListener("abort", cancel, { once: true }); poll();
  });

  try {
    const sources = [...animation.frames, glow], copied = new Map<string, Uint8Array<ArrayBuffer>>();
    if (records.some(entry => entry.state === "pending")) for (const source of sources) {
      const bytes = plan.resources.get(source.image.path);
      requireValue(bytes && bytes.length === source.image.bytes, `missing image bytes: ${source.object}.`);
      copied.set(source.image.path, new Uint8Array(bytes));
    }
    const gpu = new Map<string, RawTexture>();
    if (records.some(entry => entry.state === "pending")) for (const source of sources) {
      const bytes = copied.get(source.image.path)!;
      requireValue(await abortable(() => sha256(bytes)) === source.image.sha256, `image hash differs: ${source.object}.`);
      const pixels = await abortable(() => decodeNativePreviewPng(bytes, lifetime.signal));
      requireValue(pixels.width === source.width && pixels.height === source.height, `decoded dimensions differ: ${source.object}.`);
      const texture = RawTexture.CreateRGBATexture(pixels.rgba, pixels.width, pixels.height, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
      textures.push(texture); texture.name = source.object;
      texture.gammaSpace = false; texture.hasAlpha = true; texture.anisotropicFilteringLevel = 1;
      texture.wrapU = source.uClampMode === 0 ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
      texture.wrapV = source.vClampMode === 0 ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
      gpu.set(source.object, texture); alive();
    }
    const candidates = new Map<string, ShaderMaterial>();
    for (const entry of records) {
      if (entry.state !== "pending") continue;
      const sideOrientation = entry.expectedMaterial?.sideOrientation ?? null, cullBackFaces = entry.expectedMaterial?.cullBackFaces ?? true;
      const key = `${entry.slot}:${sideOrientation}:${cullBackFaces}`;
      let material = candidates.get(key);
      if (!material) {
        material = new ShaderMaterial(`Native flame slot ${entry.slot} · unverified`, scene, { vertexSource, fragmentSource: fragmentSources[entry.slot] }, {
          attributes: ["position", "uv"], uniforms: ["worldViewProjection", "quantizedFade"], samplers: ["sourceTexture"], needAlphaBlending: true, needAlphaTesting: false,
        }, false);
        materials.push(material); candidates.set(key, material);
        // Pinned AlphaState: screen=(ONE,INV_SRC_COLOR,ONE,INV_SRC_ALPHA),
        // oneone=(ONE,ONE,ONE,ONE). Glow alpha is zero, not an opacity weight.
        material.alphaMode = entry.slot === 0 ? Constants.ALPHA_SCREENMODE : Constants.ALPHA_ONEONE_ONEONE;
        material.transparencyMode = Material.MATERIAL_ALPHABLEND;
        material.disableDepthWrite = true; material.forceDepthWrite = false;
        material.backFaceCulling = !shaders[entry.slot]!.twoSided;
        material.sideOrientation = sideOrientation; material.cullBackFaces = cullBackFaces;
        material.doNotSerialize = true;
        material.setTexture("sourceTexture", gpu.get(entry.slot === 0 ? animation.frames[0]!.object : glow.object)!);
        // The shader declares one vec3. An array setter requires array stride
        // metadata in WebGPU's uniform buffer, even for three components.
        material.setColor3("quantizedFade", new Color3(current.fadeRgbaBytes[0] / 255, current.fadeRgbaBytes[1] / 255, current.fadeRgbaBytes[2] / 255));
      }
      entry.replacement = material;
      await compile(material, entry.mesh); alive();
    }
    for (const entry of records) {
      alive(); if (entry.state !== "pending") continue;
      if (entry.mesh.isDisposed()) { lose(entry, "mesh-disposed"); continue; }
      if (entry.mesh.material !== entry.expectedMaterial) { lose(entry, "expected-material-mismatch"); continue; }
      entry.state = "active";
      try { writing = true; entry.mesh.material = entry.replacement!; }
      finally { writing = false; }
      if (entry.mesh.material !== entry.replacement) lose(entry, "material-assignment-changed");
    }
    alive();
    const update = (time: NativeFlameReplayTime) => {
      if (disposed) return;
      // Validate both inputs before any uniform changes; neither clock is
      // derived from the other, from render delta, nor from wall-clock time.
      const selected = selectNativeFlameFrame(time.textureSeconds, animation), evaluated = evaluateNativeFlameFade(time.fadeSeconds, fade);
      for (const entry of records) if (entry.state === "active" && (entry.mesh.isDisposed() || entry.mesh.material !== entry.replacement)) lose(entry, entry.mesh.isDisposed() ? "mesh-disposed" : "material-assignment-changed");
      for (const [key, material] of candidates) {
        if (key.startsWith("0:")) material.setTexture("sourceTexture", gpu.get(animation.frames[selected.index]!.object)!);
        else material.setColor3("quantizedFade", new Color3(evaluated.rgbaBytes[0] / 255, evaluated.rgbaBytes[1] / 255, evaluated.rgbaBytes[2] / 255));
      }
      current = { ...time, frameIndex: selected.index, frameObject: animation.frames[selected.index]!.object, fadeRgbaBytes: evaluated.rgbaBytes };
    };
    return { update, dispose, inspect: () => ({
      status: "source-formulas-native-parity-unverified", disposed, graphSha256,
      bindingCounts: { requested: records.length, active: records.filter(entry => entry.state === "active").length, skipped: records.filter(entry => entry.state === "skipped").length, released: records.filter(entry => entry.state === "released").length },
      textureCount: disposed ? 0 : textures.length, materialCount: disposed ? 0 : materials.length,
      current: { ...current, fadeRgbaBytes: [...current.fadeRgbaBytes] }, errors: errors.map(error => ({ ...error })), numericalModel: NUMERICAL_MODEL,
      clocks: { texture: "Explicit textureSeconds; native viewport+0x144 or renderer override+0x4eb08.", fade: "Explicit fadeSeconds converted to binary32; native (viewport.Actor+0xe0)->+0x4bc.", synchronization: "unverified" },
      lighting: "unlit-encoded-color", nativeParity: "unverified", limitations: [...LIMITATIONS],
    }) };
  } catch (error) { dispose(); throw error; }
}
