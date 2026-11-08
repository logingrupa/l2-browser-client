import { expect, test, type Page } from "@playwright/test";
import assertWithoutTraceStep from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";

const float32RendererToleranceMetres = .0001;
const sceneDirectory = resolve("assets/native-world.scene");
const authoredAvailable = existsSync(sceneDirectory);
const evidence = resolve(process.env.NATIVE_EDITOR_EVIDENCE ?? "artifacts/native-parity/editor/world-import/browser");
const starterMaterial = "MFighter.UpBody.MFighter_m001_t02_u";
const leatherMaterial = "MFighter.UpBody.MFighter_m001_t04_u";
const patchIdentity = {
  id: "interlude:20_20.TerrainInfo0.TerrainSector247", sourceTerrain: "20_20.TerrainInfo0",
  sourceSector: "20_20.TerrainInfo0.TerrainSector247", sourceMapSha256: "1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4",
  gridBounds: [112, 240, 128, 255],
  model: { file: "terrain247.glb", bytes: 94512, sha256: "cee7f0f6eba0b62669cf3c1b2241c7671fa567ccbdfce2813633224fb238820a" },
  source: { file: "terrain247.json", bytes: 94169, sha256: "d104d12169b427238103689d7d37dfcca220bfe0702ec626e127a8cd064e9c2b" },
};
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const read = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSlice) throw new Error("Authored native slice is not ready.");
  return window.__nativeSlice.snapshot();
});
type Snapshot = Awaited<ReturnType<typeof read>>;
type AuthoredWorld = NonNullable<Snapshot["world"]> & { authored: true; placementTransformEdits: string[] };
const entity = async (page: Page) => (await read(page)).entities.find(item => item.id === "local-player")!;

interface GraphicsProbe { contexts: string[]; devices: GPUDevice[]; errors: string[]; }
declare global { interface Window { __nativeEditorGraphics?: GraphicsProbe; } }
async function observeGraphics(page: Page) {
  await page.addInitScript(() => {
    const probe: GraphicsProbe = window.__nativeEditorGraphics = { contexts: [], devices: [], errors: [] };
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true,
      value: function (this: HTMLCanvasElement, kind: string, ...options: unknown[]) {
        if (this.id === "canvas") probe.contexts.push(kind);
        return Reflect.apply(getContext, this, [kind, ...options]);
      } });
    if (typeof GPUAdapter === "undefined") return;
    const requestDevice = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (descriptor) {
      const device = await requestDevice.call(this, descriptor);
      probe.devices.push(device);
      device.addEventListener("uncapturederror", event => probe.errors.push(event.error.message));
      return device;
    };
  });
}
async function assertGraphics(page: Page) {
  const graphics = await page.evaluate(async () => {
    const probe = window.__nativeEditorGraphics!;
    await Promise.all(probe.devices.map(device => device.queue.onSubmittedWorkDone()));
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
    return { engine: canvas.dataset.engine, contexts: probe.contexts, devices: probe.devices.length, errors: probe.errors,
      context: canvas.dataset.engine === "WebGPU" && Boolean(canvas.getContext("webgpu")), readyFrame: Number(canvas.dataset.readyFrame ?? 0) };
  });
  expect(graphics.engine).toBe("WebGPU"); expect(graphics.context).toBe(true); expect(graphics.devices).toBeGreaterThan(0);
  expect(graphics.contexts).toContain("webgpu"); expect(graphics.contexts.some(kind => /webgl/i.test(kind))).toBe(false);
  expect(graphics.readyFrame).toBeGreaterThan(0); expect(graphics.errors).toEqual([]);
  return graphics;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a saved Editor object.");
  return value as Record<string, unknown>;
}
function objects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("Expected a saved Editor object array.");
  return value.map(object);
}
function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected a finite saved Editor number.");
  return value;
}
function numbers(value: unknown, length: number): number[] {
  if (!Array.isArray(value)) throw new Error("Expected saved Editor numeric data.");
  expect(value).toHaveLength(length);
  return value.map(finite);
}
function setting<T extends string | boolean | number>(values: Record<string, unknown>, name: string, fallback: T): T {
  if (!(name in values)) return fallback;
  const saved = object(values[name]);
  expect(saved.type).toBe(typeof fallback); expect(typeof saved.value).toBe(typeof fallback);
  return saved.value as T;
}
async function jsonFiles(directory: string) {
  return Promise.all((await readdir(directory)).filter(file => file.endsWith(".json")).sort().map(async file => ({
    file: resolve(directory, file), data: object(JSON.parse(await readFile(resolve(directory, file), "utf8"))),
  })));
}
async function sceneReceipt() {
  async function files(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)]))).flat();
  }
  const entries = await Promise.all((await files(sceneDirectory)).sort().map(async file => {
    const bytes = await readFile(file);
    return { path: relative(sceneDirectory, file).split(sep).join("/"), bytes: bytes.length, sha256: hash(bytes) };
  }));
  const recoveryBytes = await readFile(`${sceneDirectory}.native-editor-channels.json`);
  const recovery = { bytes: recoveryBytes.length, sha256: hash(recoveryBytes) };
  return { sha256: hash(JSON.stringify({ entries, recovery })), files: entries, recovery };
}

async function savedUv2(meshFiles: Awaited<ReturnType<typeof jsonFiles>>) {
  const checked: { mesh: unknown; vertices: number; sha256: string; file: string }[] = [];
  for (const document of meshFiles) {
    const geometry = document.data.geometries === undefined ? [] : objects(object(document.data.geometries).vertexData ?? []);
    for (const mesh of [...objects(document.data.meshes), ...geometry]) {
      const binary = mesh._binaryInfo === undefined ? undefined : object(mesh._binaryInfo);
      if (binary?.uvs2AttrDesc !== undefined) {
        const uv = object(binary.uvs2AttrDesc), position = object(binary.positionsAttrDesc);
        expect(uv.stride).toBe(2); expect(position.stride).toBe(3); expect(uv.dataType).toBe(1);
        const count = finite(uv.count), vertices = finite(position.count) / 3, offset = finite(uv.offset);
        expect(Number.isInteger(vertices)).toBe(true); expect(vertices).toBeGreaterThan(0);
        expect(count).toBe(vertices * 2); expect(Number.isInteger(offset)).toBe(true); expect(offset).toBeGreaterThanOrEqual(0);
        if (typeof mesh.delayLoadingFile !== "string") throw new Error("Saved UV2 binary path is missing.");
        const file = resolve(mesh.delayLoadingFile);
        expect(relative(sceneDirectory, file).startsWith(".." + sep)).toBe(false);
        const bytes = await readFile(file); expect(offset + count * 4).toBeLessThanOrEqual(bytes.length);
        for (let index = 0; index < count; index++) expect(Number.isFinite(bytes.readFloatLE(offset + index * 4))).toBe(true);
        checked.push({ mesh: mesh.id, vertices, sha256: hash(bytes.subarray(offset, offset + count * 4)), file });
      } else if (mesh.uvs2 !== undefined) {
        if (!Array.isArray(mesh.positions) || !Array.isArray(mesh.uvs2)) throw new Error("Saved inline UV2 geometry is invalid.");
        const vertices = mesh.positions.length / 3;
        expect(Number.isInteger(vertices)).toBe(true); expect(vertices).toBeGreaterThan(0);
        const uv = numbers(mesh.uvs2, vertices * 2);
        checked.push({ mesh: mesh.id, vertices, sha256: hash(JSON.stringify(uv)), file: document.file });
      }
    }
  }
  expect(checked.length, "The imported terrain must retain its second UV channel.").toBeGreaterThan(0);
  return checked;
}

async function terrainState(manifest: Record<string, unknown>, manifestPath: string, meshFiles: Awaited<ReturnType<typeof jsonFiles>>) {
  expect(manifest.terrainPatches).toEqual([patchIdentity]);
  const sourceRoot = resolve(manifestPath, "../../map-section");
  const resource = async (entry: Record<string, unknown>) => {
    const bytes = await readFile(resolve(sourceRoot, String(entry.file)));
    expect(bytes.length).toBe(entry.bytes); expect(hash(bytes)).toBe(entry.sha256); return bytes;
  };
  const geometry = async (entry: Record<string, unknown>) => {
    const bytes = await resource(entry);
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67); expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length); expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
    const jsonLength = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
    const primitive = gltf.meshes[0].primitives[0], position = gltf.accessors[primitive.attributes.POSITION];
    expect(primitive.attributes).toEqual({ POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TEXCOORD_1: 3 });
    const uv2 = gltf.accessors[primitive.attributes.TEXCOORD_1], view = gltf.bufferViews[uv2.bufferView];
    expect(bytes.readUInt32LE(24 + jsonLength)).toBe(0x004e4942);
    expect(uv2.componentType).toBe(5126); expect(uv2.type).toBe("VEC2"); expect(view.byteStride ?? 8).toBe(8);
    const offset = 28 + jsonLength + (view.byteOffset ?? 0) + (uv2.byteOffset ?? 0);
    return { vertices: finite(position.count), triangles: finite(gltf.accessors[primitive.indices].count) / 3,
      minimum: numbers(position.min, 3), maximum: numbers(position.max, 3), uv2Sha256: hash(bytes.subarray(offset, offset + uv2.count * 8)) };
  };
  const baseResource = object(manifest.terrain);
  expect(baseResource).toMatchObject({ file: "terrain.glb", bytes: 376928,
    sha256: "39417edb0294885ef6bd4107c85a917f6dcc4dc2985d11393bb41afa2e63a724" });
  const base = await geometry(baseResource), patch = await geometry(patchIdentity.model);
  expect(base).toMatchObject({ vertices: 2352, triangles: 4512,
    minimum: [81.91999816894531, -36.090675354003906, 921.5999755859375], maximum: [143.36000061035156, -25.593175888061523, 981.760009765625] });
  expect(patch).toMatchObject({ vertices: 272, triangles: 480,
    minimum: [143.36000061035156, -31.352550506591797, 962.5599975585938], maximum: [163.83999633789062, -17.38458251953125, 981.760009765625] });
  await resource(patchIdentity.source);
  const terrains = meshFiles.flatMap(document => objects(document.data.meshes)).filter(mesh => mesh.metadata && object(mesh.metadata).worldTerrain === true);
  expect(terrains).toHaveLength(2);
  const patches = terrains.filter(mesh => object(mesh.metadata).nativeTerrainPatch !== undefined);
  const bases = terrains.filter(mesh => object(mesh.metadata).nativeTerrainPatch === undefined);
  expect(patches).toHaveLength(1); expect(bases).toHaveLength(1);
  expect(object(patches[0]!.metadata).nativeTerrainPatch).toEqual(patchIdentity);
  expect(object(patches[0]!.metadata).worldSupportsWalking).toBe(true);
  expect(object(object(bases[0]!.metadata).nativeEditorSource).originalId).toBe(patchIdentity.sourceTerrain);
  for (const [mesh, source] of [[bases[0]!, base], [patches[0]!, patch]] as const) {
    const binary = object(mesh._binaryInfo);
    expect(object(binary.positionsAttrDesc).count).toBe(source.vertices * 3); expect(object(binary.indicesAttrDesc).count).toBe(source.triangles * 3);
    expect(mesh.boundingBoxMinimum).toEqual(source.minimum); expect(mesh.boundingBoxMaximum).toEqual(source.maximum);
  }
  const uv2 = await savedUv2(meshFiles);
  for (const [mesh, source] of [[bases[0]!, base], [patches[0]!, patch]] as const) {
    expect(uv2.filter(channel => channel.mesh === mesh.id)).toMatchObject([{ vertices: source.vertices, sha256: source.uv2Sha256 }]);
  }
  return { base, patch, uv2, triangles: base.triangles + patch.triangles,
    minimum: base.minimum.map((value, index) => Math.min(value, patch.minimum[index]!)),
    maximum: base.maximum.map((value, index) => Math.max(value, patch.maximum[index]!)) };
}

async function authoredState() {
  const receipt = await sceneReceipt();
  const [nodes, cameras, meshes, configText, catalogText] = await Promise.all([
    jsonFiles(resolve(sceneDirectory, "nodes")), jsonFiles(resolve(sceneDirectory, "cameras")), jsonFiles(resolve(sceneDirectory, "meshes")),
    readFile(resolve(sceneDirectory, "config.json"), "utf8"), readFile(resolve("public/l2/catalog.json"), "utf8"),
  ]);
  const config = object(JSON.parse(configText));
  const scripts = objects(object(config.metadata).scripts).filter(script => script._id === "native-parity-runtime" && script.key === "scripts/nativeParity.ts");
  expect(scripts).toHaveLength(1); expect(scripts[0]!.enabled).toBe(true);
  const values = object(scripts[0]!.values);
  const tint = values.materialTint === undefined ? undefined : object(values.materialTint);
  if (tint) expect(tint.type).toBe("vector3");
  const settings = {
    leatherShirt: setting(values, "leatherShirt", false), fighterIdle: setting(values, "fighterIdle", "Wait_Hand_MFighter"),
    fighterRun: setting(values, "fighterRun", "Run_Hand_MFighter"), fighterAttack: setting(values, "fighterAttack", "Atk01_Hand_MFighter"),
    fighterDeath: setting(values, "fighterDeath", "Death_MFighter"), materialOverrideEnabled: setting(values, "materialOverrideEnabled", false),
    materialEntityId: setting(values, "materialEntityId", "local-player"), materialSource: setting(values, "materialSource", leatherMaterial),
    materialTint: tint ? numbers(tint.value, 3) : [1, 1, 1], materialRoughness: finite(setting(values, "materialRoughness", 1)),
  };
  const selectedCamera = cameras.filter(camera => camera.data.id === "World camera" && camera.data.name === "World camera");
  expect(selectedCamera).toHaveLength(1);
  const camera = selectedCamera[0]!.data;
  const roots = nodes.filter(node => node.data.metadata && object(node.data.metadata).nativeWorldRoot !== undefined);
  expect(roots).toHaveLength(1);
  const root = roots[0]!.data, marker = object(object(root.metadata).nativeWorldRoot);
  expect(marker.schemaVersion).toBe(1); expect(marker.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  const manifestPath = resolve(`public/l2/maps/${String(marker.manifestSha256)}/map-section-runtime/manifest.json`);
  const manifestBytes = await readFile(manifestPath);
  const manifestAfterEditorJsonRoundTrip = object(JSON.parse(JSON.stringify(JSON.parse(manifestBytes.toString("utf8")))));
  expect(hash(manifestBytes)).toBe(marker.manifestSha256); expect(marker.manifest).toEqual(manifestAfterEditorJsonRoundTrip);
  const terrain = await terrainState(manifestAfterEditorJsonRoundTrip, manifestPath, meshes);
  expect(objects(manifestAfterEditorJsonRoundTrip.models)).toHaveLength(62);
  const sources = objects(manifestAfterEditorJsonRoundTrip.placements); expect(sources).toHaveLength(157);
  expect(sources.filter(source => source.id === "interlude:20_20.StaticMeshActor3703"))
    .toMatchObject([{ modelId: "interlude:dion_tree_s.red_mt.dion_excute_tree1" }]);
  const saved = nodes.filter(node => node.data.metadata && object(node.data.metadata).nativePlacement !== undefined);
  expect(saved).toHaveLength(sources.length);
  const placements = sources.map(source => {
    const matches = saved.filter(node => object(object(node.data.metadata).nativePlacement).id === source.id);
    expect(matches).toHaveLength(1);
    const node = matches[0]!.data, metadata = object(node.metadata);
    expect(metadata.nativePlacement).toEqual(source);
    const onlyTranslationsSupportedMessage = `${String(source.id)}: only authored translations are supported`;
    expect(node.rotation ?? [0, 0, 0], onlyTranslationsSupportedMessage).toEqual([0, 0, 0]); expect(node.scaling, onlyTranslationsSupportedMessage).toEqual([1, 1, 1]);
    expect(node.rotationQuaternion ?? [0, 0, 0, 1], onlyTranslationsSupportedMessage).toEqual([0, 0, 0, 1]);
    expect(node.parentId === root.id || metadata.parentId === root.uniqueId).toBe(true);
    const position = numbers(node.position, 3), sourceMatrix = numbers(source.matrix, 16), localMatrix = numbers(node.localMatrix, 16);
    expect(localMatrix).toEqual(sourceMatrix.map(Math.fround));
    const worldMatrix = localMatrix.map((value, index) => Math.fround(value + (index >= 12 && index <= 14 ? position[index - 12]! : 0)));
    return { id: String(source.id), sourceMesh: source.sourceMesh, modelId: source.modelId, sourceMatrix, worldMatrix, position };
  });
  const models = objects(object(JSON.parse(catalogText)).models);
  const asset = (id: string) => { const found = models.filter(model => model.id === id); expect(found).toHaveLength(1); return found[0]!.assetId; };
  return { receipt, settings, camera: { alpha: finite(camera.alpha), beta: finite(camera.beta), radius: finite(camera.radius) },
    manifestSha256: marker.manifestSha256, placements, terrain, uv2: terrain.uv2,
    actors: { fighter: asset("human-male-fighter:0"), armor: asset("fighter-equipment:0"), musveren: asset("musveren:0") } };
}
type AuthoredState = Awaited<ReturnType<typeof authoredState>>;

function observe(page: Page) {
  const errors: string[] = [], mapGlbRequests: string[] = [], actorArchives: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (/^\/l2\/maps\/.*\.glb$/i.test(path)) mapGlbRequests.push(path);
    if (/^\/l2\/[^/]+\/asset\.l2asset$/.test(path)) actorArchives.push(path);
  });
  return { errors, mapGlbRequests, actorArchives };
}
function assertWorld(snapshot: Snapshot, authored: AuthoredState) {
  const world = snapshot.world as AuthoredWorld;
  expect(snapshot.worldFailure).toBeNull(); expect(snapshot.nativeTerrain).toBe("source-section-loaded");
  expect(world).toMatchObject({ authored: true, disposed: false, manifestSha256: authored.manifestSha256,
    placementCount: 157, modelCount: 62, terrainTriangles: authored.terrain.triangles, finiteBounds: true, texturesReady: true,
    terrainMaterial: "editor-authored-source-materials", materialFailure: null, visualParity: "unverified", collisionVerified: false });
  expect(world.textureCount).toBeGreaterThan(0); expect(world.placements).toHaveLength(157);
  expect(new Set(world.placements.map(placement => placement.id)).size).toBe(157);
  expect(world.terrainBounds).not.toBeNull();
  authored.terrain.minimum.forEach((value, index) => expect(Math.abs(world.terrainBounds!.minimum[index]! - value)).toBeLessThan(float32RendererToleranceMetres));
  authored.terrain.maximum.forEach((value, index) => expect(Math.abs(world.terrainBounds!.maximum[index]! - value)).toBeLessThan(float32RendererToleranceMetres));
  for (const expected of authored.placements) {
    const placement = world.placements.find(item => item.id === expected.id)!;
    assertWithoutTraceStep.ok(placement, `Missing placement ${expected.id}`);
    assertWithoutTraceStep.deepStrictEqual(placement.sourceMatrix, expected.sourceMatrix, expected.id);
    assertWithoutTraceStep.strictEqual(placement.sourceMesh, expected.sourceMesh, expected.id);
    assertWithoutTraceStep.strictEqual(placement.modelId, expected.modelId, expected.id);
    assertWithoutTraceStep.ok(placement.meshes.length > 0, `${expected.id}: geometry`);
    assertWithoutTraceStep.ok(placement.meshes.every(mesh => mesh.material !== null), `${expected.id}: materials`);
    expected.worldMatrix.forEach((value, index) => assertWithoutTraceStep.ok(Math.abs(placement.worldMatrix[index]! - value) < float32RendererToleranceMetres,
      `${expected.id}: matrix[${index}] expected ${value}, received ${placement.worldMatrix[index]}`));
  }
  const edited = authored.placements.filter(placement => placement.sourceMatrix.some((value, index) => Math.abs(Math.fround(value) - placement.worldMatrix[index]!) > .00001)).map(placement => placement.id);
  expect([...world.placementTransformEdits].sort()).toEqual(edited.sort());
}
function assertActors(snapshot: Snapshot, authored: AuthoredState) {
  const fighter = snapshot.entities.find(item => item.id === "local-player")!, musveren = snapshot.entities.find(item => item.id === "native-musveren")!;
  expect(snapshot.entities).toHaveLength(2); expect(snapshot.entities.every(item => item.hasNativeModel)).toBe(true);
  expect(fighter.modelId).toBe(authored.actors.fighter); expect(musveren.modelId).toBe(authored.actors.musveren);
  expect(fighter.skeletons.map(skeleton => skeleton.bones).sort((a, b) => a - b)).toEqual([70, 70, 70, 70, 1, 1, 1, ...(authored.settings.leatherShirt ? [70] : [])].sort((a, b) => a - b));
  expect(musveren.skeletons.map(skeleton => skeleton.bones)).toEqual([49]);
  expect(fighter.parts).toHaveLength(authored.settings.leatherShirt ? 8 : 7); expect(fighter.parts.filter(part => part.enabled)).toHaveLength(7);
  expect(fighter.parts.find(part => part.material === starterMaterial)?.enabled).toBe(!authored.settings.leatherShirt);
  expect(fighter.parts.some(part => part.material === leatherMaterial && part.enabled)).toBe(authored.settings.leatherShirt);
  expect(snapshot.skinMeshes).toHaveLength(authored.settings.leatherShirt ? 10 : 9);
  expect(snapshot.skinMeshes.every(mesh => object(mesh).applied === true && object(mesh).normalized === false)).toBe(true);
}
async function assertMaterial(page: Page, authored: AuthoredState) {
  const settings = authored.settings;
  const actor = (await read(page)).entities.find(item => item.id === settings.materialEntityId);
  const matched = settings.materialOverrideEnabled ? actor?.parts.filter(part => part.enabled && part.material === settings.materialSource).length ?? 0 : 0;
  await expect.poll(async () => (await read(page)).materialOverride?.matchedMeshes).toBe(matched);
  const override = (await read(page)).materialOverride!;
  expect(override).toBeDefined(); expect(override.failure).toBeNull(); expect(override.enabled).toBe(settings.materialOverrideEnabled);
  if (settings.materialOverrideEnabled) {
    expect(override.entityId).toBe(settings.materialEntityId); expect(override.sourceMaterial).toBe(settings.materialSource);
    expect(override.tint).toEqual(settings.materialTint); expect(override.roughness).toBe(settings.materialRoughness);
    for (const material of override.materials) {
      expect(material.roughness).toBe(settings.materialRoughness);
      material.albedo.forEach((channel, index) => expect(channel).toBeCloseTo(material.sourceAlbedo[index]! * settings.materialTint[index]!, 10));
    }
  }
}
async function ready(page: Page, authored: AuthoredState) {
  await observeGraphics(page);
  await page.goto("/?authored=1");
  await expect(page.locator("#loading")).toHaveCount(0, { timeout: 120_000 });
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.getByTestId("entity-count")).toHaveText("2", { timeout: 120_000 });
  await expect.poll(async () => (await read(page)).entities.filter(item => item.hasNativeModel).length, { timeout: 90_000 }).toBe(2);
  await expect.poll(async () => {
    const fighter = await entity(page);
    return { parts: fighter.parts.length, enabled: fighter.parts.filter(part => part.enabled).length,
      starter: fighter.parts.find(part => part.material === starterMaterial)?.enabled,
      leather: fighter.parts.some(part => part.material === leatherMaterial && part.enabled) };
  }, { timeout: 90_000 }).toEqual({ parts: authored.settings.leatherShirt ? 8 : 7, enabled: 7, starter: !authored.settings.leatherShirt, leather: authored.settings.leatherShirt });
  await expect.poll(async () => (await entity(page)).playback?.activeClip).toBe(authored.settings.fighterIdle);
  expect((await read(page)).worldFailure).toBeNull();
  await expect.poll(async () => (await read(page)).world?.texturesReady, { timeout: 90_000 }).toBe(true);
  const snapshot = await read(page);
  expect(snapshot.camera?.alpha).toBeCloseTo(-authored.camera.alpha, 10);
  expect(snapshot.camera?.beta).toBeCloseTo(authored.camera.beta, 10); expect(snapshot.camera?.radius).toBeCloseTo(authored.camera.radius, 10);
  assertWorld(snapshot, authored); assertActors(snapshot, authored); await assertMaterial(page, authored);
  await assertGraphics(page);
  return snapshot;
}
async function assertPatchDestination(page: Page, authored: AuthoredState) {
  const target = { x: 146.17673828125, y: -26.05546082735062, z: 975.437265625 };
  expect(target.x).toBeGreaterThan(authored.terrain.base.maximum[0]!);
  expect(target.x).toBeLessThan(authored.terrain.patch.maximum[0]!);
  await page.evaluate(() => window.__nativeSlice!.dispatch({ type: "set-paused", isPaused: true }));
  const before = await entity(page);
  expect(before.animation).toBe("idle");
  try {
    await page.evaluate(position => window.__nativeSlice!.dispatch({ type: "move-local", position }), target);
    await expect.poll(async () => (await entity(page)).animation).toBe("run");
    const accepted = await entity(page);
    expect(accepted.authoritativePosition).toEqual(before.authoritativePosition);
    await page.evaluate(() => {
      window.__nativeSlice!.dispatch({ type: "set-animation", animation: "idle" });
      window.__nativeSlice!.dispatch({ type: "move-local", position: { x: 1e6, y: 0, z: 1e6 } });
    });
    await expect.poll(async () => (await entity(page)).animation).toBe("idle");
    const rejected = await entity(page);
    expect(rejected.authoritativePosition).toEqual(before.authoritativePosition);
    return { target, before, accepted, rejected,
      scope: "Paused destination support outside the old terrain edge; not path traversal or native collision parity." };
  } finally {
    await page.evaluate(() => {
      window.__nativeSlice!.dispatch({ type: "set-animation", animation: "idle" });
      window.__nativeSlice!.dispatch({ type: "set-paused", isPaused: false });
    });
    await expect.poll(async () => (await entity(page)).playback?.activeClip).toBe(authored.settings.fighterIdle);
  }
}
async function verifyUnchanged(authored: AuthoredState, name: string) {
  const after = await sceneReceipt();
  await mkdir(evidence, { recursive: true });
  await writeFile(resolve(evidence, `${name}-scene-hashes.json`), JSON.stringify({ before: authored.receipt, after }, null, 2));
  expect(after, "Browser checks must not alter the authored Editor scene.").toEqual(authored.receipt);
}

test("Editor world retains saved placements, native actors, material settings and camera on desktop", async ({ page }) => {
  test.skip(!authoredAvailable, "assets/native-world.scene has not been authored.");
  test.setTimeout(240_000);
  const authored = await authoredState(), observed = observe(page);
  try {
    await page.setViewportSize(desktopViewport);
    const initial = await ready(page, authored);
    const patchDestination = await assertPatchDestination(page, authored);
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, "native-editor-desktop.png") });
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect.poll(async () => (await entity(page)).playback?.activeClip).toBe(authored.settings.fighterRun);
    const pose = (await entity(page)).pose.flat();
    await expect.poll(async () => (await entity(page)).pose.flat().reduce((sum, value, index) => sum + Math.abs(value - (pose[index] ?? value)), 0)).toBeGreaterThan(.1);
    await page.getByTestId("dev-sheet-toggle").click();
    await page.getByTestId("dev-tab-general").click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Attack", exact: true }).click();
    await expect.poll(async () => (await entity(page)).playback?.activeClip).toBe(authored.settings.fighterAttack);
    await page.evaluate(() => window.__nativeSlice!.dispatch({ type: "set-health", entityId: "local-player", health: 0 }));
    await expect.poll(async () => (await entity(page)).playback?.activeClip).toBe(authored.settings.fighterDeath);
    await page.evaluate(() => window.__nativeSlice!.dispatch({ type: "set-health", entityId: "local-player", health: 100 }));
    await page.getByRole("button", { name: "Idle", exact: true }).click();
    await expect.poll(async () => (await entity(page)).playback?.activeClip).toBe(authored.settings.fighterIdle);
    await page.getByTestId("dev-tab-world").click();
    await page.getByRole("button", { name: "Frame world", exact: true }).click();
    await page.getByTestId("dev-sheet-toggle").click();
    await page.screenshot({ path: resolve(evidence, "native-editor-wide.png") });
    await page.getByTestId("dev-sheet-toggle").click();
    await page.getByRole("button", { name: "Follow fighter", exact: true }).click();
    expect((await read(page)).camera?.radius).toBeCloseTo(authored.camera.radius, 10);
    const final = await read(page); assertWorld(final, authored); assertActors(final, authored); await assertMaterial(page, authored);
    expect(observed.actorArchives.length).toBeGreaterThan(0); expect(observed.mapGlbRequests).toEqual([]); expect(observed.errors).toEqual([]);
    const graphics = await assertGraphics(page);
    await writeFile(resolve(evidence, "native-editor-desktop.json"), JSON.stringify({ authored, initial, final, patchDestination, graphics, ...observed,
      scope: "WebGPU functional check and saved UV2 validation; not native visual parity or a performance benchmark." }, null, 2));
  } finally { await verifyUnchanged(authored, "desktop"); }
});

test.describe("Touch authoring", () => {
test.use(landscapePhone);

test("Editor world retains the saved native scene at a mobile viewport", async ({ page }) => {
  test.skip(!authoredAvailable, "assets/native-world.scene has not been authored.");
  test.setTimeout(180_000);
  const authored = await authoredState();
  const observed = observe(page);
  try {
    const initial = await ready(page, authored);
    const patchDestination = await assertPatchDestination(page, authored);
    await page.getByRole("button", { name: "Run", exact: true }).tap();
    await expect.poll(async () => (await entity(page)).playback?.activeClip).toBe(authored.settings.fighterRun);
    await page.getByTestId("dev-sheet-toggle").tap();
    await page.getByRole("button", { name: "Idle", exact: true }).tap();
    await expect.poll(async () => (await entity(page)).playback?.activeClip).toBe(authored.settings.fighterIdle);
    await page.getByTestId("dev-tab-general").tap();
    await page.getByRole("button", { name: "Pause", exact: true }).tap();
    await page.getByTestId("dev-sheet-toggle").tap();
    await page.getByRole("button", { name: "Select Human male fighter", exact: true }).tap();
    await expect(page.getByTestId("target-name")).toHaveText("Human male fighter");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(landscapePhone.viewport.width);
    const final = await read(page); assertWorld(final, authored); assertActors(final, authored); await assertMaterial(page, authored);
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, "native-editor-mobile.png") });
    await expectNoHorizontalScrollOnPortraitPhone(page);
    expect(observed.actorArchives.length).toBeGreaterThan(0); expect(observed.mapGlbRequests).toEqual([]); expect(observed.errors).toEqual([]);
    const graphics = await assertGraphics(page);
    await writeFile(resolve(evidence, "native-editor-mobile.json"), JSON.stringify({ authored, initial, final, patchDestination, graphics, ...observed,
      scope: "Touch emulation and WebGPU functional check; not physical mobile performance or native visual parity." }, null, 2));
  } finally { await verifyUnchanged(authored, "mobile"); }
});
});
