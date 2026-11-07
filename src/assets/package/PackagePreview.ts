import type { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF";
import "./nativeSkinWeights";
import "@babylonjs/core/Materials/imageProcessingConfiguration";
import { validatePackageModel, type AssetPackage } from "./readAssetPackage";
import { restoreWorldPrecision } from "./restoreWorldPrecision";
import { createNativeClipPlayback, validateNativeClipDuration, type NativeClipPlayback } from "./nativeClipPlayback";
import { createNativeEventAudio, type NativeEventAudio } from "./nativeEventAudio";
import { samplePackageDeformation } from "./sampleDeformation";
import { createWebGPUEngine } from "../../engine/createWebGPUEngine";

export interface PackagePreview {
  readonly element: HTMLElement;
  readonly clips: readonly { name: string; from: number; to: number; durationSeconds: number; nativeTiming: boolean }[];
  readonly summary: string;
  play(index: number): void;
  pause(): void;
  setLinkedSounds(enabled: boolean): Promise<void>;
  sampleDeformation(): ReturnType<typeof samplePackageDeformation>;
  snapshot(): { unitScale: number; playing: boolean; selectedClip: string | null; bounds: number[][] | null; skeletons: number; meshes: number; nodes: number; materials: string[];
    bones: number; bonePose: number[]; nativePlayback: { timeSeconds: number; durationSeconds: number; loopCount: number } | null;
    linkedSounds: ReturnType<NativeEventAudio["inspection"]> | null };
  dispose(): void;
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal, discard?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Import cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(value => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) discard?.(value); else resolve(value);
    }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
function waitForMedia(element: HTMLMediaElement | HTMLImageElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const events = new AbortController();
    const finish = (error?: Error) => { clearTimeout(timeout); events.abort(); signal.removeEventListener("abort", abort); error ? reject(error) : resolve(); };
    const abort = () => finish(new DOMException("Import cancelled", "AbortError"));
    const timeout = setTimeout(() => finish(new Error("This browser could not decode the asset. Convert it to PNG or a supported audio format.")), 20_000);
    element.addEventListener(element instanceof HTMLImageElement ? "load" : "loadedmetadata", () => finish(), { once: true, signal: events.signal });
    element.addEventListener("error", () => finish(new Error("This browser cannot decode the package's media file.")), { once: true, signal: events.signal });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** An isolated viewer. Camera framing never changes source geometry or model scale. */
export async function createPackagePreview(asset: AssetPackage, host: HTMLElement, signal: AbortSignal): Promise<PackagePreview> {
  const { manifest } = asset;
  const element = document.createElement("div");
  element.className = "asset-preview-content";
  element.style.visibility = "hidden";
  host.append(element);
  let disposed = false;
  let engine: WebGPUEngine | undefined, scene: Scene | undefined, container: AssetContainer | undefined;
  let resize: ResizeObserver | undefined, media: HTMLAudioElement | undefined, mediaUrl: string | undefined;
  let group: AnimationGroup | undefined;
  let nativePlayback: NativeClipPlayback | undefined;
  let linkedSounds: NativeEventAudio | undefined;
  let lastTimestamp = 0;
  let bounds: number[][] | null = null, summary = "";
  const clips: { name: string; from: number; to: number; durationSeconds: number; nativeTiming: boolean }[] = [];
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    resize?.disconnect();
    if (media) { media.pause(); media.removeAttribute("src"); media.load(); }
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    linkedSounds?.dispose();
    engine?.stopRenderLoop(); container?.dispose(); scene?.dispose(); engine?.dispose(); element.remove();
    restoreWorldPrecision();
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    signal.throwIfAborted();
    if (manifest.kind === "model") {
      const content = asset.files.get(manifest.model!.file)!;
      const modelInfo = validatePackageModel(content);
      linkedSounds = createNativeEventAudio(asset);
      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-label", `${manifest.name} model preview`);
      canvas.tabIndex = 0;
      element.append(canvas);
      const previewEngine = await abortable(createWebGPUEngine(canvas), signal, late => {
        late.dispose(); restoreWorldPrecision();
      });
      if (signal.aborted) { previewEngine.dispose(); restoreWorldPrecision(); signal.throwIfAborted(); }
      engine = previewEngine;
      engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 1.5));
      scene = new Scene(engine); scene.useRightHandedSystem = true;
      scene.clearColor = new Color4(.09, .115, .105, 1);
      new HemisphericLight("Inspector ambient", new Vector3(0, 1, 0), scene).intensity = 1.1;
      new DirectionalLight("Inspector key", new Vector3(-.4, -1, .6), scene).intensity = 1.4;
      const camera = new ArcRotateCamera("Inspector camera", -Math.PI / 2.5, 1.2, 4, Vector3.Zero(), scene);
      camera.attachControl(canvas, true);
      camera.wheelDeltaPercentage = .02;
      // A ZIP_STORED entry can begin at any byte offset. Align the whole GLB
      // once; otherwise Babylon must copy every typed accessor separately.
      const loaded = await abortable(LoadAssetContainerAsync(content.slice(), scene, { pluginExtension: ".glb", name: manifest.model!.file,
        pluginOptions: { gltf: { animationStartMode: GLTFLoaderAnimationStartMode.NONE } } }), signal, late => late.dispose());
      if (signal.aborted) { loaded.dispose(); signal.throwIfAborted(); }
      container = loaded;
      signal.throwIfAborted();
      container.addAllToScene();
      scene.activeCamera = camera;
      container.animationGroups.forEach((animation, index) => {
        animation.stop();
        const source = modelInfo.animations[index], fps = animation.targetedAnimations[0]?.animation.framePerSecond ?? 60;
        if (source?.nativeDurationSeconds !== null && source?.nativeDurationSeconds !== undefined && source.name !== null && source.name !== animation.name) throw new Error("Native animation metadata does not match the imported clip order.");
        const duration = source?.nativeDurationSeconds ?? (animation.to - animation.from) / fps;
        // Reject incompatible timing during import, while a previous good
        // asset can still be retained, instead of throwing from a Play click.
        if (source?.nativeDurationSeconds !== null && source?.nativeDurationSeconds !== undefined) validateNativeClipDuration(animation, duration);
        clips.push({ name: animation.name, from: source?.nativeDurationSeconds ? 0 : animation.from, to: source?.nativeDurationSeconds ? duration * fps : animation.to,
          durationSeconds: duration, nativeTiming: source?.nativeDurationSeconds !== null && source?.nativeDurationSeconds !== undefined });
      });
      const minimum = new Vector3(Infinity, Infinity, Infinity), maximum = new Vector3(-Infinity, -Infinity, -Infinity);
      let meshCount = 0;
      for (const mesh of container.meshes) {
        if (!mesh.getTotalVertices()) continue;
        meshCount++;
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        minimum.minimizeInPlace(box.minimumWorld); maximum.maximizeInPlace(box.maximumWorld);
      }
      if (!meshCount || ![...minimum.asArray(), ...maximum.asArray()].every(Number.isFinite)) throw new Error("The model has no finite visible geometry.");
      bounds = [minimum.asArray(), maximum.asArray()];
      const center = minimum.add(maximum).scale(.5), extent = Math.max(maximum.subtract(minimum).length() * .5, .001);
      camera.setTarget(center);
      camera.radius = extent / Math.sin(camera.fov / 2) * 1.25;
      camera.lowerRadiusLimit = Math.max(extent * .05, .001); camera.upperRadiusLimit = camera.radius * 20;
      camera.minZ = Math.max(extent / 1000, .0001); camera.maxZ = Math.max(camera.radius * 40, 100);
      camera.panningSensibility = 1000 / extent;
      summary = `${meshCount} mesh${meshCount === 1 ? "" : "es"} · ${container.skeletons.length} skeleton${container.skeletons.length === 1 ? "" : "s"} · ${clips.length} native clip${clips.length === 1 ? "" : "s"}`;
      const renderScene = scene, renderEngine = engine;
      resize = new ResizeObserver(() => renderEngine.resize()); resize.observe(host);
      engine.resize();
      await abortable(scene.whenReadyAsync(), signal);
      signal.throwIfAborted();
      engine.runRenderLoop(() => {
        if (disposed) return;
        const timestamp = performance.now();
        if (nativePlayback?.playing) {
          const previous = nativePlayback.loopCount * nativePlayback.durationSeconds + nativePlayback.timeSeconds;
          nativePlayback.advance(Math.max(0, (timestamp - lastTimestamp) / 1000));
          const elapsed = nativePlayback.loopCount * nativePlayback.durationSeconds + nativePlayback.timeSeconds;
          if (group) linkedSounds?.advance(group.name, previous, elapsed, nativePlayback.durationSeconds);
        }
        lastTimestamp = timestamp;
        renderScene.render();
      });
    } else {
      const name = manifest.kind === "audio" ? manifest.audio!.file : manifest.image!.file;
      const inventory = manifest.files.find(file => file.path === name)!;
      const content = asset.files.get(name)!;
      if (manifest.kind === "texture") {
        if (inventory.mime !== "image/png" || content.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => content[index] === byte)) throw new Error("Texture packages currently require a PNG image.");
        const view = new DataView(content.buffer, content.byteOffset, content.byteLength), width = view.getUint32(16), height = view.getUint32(20);
        if (!width || !height || width > 16384 || height > 16384 || width * height > 32 * 1024 * 1024) throw new Error("The PNG exceeds the inspector's image size limit.");
        const image = document.createElement("img"); image.alt = manifest.name;
        const ready = waitForMedia(image, signal);
        mediaUrl = URL.createObjectURL(new Blob([content.slice().buffer], { type: inventory.mime }));
        image.src = mediaUrl; element.append(image);
        await ready;
        summary = `${image.naturalWidth} × ${image.naturalHeight} pixels · PNG texture`;
      } else {
        if (!["audio/wav", "audio/x-wav", "audio/ogg", "audio/mpeg"].includes(inventory.mime)) throw new Error("This audio format is unsupported. Convert it to WAV, Ogg, or MP3.");
        media = document.createElement("audio"); media.controls = true; media.preload = "metadata";
        media.setAttribute("aria-label", `${manifest.name} audio`);
        const ready = waitForMedia(media, signal);
        mediaUrl = URL.createObjectURL(new Blob([content.slice().buffer], { type: inventory.mime }));
        media.src = mediaUrl; element.append(media);
        await ready;
        summary = `${Number.isFinite(media.duration) ? `${media.duration.toFixed(2)} seconds · ` : ""}Audio · press Play to listen`;
      }
      signal.throwIfAborted();
    }
    signal.removeEventListener("abort", dispose);
    return {
      element, clips, summary,
      play(index) {
        const selected = container?.animationGroups[index];
        if (!selected) return;
        if (group !== selected) {
          group?.stop(); nativePlayback?.pause(); nativePlayback = undefined; group = selected;
          linkedSounds?.reset();
          if (clips[index]?.nativeTiming) nativePlayback = createNativeClipPlayback(group, clips[index]!.durationSeconds);
          else group.start(true, 1, group.from, group.to);
        }
        lastTimestamp = performance.now();
        if (nativePlayback) nativePlayback.play(); else group.play(true);
      },
      pause: () => { nativePlayback?.pause(); group?.pause(); linkedSounds?.reset(); },
      setLinkedSounds: enabled => linkedSounds?.setEnabled(enabled) ?? Promise.resolve(),
      sampleDeformation: () => samplePackageDeformation(container),
      snapshot: () => ({ unitScale: 1, playing: nativePlayback?.playing ?? group?.isPlaying ?? (media ? !media.paused : false), selectedClip: group?.name ?? null, bounds,
        skeletons: container?.skeletons.length ?? 0, meshes: container?.meshes.filter(mesh => mesh.getTotalVertices() > 0).length ?? 0,
        nodes: (container?.transformNodes.length ?? 0) + (container?.meshes.length ?? 0), materials: container?.materials.map(material => material.name) ?? [],
        bones: container?.skeletons.reduce((total, skeleton) => total + skeleton.bones.length, 0) ?? 0,
        bonePose: container?.skeletons.flatMap(skeleton => skeleton.bones.flatMap(bone => Array.from(bone.getLocalMatrix().asArray()))) ?? [],
        nativePlayback: nativePlayback ? { timeSeconds: nativePlayback.timeSeconds, durationSeconds: nativePlayback.durationSeconds, loopCount: nativePlayback.loopCount } : null,
        linkedSounds: linkedSounds?.inspection() ?? null }),
      dispose,
    };
  } catch (error) { signal.removeEventListener("abort", dispose); dispose(); throw error; }
}
