import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { loadCharacterModel } from "../../src/assets/loadCharacterModel";
import { prepareCharacterModel } from "../../src/assets/prepareCharacterModel";
import { characterProfiles } from "../../src/assets/characterProfiles";

function element<T extends HTMLElement>(id: string, kind: { new(): T }): T {
  const value = document.getElementById(id);
  if (!(value instanceof kind)) throw new Error(`Missing ${id}.`);
  return value;
}

const canvas = element("inspection-canvas", HTMLCanvasElement);
const status = element("status", HTMLParagraphElement);
const variantControl = element("variant", HTMLSelectElement);
const clipControl = element("clip", HTMLSelectElement);
const playButton = element("play", HTMLButtonElement);
const frameControl = element("frame", HTMLInputElement);
const frameButton = element("show-frame", HTMLButtonElement);
const sampleButton = element("sample", HTMLButtonElement);
const independentButton = element("independent", HTMLButtonElement);
const groundingButton = element("grounding", HTMLButtonElement);
const labels = element("labels", HTMLDivElement);
const variants = ["MFighter", "FFighter", "MMagic", "FMagic"] as const;
const semanticClips = ["wait_Hand", "run_Hand", "Atk01_Hand"];
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.19, 0.23, 0.24, 1);
const camera = new ArcRotateCamera("Inspection camera", Math.PI / 2, 1.31, 8.4, new Vector3(0, 0.95, 0), scene);
camera.lowerRadiusLimit = 2.2;
camera.upperRadiusLimit = 12;
camera.minZ = 0.01;
camera.attachControl(canvas, true);
const fill = new HemisphericLight("Studio fill", new Vector3(0, 1, 0), scene);
fill.intensity = 1.1;
fill.groundColor = new Color3(0.36, 0.31, 0.26);
const key = new DirectionalLight("Studio key", new Vector3(-0.5, -1, -0.7), scene);
key.intensity = 2.1;
const floor = MeshBuilder.CreateGround("Inspection floor", { width: 20, height: 20 }, scene);
const floorMaterial = new StandardMaterial("Inspection floor material", scene);
floorMaterial.diffuseColor = new Color3(0.35, 0.39, 0.37);
floorMaterial.specularColor = Color3.Black();
floor.material = floorMaterial;
floor.position.y = 0;

interface LoadedCharacter {
  readonly variant: string;
  readonly container: AssetContainer;
  readonly root: TransformNode;
  readonly prepared: ReturnType<typeof prepareCharacterModel>;
  readonly label: HTMLSpanElement;
  readonly loadMilliseconds: number;
  readonly bind: PoseSample;
}

interface Bounds {
  min: number[];
  max: number[];
}

interface PoseSample {
  bounds: Bounds;
  finite: boolean;
  rootPosition: number[];
  parts: { name: string; bounds: Bounds; vertices: number; checksum: number }[];
  positions: number[];
}

const loaded: LoadedCharacter[] = [];
let audit: ReturnType<typeof inspectCharacter>[] | undefined;
let independence: Awaited<ReturnType<typeof inspectIndependence>> | undefined;
let groundingCorrections: Awaited<ReturnType<typeof measureGroundingRepair>> | undefined;
let pausedPose: { variant: string; bounds: Bounds; parts: PoseSample["parts"] }[] | undefined;
let isPlaying = true;
let isBusy = false;
let ready = false;
const frameTimes: number[] = [];
const loadStart = performance.now();
let readyMilliseconds = 0;
let lastFrameTime = performance.now();

function geometryMeshes(container: AssetContainer): AbstractMesh[] {
  return container.meshes.filter(mesh => mesh.getTotalVertices() > 0);
}

/** CPU skin evaluation uses Babylon's current palette, without modifying mesh geometry. */
function samplePose(character: Pick<LoadedCharacter, "container" | "root">): PoseSample {
  const { container, root } = character;
  root.computeWorldMatrix(true);
  for (const node of container.transformNodes) node.computeWorldMatrix(true);
  for (const skeleton of container.skeletons) skeleton.prepare(true);
  const minimum = new Vector3(Infinity, Infinity, Infinity);
  const maximum = new Vector3(-Infinity, -Infinity, -Infinity);
  const local = Vector3.Zero();
  const world = Vector3.Zero();
  const positions: number[] = [];
  const parts: PoseSample["parts"] = [];
  let finite = true;
  for (const mesh of geometryMeshes(container)) {
    mesh.computeWorldMatrix(true);
    const values = mesh.getPositionData(true, true);
    if (!values) throw new Error(`${mesh.name} has no position data.`);
    const partMinimum = new Vector3(Infinity, Infinity, Infinity);
    const partMaximum = new Vector3(-Infinity, -Infinity, -Infinity);
    let checksum = 0;
    for (let index = 0; index < values.length; index += 3) {
      local.set(values[index] ?? NaN, values[index + 1] ?? NaN, values[index + 2] ?? NaN);
      Vector3.TransformCoordinatesToRef(local, mesh.getWorldMatrix(), world);
      world.subtractInPlace(root.position);
      finite &&= Number.isFinite(world.x) && Number.isFinite(world.y) && Number.isFinite(world.z);
      partMinimum.minimizeInPlace(world);
      partMaximum.maximizeInPlace(world);
      positions.push(world.x, world.y, world.z);
      checksum += world.x * (index + 1) + world.y * (index + 2) + world.z * (index + 3);
    }
    minimum.minimizeInPlace(partMinimum);
    maximum.maximizeInPlace(partMaximum);
    parts.push({ name: mesh.name, bounds: { min: partMinimum.asArray(), max: partMaximum.asArray() }, vertices: values.length / 3, checksum });
  }
  const rigRoot = container.transformNodes.find(node => node.name === "bip01");
  if (!rigRoot) throw new Error("Native bip01 root is missing from the supplied rig.");
  return { bounds: { min: minimum.asArray(), max: maximum.asArray() }, finite, parts, positions, rootPosition: rigRoot.getAbsolutePosition().subtract(root.position).asArray() };
}

function maximumVertexDistance(first: number[], second: number[]): number {
  let maximum = 0;
  for (let index = 0; index < first.length; index += 3) {
    maximum = Math.max(maximum, Math.hypot(
      (first[index] ?? 0) - (second[index] ?? 0),
      (first[index + 1] ?? 0) - (second[index + 1] ?? 0),
      (first[index + 2] ?? 0) - (second[index + 2] ?? 0),
    ));
  }
  return maximum;
}

function stopAll(character: Pick<LoadedCharacter, "container">): void {
  for (const group of character.container.animationGroups) group.stop();
}

function nativeLoop(group: AnimationGroup): boolean {
  const metadata: unknown = group.metadata;
  if (typeof metadata !== "object" || metadata === null || !("gltf" in metadata)) throw new Error(`${group.name} has no native animation metadata.`);
  const gltf = metadata.gltf;
  if (typeof gltf !== "object" || gltf === null || !("extras" in gltf)) throw new Error(`${group.name} has no native animation extras.`);
  const extras = gltf.extras;
  if (typeof extras !== "object" || extras === null || !("loop" in extras) || typeof extras.loop !== "boolean") throw new Error(`${group.name} has no native loop policy.`);
  return extras.loop;
}

function repairedClipNames(variant: string): string[] {
  return variant === "MMagic" ? ["run_Hand"] : ["run_Hand", "Atk01_Hand"];
}

function sampleClip(character: LoadedCharacter, group: AnimationGroup, sampleRate: number | null) {
  stopAll(character);
  group.weight = 1;
  group.start(false);
  group.pause();
  const frameRate = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
  const durationSeconds = (group.to - group.from) / frameRate;
  const intervals = sampleRate === null ? 2 : Math.max(2, Math.ceil(durationSeconds * sampleRate - 0.00001));
  let floorMinimum = Infinity;
  let maximumHeight = 0;
  let maximumWidth = 0;
  let maximumDeformation = 0;
  let finite = true;
  let first: PoseSample | undefined;
  let last: PoseSample | undefined;
  let floorFrame = 0;
  for (let index = 0; index <= intervals; index += 1) {
    const frame = group.from + (group.to - group.from) * index / intervals;
    group.goToFrame(frame);
    // Match the visible browser path before evaluating CPU skin palettes.
    scene.render(false);
    const pose = samplePose(character);
    first ??= pose;
    last = pose;
    finite &&= pose.finite;
    if ((pose.bounds.min[1] ?? Infinity) < floorMinimum) {
      floorMinimum = pose.bounds.min[1] ?? Infinity;
      floorFrame = frame;
    }
    maximumHeight = Math.max(maximumHeight, (pose.bounds.max[1] ?? 0) - (pose.bounds.min[1] ?? 0));
    maximumWidth = Math.max(maximumWidth, (pose.bounds.max[0] ?? 0) - (pose.bounds.min[0] ?? 0), (pose.bounds.max[2] ?? 0) - (pose.bounds.min[2] ?? 0));
    maximumDeformation = Math.max(maximumDeformation, maximumVertexDistance(first.positions, pose.positions));
  }
  if (!first || !last) throw new Error("No pose samples were evaluated.");
  group.goToFrame(floorFrame);
  scene.render(false);
  const floorPose = samplePose(character);
  let refreshedFloorMinimum = Infinity;
  for (const mesh of geometryMeshes(character.container)) {
    mesh.refreshBoundingInfo({ applySkeleton: true, applyMorph: true });
    refreshedFloorMinimum = Math.min(refreshedFloorMinimum, mesh.getBoundingInfo().boundingBox.minimumWorld.y - character.root.position.y);
  }
  group.stop();
  return {
    name: group.name, loop: nativeLoop(group), durationSeconds, sampleRate, samples: intervals + 1, finite,
    floorMinimum, floorFrame, maximumHeight, maximumWidth, maximumDeformation,
    refreshedFloorMinimum, floorPose: { bounds: floorPose.bounds, parts: floorPose.parts },
    endpointVertexDistance: maximumVertexDistance(first.positions, last.positions),
    rootHorizontalDisplacement: Math.hypot((last.rootPosition[0] ?? 0) - (first.rootPosition[0] ?? 0), (last.rootPosition[2] ?? 0) - (first.rootPosition[2] ?? 0)),
    first: { bounds: first.bounds, parts: first.parts }, last: { bounds: last.bounds, parts: last.parts },
  };
}

function inspectCharacter(character: LoadedCharacter) {
  const { container } = character;
  const meshes = geometryMeshes(container);
  const ownedTargets = new Set([...container.transformNodes, ...container.meshes]);
  const invalidTargets = container.animationGroups.flatMap(group => group.targetedAnimations
    .filter(target => !(target.target instanceof TransformNode) || !ownedTargets.has(target.target))
    .map(target => `${group.name}:${String(target.target?.name)}`));
  const geometry = meshes.map(mesh => {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
    const normals = mesh.getVerticesData(VertexBuffer.NormalKind) ?? [];
    const textureCoordinates = mesh.getVerticesData(VertexBuffer.UVKind) ?? [];
    const weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind) ?? [];
    let worstWeightSumError = 0;
    for (let index = 0; index < weights.length; index += 4) {
      worstWeightSumError = Math.max(worstWeightSumError, Math.abs((weights[index] ?? 0) + (weights[index + 1] ?? 0) + (weights[index + 2] ?? 0) + (weights[index + 3] ?? 0) - 1));
    }
    const textures = mesh.material?.getActiveTextures() ?? [];
    return {
      name: mesh.name, parent: mesh.parent?.name, vertices: mesh.getTotalVertices(), triangles: mesh.getTotalIndices() / 3,
      skeleton: mesh.skeleton?.name, material: mesh.material?.name,
      finiteAttributes: [...positions, ...normals, ...textureCoordinates, ...weights].every(Number.isFinite),
      normalCount: normals.length / 3, textureCoordinateCount: textureCoordinates.length / 2,
      weightedVertices: weights.length / 4, worstWeightSumError,
      textures: textures.map(texture => ({ name: texture.name, ready: texture.isReady(), size: texture.getSize() })),
    };
  });
  const clips = container.animationGroups.map(group => sampleClip(character, group,
    repairedClipNames(character.variant).includes(group.name) ? 384 : semanticClips.includes(group.name) ? 48 : null));
  return {
    variant: character.variant, loadMilliseconds: character.loadMilliseconds,
    bind: { finite: character.bind.finite, bounds: character.bind.bounds, parts: character.bind.parts },
    assemblyScale: character.prepared.root.scaling.asArray(), assemblyOrigin: character.prepared.root.position.asArray(),
    skeletons: container.skeletons.map(skeleton => ({ name: skeleton.name, bones: skeleton.bones.map(bone => bone.name) })),
    geometry, invalidTargets, clips,
  };
}

function showClip(): void {
  for (const character of loaded) {
    stopAll(character);
    const group = character.container.animationGroups.find(candidate => candidate.name === clipControl.value);
    if (group) {
      group.weight = 1;
      group.start(nativeLoop(group));
      if (!isPlaying) group.pause();
    }
  }
}

function setView(): void {
  const showAll = variantControl.value === "all";
  loaded.forEach((character, index) => {
    character.root.setEnabled(showAll || character.variant === variantControl.value);
    character.root.position.x = showAll ? (index - 1.5) * 1.8 : 0;
  });
  camera.radius = showAll ? 8.4 : 3.8;
  camera.target.set(0, 0.95, 0);
  const selected = loaded.find(character => character.variant === variantControl.value) ?? loaded[0];
  const previous = clipControl.value;
  clipControl.replaceChildren(...(selected?.container.animationGroups ?? []).map(group => {
    const option = document.createElement("option");
    option.value = group.name;
    option.textContent = group.name;
    return option;
  }));
  clipControl.value = selected?.container.animationGroups.some(group => group.name === previous) ? previous : "wait_Hand";
  showClip();
}

function sceneCounts() {
  return { meshes: scene.meshes.length, transformNodes: scene.transformNodes.length, skeletons: scene.skeletons.length, animationGroups: scene.animationGroups.length, materials: scene.materials.length, textures: scene.textures.length };
}

/** Targeted root-translation correction measurements; no model data is changed here. */
async function measureGroundingRepair() {
  const measurements = [];
  for (const character of loaded) {
    status.textContent = `Measuring ${character.variant} grounding at 192 Hz plus native key times…`;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const profile = characterProfiles[character.variant];
    if (!profile) throw new Error(`Missing ${character.variant} profile.`);
    const response = await fetch(profile.resource.url);
    if (!response.ok) throw new Error(`Cannot hash ${character.variant}.`);
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const glbSha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
    const names = repairedClipNames(character.variant);
    const clips = [];
    const root = character.container.transformNodes.find(node => node.name === "bip01");
    if (!root || !(root.parent instanceof TransformNode)) throw new Error("Native bip01 parent transform is missing.");
    for (const name of names) {
      const group = character.container.animationGroups.find(candidate => candidate.name === name);
      if (!group) throw new Error(`${character.variant} has no ${name}.`);
      stopAll(character);
      group.weight = 1;
      group.start(false).pause();
      const frameRate = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
      const duration = (group.to - group.from) / frameRate;
      const rootTrack = group.targetedAnimations.find(target => target.target === root && target.animation.targetProperty === "position");
      if (!rootTrack) throw new Error(`${name} has no native root position track.`);
      const nativeKeyTimes = rootTrack.animation.getKeys().map(key => (key.frame - group.from) / frameRate);
      const times = [...new Set([
        ...Array.from({ length: Math.floor(duration * 192) + 1 }, (_, index) => index / 192),
        ...nativeKeyTimes, duration,
      ])].filter(time => time >= 0 && time <= duration).sort((first, second) => first - second);
      let minWorldY = Infinity;
      let maxWorldY = -Infinity;
      let maxWorldOffset = 0;
      const samples = [];
      for (const time of times) {
        group.goToFrame(group.from + time * frameRate);
        scene.render(false);
        const pose = samplePose(character);
        const minimum = (pose.bounds.min[1] ?? NaN) + character.root.position.y;
        if (!Number.isFinite(minimum)) throw new Error(`${name} has non-finite grounded vertices.`);
        const worldOffset = minimum < -0.002 ? -minimum : 0;
        root.parent.computeWorldMatrix(true);
        const inverseParent = root.parent.getWorldMatrix().clone().invert();
        const localOffset = Vector3.TransformNormal(new Vector3(0, worldOffset, 0), inverseParent);
        const position = root.position.add(localOffset).asArray();
        samples.push({ time, position, worldOffset, minWorldY: minimum });
        minWorldY = Math.min(minWorldY, minimum);
        maxWorldY = Math.max(maxWorldY, minimum);
        maxWorldOffset = Math.max(maxWorldOffset, worldOffset);
      }
      group.stop();
      clips.push({ name, duration, minWorldY, maxWorldY, maxWorldOffset, rootNodeName: root.name, sampleCount: samples.length, samples });
    }
    measurements.push({ variant: character.variant, glbSha256, clips });
  }
  showClip();
  return { schema: 1, sampleRate: 192, penetrationThreshold: 0.002, engineVersion: Engine.Version, createdAt: new Date().toISOString(), variants: measurements };
}

async function inspectIndependence() {
  const original = loaded.find(character => character.variant === "FFighter");
  if (!original) throw new Error("FFighter was not loaded.");
  stopAll(original);
  const originalRun = original.prepared.clips.run;
  originalRun.start(true).pause().goToFrame((originalRun.from + originalRun.to) / 3);
  const beforePose = samplePose(original);
  const beforeCounts = sceneCounts();
  const profile = characterProfiles.FFighter;
  if (!profile) throw new Error("FFighter profile was not registered.");
  const container = await loadCharacterModel(scene, profile.resource.url, new AbortController().signal);
  const root = new TransformNode("Independent inspection instance", scene);
  root.position.x = 5;
  const prepared = prepareCharacterModel(container, root, "independent-instance", profile);
  const attack = prepared.clips.attack;
  attack.start(false).pause().goToFrame((attack.from + attack.to) / 2);
  const secondPose = samplePose({ container, root });
  const afterPose = samplePose(original);
  const result = {
    sharedSkeleton: container.skeletons.some(skeleton => original.container.skeletons.includes(skeleton)),
    sharedAnimationTarget: container.animationGroups.some(group => group.targetedAnimations.some(target => original.container.animationGroups.some(other => other.targetedAnimations.some(otherTarget => target.target === otherTarget.target)))),
    originalPoseChange: maximumVertexDistance(beforePose.positions, afterPose.positions),
    independentPoseDifference: maximumVertexDistance(beforePose.positions, secondPose.positions),
    originalClip: originalRun.name, secondClip: attack.name,
    beforeCounts, afterDisposeCounts: beforeCounts,
  };
  prepared.dispose();
  root.dispose();
  result.afterDisposeCounts = sceneCounts();
  showClip();
  return result;
}

function setBusy(value: boolean): void {
  isBusy = value;
  for (const control of [variantControl, clipControl, playButton, frameControl, frameButton, sampleButton, independentButton, groundingButton]) control.disabled = value;
}

variantControl.addEventListener("change", setView);
clipControl.addEventListener("change", showClip);
frameButton.addEventListener("click", () => {
  isPlaying = false;
  playButton.textContent = "Resume playback";
  showClip();
  for (const character of loaded) {
    const group = character.container.animationGroups.find(candidate => candidate.name === clipControl.value);
    if (group) group.goToFrame(Math.max(group.from, Math.min(group.to, Number(frameControl.value))));
  }
  scene.render(false);
  pausedPose = loaded.filter(character => character.root.isEnabled()).map(character => {
    const pose = samplePose(character);
    return { variant: character.variant, bounds: pose.bounds, parts: pose.parts };
  });
  status.textContent = `${clipControl.value} paused at frame ${frameControl.value}.`;
});
playButton.addEventListener("click", () => {
  isPlaying = !isPlaying;
  playButton.textContent = isPlaying ? "Pause playback" : "Resume playback";
  for (const character of loaded) {
    for (const group of character.container.animationGroups) {
      if (group.name === clipControl.value) {
        if (isPlaying) group.restart(); else group.pause();
      }
    }
  }
});
sampleButton.addEventListener("click", () => {
  void (async () => {
    setBusy(true);
    audit = [];
    for (const character of loaded) {
      status.textContent = `Sampling ${character.variant}: repaired clips at 384 Hz, other semantic clips at 48 Hz, other clips at three poses…`;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      audit.push(inspectCharacter(character));
    }
    showClip();
    status.textContent = "Skinning inspection complete: all four variants sampled.";
    setBusy(false);
  })().catch(error => { status.textContent = String(error); setBusy(false); console.error(error); });
});
independentButton.addEventListener("click", () => {
  setBusy(true);
  void inspectIndependence().then(result => {
    independence = result;
    status.textContent = "Independent instance and disposal inspection complete.";
  }).catch(error => { status.textContent = String(error); console.error(error); }).finally(() => setBusy(false));
});
groundingButton.addEventListener("click", () => {
  setBusy(true);
  void measureGroundingRepair().then(result => {
    groundingCorrections = result;
    status.textContent = "Targeted grounding measurements complete.";
  }).catch(error => { status.textContent = String(error); console.error(error); }).finally(() => setBusy(false));
});

engine.runRenderLoop(() => {
  const now = performance.now();
  if (ready && !isBusy && frameTimes.length < 600) frameTimes.push(now - lastFrameTime);
  lastFrameTime = now;
  scene.render();
  for (const character of loaded) {
    character.label.hidden = !character.root.isEnabled();
    if (character.label.hidden) continue;
    const projected = Vector3.Project(character.root.position.add(new Vector3(0, 2.0, 0)), Matrix.IdentityReadOnly, scene.getTransformMatrix(), camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    character.label.style.left = `${projected.x * canvas.clientWidth / engine.getRenderWidth()}px`;
    character.label.style.top = `${projected.y * canvas.clientHeight / engine.getRenderHeight()}px`;
  }
});
window.addEventListener("resize", () => engine.resize());
window.addEventListener("pagehide", () => { scene.dispose(); engine.dispose(); });

function snapshot() {
  const sortedFrames = [...frameTimes].sort((first, second) => first - second);
  return {
    ready, isBusy, variant: variantControl.value, clip: clipControl.value, isPlaying,
    babylonVersion: Engine.Version, readyMilliseconds,
    characters: loaded.map(character => ({
      variant: character.variant, loadMilliseconds: character.loadMilliseconds,
      meshCount: geometryMeshes(character.container).length, skeletonCount: character.container.skeletons.length,
      animationCount: character.container.animationGroups.length,
      activeClips: character.container.animationGroups.filter(group => group.isStarted).map(group => ({ name: group.name, frame: group.getCurrentFrame(), isPlaying: group.isPlaying })),
    })),
    frameTiming: { samples: sortedFrames.length, medianMilliseconds: sortedFrames[Math.floor(sortedFrames.length / 2)] ?? null, p95Milliseconds: sortedFrames[Math.floor(sortedFrames.length * 0.95)] ?? null },
    resources: performance.getEntriesByType("resource").filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming && entry.name.endsWith(".glb")).map(entry => ({ url: entry.name, durationMilliseconds: entry.duration, transferBytes: entry.transferSize, decodedBytes: entry.decodedBodySize })),
    sceneCounts: sceneCounts(), audit, independence, groundingCorrections, pausedPose,
  };
}

declare global { interface Window { __assetInspection?: { snapshot: typeof snapshot } } }
window.__assetInspection = { snapshot };
export type AssetInspectionSnapshot = ReturnType<typeof snapshot>;

void (async () => {
  for (const variant of variants) {
    const profile = characterProfiles[variant];
    if (!profile) throw new Error(`${variant} profile is missing.`);
    const start = performance.now();
    const container = await loadCharacterModel(scene, profile.resource.url, new AbortController().signal);
    const root = new TransformNode(`${variant}:inspection`, scene);
    const prepared = prepareCharacterModel(container, root, variant, profile);
    stopAll({ container });
    const bind = samplePose({ container, root });
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = variant;
    labels.append(label);
    loaded.push({ variant, container, root, prepared, label, bind, loadMilliseconds: performance.now() - start });
  }
  await scene.whenReadyAsync();
  setView();
  readyMilliseconds = performance.now() - loadStart;
  ready = true;
  setBusy(false);
  status.textContent = "Four textured characters ready.";
})().catch(error => { status.textContent = String(error); console.error(error); });
