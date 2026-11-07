import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const staged = existsSync(resolve("public/l2/catalog.json"));
const evidence = resolve(process.env.NATIVE_SLICE_EVIDENCE ?? "artifacts/native-parity/browser");
const read = (page: Page) => page.evaluate(() => {
  if (!window.__nativeSlice) throw new Error("Native slice is not ready.");
  return window.__nativeSlice.snapshot();
});
const entity = async (page: Page, id = "local-player") => (await read(page)).entities.find(item => item.id === id)!;
const starterMaterial = "MFighter.UpBody.MFighter_m001_t02_u";
const leatherMaterial = "MFighter.UpBody.MFighter_m001_t04_u";
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected an authored object.");
  return value as Record<string, unknown>;
}
function objects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("Expected an authored object array.");
  return value.map(object);
}
function setting(values: Record<string, unknown>, name: string, fallback: string): string;
function setting(values: Record<string, unknown>, name: string, fallback: boolean): boolean;
function setting(values: Record<string, unknown>, name: string, fallback: string | boolean): string | boolean {
  if (!(name in values)) return fallback;
  const saved = object(values[name]);
  if (saved.type !== typeof fallback || typeof saved.value !== typeof fallback) throw new Error(`Invalid authored ${name}.`);
  return saved.value as string | boolean;
}
function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected a finite authored camera value.");
  return value;
}
interface SourceRig { modelSha256: string; skeletonBones: number[]; skinMeshes: number; clips: string[] }
async function authoredState() {
  const configPath = resolve("assets/native-parity.scene/config.json");
  const configText = await readFile(configPath, "utf8"), config = object(JSON.parse(configText));
  const attached = objects(object(config.metadata).scripts).filter(script => script._id === "native-parity-runtime" && script.key === "scripts/nativeParity.ts");
  expect(attached).toHaveLength(1); expect(attached[0]!.enabled).toBe(true);
  const values = object(attached[0]!.values);
  // Missing overrides retain the actual script defaults; explicit typed Editor
  // values must survive packing and runtime initialization unchanged.
  const settings = {
    leatherShirt: setting(values, "leatherShirt", false),
    fighterIdle: setting(values, "fighterIdle", "Wait_Hand_MFighter"),
    fighterRun: setting(values, "fighterRun", "Run_Hand_MFighter"),
    fighterAttack: setting(values, "fighterAttack", "Atk01_Hand_MFighter"),
    materialOverrideEnabled: setting(values, "materialOverrideEnabled", false),
    materialEntityId: setting(values, "materialEntityId", "local-player"),
    materialSource: setting(values, "materialSource", leatherMaterial),
    materialTint: [1, 1, 1],
    materialRoughness: 1,
  };
  if (values.materialTint !== undefined) {
    const tint = object(values.materialTint);
    expect(tint.type).toBe("vector3"); expect(Array.isArray(tint.value)).toBe(true);
    settings.materialTint = (tint.value as unknown[]).map(finite);
    expect(settings.materialTint).toHaveLength(3);
  }
  if (values.materialRoughness !== undefined) {
    const roughness = object(values.materialRoughness); expect(roughness.type).toBe("number");
    settings.materialRoughness = finite(roughness.value);
  }
  const cameraDirectory = resolve("assets/native-parity.scene/cameras");
  const cameras = await Promise.all((await readdir(cameraDirectory)).filter(file => file.endsWith(".json")).map(async file => {
    const text = await readFile(resolve(cameraDirectory, file), "utf8");
    return { file, text, data: object(JSON.parse(text)) };
  }));
  const selected = cameras.filter(camera => camera.data.id === "World camera" && camera.data.name === "World camera");
  expect(selected).toHaveLength(1);
  const savedCamera = selected[0]!;
  const camera = { path: resolve(cameraDirectory, savedCamera.file), sha256: hash(savedCamera.text),
    alpha: finite(savedCamera.data.alpha), beta: finite(savedCamera.data.beta), radius: finite(savedCamera.data.radius) };
  const catalog = object(JSON.parse(await readFile(resolve("public/l2/catalog.json"), "utf8")));
  const models = objects(catalog.models);
  const rig = async (id: string): Promise<SourceRig> => {
    const matching = models.filter(model => model.id === id); expect(matching).toHaveLength(1);
    const entry = matching[0]!;
    if (typeof entry.model !== "string" || !/^\/l2\/[a-f0-9]{64}\/model\.glb$/.test(entry.model)) throw new Error(`Unexpected staged model path for ${id}.`);
    const bytes = await readFile(resolve("public", entry.model.slice(1)));
    const modelSha256 = hash(bytes); expect(modelSha256).toBe(entry.modelSha256);
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67); expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length); expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
    const gltf = object(JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8")));
    const skins = objects(gltf.skins), meshes = objects(gltf.meshes), nodes = objects(gltf.nodes);
    const skeletonBones = skins.map(skin => { if (!Array.isArray(skin.joints)) throw new Error("Source skin joints are missing."); return skin.joints.length; });
    let skinMeshes = 0;
    for (const node of nodes.filter(node => node.skin !== undefined)) {
      expect(Number.isInteger(node.skin)).toBe(true); expect(skins[Number(node.skin)]).toBeDefined();
      for (const primitive of objects(meshes[Number(node.mesh)]?.primitives)) {
        const attributes = object(primitive.attributes);
        expect(attributes._L2_NATIVE_WEIGHTS).toBeDefined(); expect(attributes._L2_NATIVE_JOINTS).toBeDefined();
        skinMeshes++;
      }
    }
    const clips = objects(gltf.animations).map(clip => { if (typeof clip.name !== "string") throw new Error("Source clip name is missing."); return clip.name; });
    return { modelSha256, skeletonBones, skinMeshes, clips };
  };
  const [fighter, armor, musveren] = await Promise.all([rig("human-male-fighter:0"), rig("fighter-equipment:0"), rig("musveren:0")]);
  // Keep the original independently inspected source rig contract as well as
  // comparing the live replacement to its actual staged, hash-verified GLB.
  expect(fighter.skeletonBones).toEqual([70, 70, 70, 70, 1, 1, 1]); expect(fighter.skinMeshes).toBe(7);
  expect(armor.skeletonBones).toEqual([70]); expect(armor.skinMeshes).toBe(1);
  expect(musveren.skeletonBones).toEqual([49]); expect(musveren.skinMeshes).toBe(2);
  for (const clip of [settings.fighterIdle, settings.fighterRun, settings.fighterAttack]) expect(fighter.clips).toContain(clip);
  return { config: { path: configPath, sha256: hash(configText), overrides: values }, settings, camera, fighter, armor, musveren };
}
type AuthoredState = Awaited<ReturnType<typeof authoredState>>;
function assertRigs(snapshot: Awaited<ReturnType<typeof read>>, authored: AuthoredState, equipped: boolean, hasMusveren = true) {
  const fighter = snapshot.entities.find(item => item.id === "local-player")!;
  const expectedBones = [...authored.fighter.skeletonBones, ...(equipped ? authored.armor.skeletonBones : [])];
  expect(fighter.skeletons.map(skeleton => skeleton.bones).sort((a, b) => a - b)).toEqual(expectedBones.sort((a, b) => a - b));
  expect(fighter.parts).toHaveLength(equipped ? 8 : 7);
  expect(fighter.parts.filter(part => part.enabled)).toHaveLength(7);
  expect(fighter.parts.find(part => part.material === starterMaterial)?.enabled).toBe(!equipped);
  if (equipped) expect(fighter.parts.find(part => part.material === leatherMaterial)?.enabled).toBe(true);
  else expect(fighter.parts.some(part => part.material === leatherMaterial)).toBe(false);
  if (hasMusveren) expect(snapshot.entities.find(item => item.id === "native-musveren")!.skeletons.map(skeleton => skeleton.bones)).toEqual(authored.musveren.skeletonBones);
  expect(snapshot.skinMeshes).toHaveLength(authored.fighter.skinMeshes + (equipped ? authored.armor.skinMeshes : 0) + (hasMusveren ? authored.musveren.skinMeshes : 0));
  expect(snapshot.skinMeshes.every(mesh => typeof mesh === "object" && mesh !== null && "applied" in mesh && mesh.applied === true && "normalized" in mesh && mesh.normalized === false)).toBe(true);
}
async function waitForEquipment(page: Page, equipped: boolean) {
  await expect.poll(async () => {
    const fighter = await entity(page);
    return { parts: fighter.parts.length, enabled: fighter.parts.filter(part => part.enabled).length,
      starter: fighter.parts.find(part => part.material === starterMaterial)?.enabled,
      leather: fighter.parts.some(part => part.material === leatherMaterial && part.enabled) };
  }, { timeout: 90_000 }).toEqual({ parts: equipped ? 8 : 7, enabled: 7, starter: !equipped, leather: equipped });
}
async function assertMaterialOverride(page: Page, authored: AuthoredState) {
  const { settings } = authored;
  const selected = (await read(page)).entities.find(item => item.id === settings.materialEntityId);
  const matched = settings.materialOverrideEnabled ? selected?.parts.filter(part => part.enabled && part.material === settings.materialSource).length ?? 0 : 0;
  await expect.poll(async () => (await read(page)).materialOverride?.matchedMeshes).toBe(matched);
  const override = (await read(page)).materialOverride;
  expect(override).toBeDefined(); expect(override?.enabled).toBe(settings.materialOverrideEnabled);
  expect(override?.failure).toBeNull();
  if (settings.materialOverrideEnabled) {
    expect(override?.entityId).toBe(settings.materialEntityId); expect(override?.sourceMaterial).toBe(settings.materialSource);
    expect(override?.tint).toEqual(settings.materialTint); expect(override?.roughness).toBe(settings.materialRoughness);
    for (const material of override!.materials) {
      expect(material.roughness).toBe(settings.materialRoughness);
      material.albedo.forEach((channel, index) => expect(channel).toBeCloseTo(material.sourceAlbedo[index]! * settings.materialTint[index]!, 10));
    }
  }
}
function errorsFor(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}
async function ready(page: Page, authored: AuthoredState) {
  await page.goto("/?world=interlude");
  await expect(page.locator("#loading")).toHaveCount(0, { timeout: 120_000 });
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.getByTestId("entity-count")).toHaveText("2", { timeout: 120_000 });
  await expect.poll(async () => (await read(page)).entities.filter(item => !item.isFallback).length, { timeout: 90_000 }).toBe(2);
  // Check the saved initial armor at the completed reveal boundary as well.
  await waitForEquipment(page, authored.settings.leatherShirt);
  await expect.poll(async () => (await entity(page)).playback?.activeClip).toBe(authored.settings.fighterIdle);
  const state = await read(page);
  expect(state.camera?.radius).toBeCloseTo(authored.camera.radius, 10);
  expect(state.camera?.alpha).toBeCloseTo(authored.camera.alpha, 10);
  expect(state.camera?.beta).toBeCloseTo(authored.camera.beta, 10);
  assertRigs(state, authored, authored.settings.leatherShirt);
  await assertMaterialOverride(page, authored);
}

test("native packages retain rigs, change equipment, hold death, move and clean up", async ({ page }) => {
  test.skip(!staged, "Run pnpm assets:migrate --stage-runtime first.");
  test.setTimeout(240_000);
  const errors = errorsFor(page);
  const authored = await authoredState();
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page, authored);
  const initial = await read(page);
  expect(initial.phase2Networking).toBe(false);
  expect(initial.nativeAttackReference).toBe("unverified");
  expect(initial.nativeNpcProfile).toMatchObject({ id: "npc:21622", npcId: 21622, name: "Greater Musveren",
    actorClass: "LineageMonster.field_stalker_20_bi", drawScale: 1.2, drawScale3D: [1, 1, 1],
    collisionRadius: 18, collisionHeight: 36, sourceUnitsPerMetre: 100 });
  expect(initial.nativeTerrain).toBe("source-section-loaded");
  expect(initial.world?.terrainTriangles).toBeGreaterThan(0);
  expect(initial.world?.placementCount).toBeGreaterThan(0);
  expect(initial.world?.nativeLocationMatch).toBe("unverified");
  expect(initial.worldFailure).toBeNull();
  expect(initial.world?.terrainMaterial).toBe("candidate-source-textures");
  expect(initial.world?.materialFailure).toBeNull();
  expect(initial.fog?.mode).toBe(0); // The authored native scene disables fog; the CLI used to drop that choice.
  await expect(page.getByTestId("fps")).toBeVisible();
  assertRigs(initial, authored, authored.settings.leatherShirt);
  for (const actor of initial.entities) {
    expect(actor.groundClearance).toBeGreaterThan(0);
    expect(actor.position.y - actor.authoritativePosition.y).toBeCloseTo(actor.groundClearance, 4);
    if (actor.id === "native-musveren") {
      // Native reference uses CollH=36 uu; a hovering creature's idle minimum
      // must not be forced onto the surface. This is not a native collision test.
      expect(actor.groundClearance).toBeCloseTo(.36, 8);
      // Independent retained idle bounds at unit actor scale. The new outer
      // scale must include the original native origin/rig transform as well.
      expect(actor.bounds.minimum[1]).toBeCloseTo(-.11751600205898288 * 1.2, 5);
      expect(actor.bounds.maximum[1]).toBeCloseTo(.2797630667686462 * 1.2, 5);
      expect(actor.position.y + actor.bounds.minimum[1]! - actor.authoritativePosition.y).toBeGreaterThan(.2);
    } else {
      expect(actor.position.y + actor.bounds.minimum[1]! - actor.authoritativePosition.y).toBeCloseTo(0, 4);
    }
  }
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(async () => (await entity(page)).playback?.activeClip).toBe(authored.settings.fighterRun);
  const pose = (await entity(page)).pose.flat();
  await expect.poll(async () => (await entity(page)).pose.flat().reduce((sum, value, index) => sum + Math.abs(value - (pose[index] ?? value)), 0)).toBeGreaterThan(.1);
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByTestId("dev-tab-world").click();
  await page.getByRole("button", { name: "Frame world", exact: true }).click();
  await page.getByTestId("dev-sheet-toggle").click();
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, "native-wide.png") });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByRole("button", { name: "Follow fighter", exact: true }).click();
  expect((await read(page)).camera?.radius).toBeCloseTo(authored.camera.radius, 10);
  await page.getByRole("button", { name: "Neutral terrain", exact: true }).click();
  expect((await read(page)).world?.terrainMaterial).toBe("neutral-inspection");
  await page.getByRole("button", { name: "Source textures", exact: true }).click();
  expect((await read(page)).world?.terrainMaterial).toBe("candidate-source-textures");
  await page.getByTestId("dev-tab-character").click();
  await page.getByRole("button", { name: "Leather shirt", exact: true }).click();
  await waitForEquipment(page, true);
  const equipped = await entity(page);
  assertRigs(await read(page), authored, true);
  expect(equipped.playback?.activeClip).toBe(authored.settings.fighterRun);
  await page.getByRole("button", { name: "Starter shirt", exact: true }).click();
  await waitForEquipment(page, false);
  await assertMaterialOverride(page, authored);
  assertRigs(await read(page), authored, false);
  expect((await read(page)).skinMeshes).toHaveLength(9);
  await page.getByRole("button", { name: "Leather shirt", exact: true }).click();
  await waitForEquipment(page, true);
  await assertMaterialOverride(page, authored);
  assertRigs(await read(page), authored, true);
  await page.getByTestId("dev-tab-combat").click();
  await page.getByRole("button", { name: "Musveren death", exact: true }).click();
  await expect.poll(async () => (await entity(page, "native-musveren")).playback?.playing, { timeout: 35_000 }).toBe(false);
  const dead = await entity(page, "native-musveren");
  expect(dead.playback).toMatchObject({ activeClip: "death", looping: false, playing: false });
  expect(dead.groundClearance).toBeCloseTo(.36, 8);
  expect(dead.position).toEqual(initial.entities.find(actor => actor.id === "native-musveren")!.position);
  await mkdir(evidence, { recursive: true });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.screenshot({ path: resolve(evidence, "native-death.png") });
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByRole("button", { name: "Attack", exact: true }).click();
  await expect.poll(async () => (await entity(page)).playback?.activeClip).toBe(authored.settings.fighterAttack);
  await expect.poll(async () => (await entity(page)).playback?.activeClip, { timeout: 35_000 }).toBe(authored.settings.fighterIdle);
  expect((await entity(page, "native-musveren")).pose).toEqual(dead.pose);
  await page.getByTestId("dev-tab-general").click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Attack", exact: true }).click();
  expect((await entity(page)).playback).toMatchObject({ activeClip: authored.settings.fighterAttack, frame: 0, looping: false });
  await page.getByRole("button", { name: "Idle", exact: true }).click();
  await page.getByTestId("dev-tab-combat").click();
  await page.getByRole("button", { name: "Revive Musveren", exact: true }).click();
  expect((await entity(page, "native-musveren")).playback?.activeClip).toBe("Wait");
  await page.getByTestId("dev-sheet-toggle").click();
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, "native-desktop.png") });
  await writeFile(resolve(evidence, "native-desktop.json"), JSON.stringify({ authored, initial, equipped, dead, final: await read(page), errors,
    scope: "WebGPU functional check; not native visual parity or a performance benchmark." }, null, 2));
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  const start = (await entity(page)).position;
  await page.evaluate(position => window.__nativeSlice!.dispatch({ type: "move-local", position }), { x: start.x + .35, y: start.y, z: start.z + .15 });
  await expect.poll(async () => (await entity(page)).position.x, { timeout: 20_000 }).toBeGreaterThan(start.x + .3);
  await expect.poll(async () => (await entity(page)).animation).toBe("idle");
  await page.getByRole("button", { name: "Select Greater Musveren", exact: true }).click();
  await expect(page.getByTestId("target-name")).toHaveText("Greater Musveren");
  await page.getByRole("button", { name: "Despawn target", exact: true }).click();
  await expect(page.getByTestId("entity-count")).toHaveText("1");
  assertRigs(await read(page), authored, true, false);
  expect((await read(page)).skinMeshes).toHaveLength(8);
  expect(errors).toEqual([]);
});

test("native actors and equipment remain usable at a mobile viewport", async ({ browser }) => {
  test.skip(!staged, "Run pnpm assets:migrate --stage-runtime first.");
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors = errorsFor(page);
  try {
    const authored = await authoredState();
    await ready(page, authored);
    const initial = await read(page);
    await page.getByRole("button", { name: "Run", exact: true }).tap();
    await expect.poll(async () => (await entity(page)).playback?.activeClip).toBe(authored.settings.fighterRun);
    await page.getByTestId("dev-sheet-toggle").tap();
    await page.getByTestId("dev-tab-character").tap();
    await page.getByRole("button", { name: "Leather shirt", exact: true }).tap();
    await waitForEquipment(page, true);
    assertRigs(await read(page), authored, true);
    await page.getByRole("button", { name: "Idle", exact: true }).tap();
    await page.getByTestId("dev-tab-general").tap();
    await page.getByRole("button", { name: "Pause", exact: true }).tap();
    await page.getByTestId("dev-sheet-toggle").tap();
    await page.getByRole("button", { name: "Select Human male fighter", exact: true }).tap();
    await expect(page.getByTestId("target-name")).toHaveText("Human male fighter");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, "native-mobile.png") });
    await writeFile(resolve(evidence, "native-mobile.json"), JSON.stringify({ authored, initial, state: await read(page), errors,
      scope: "Touch emulation and WebGPU; not physical mobile performance." }, null, 2));
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("missing native catalog entries keep the world concealed and offer a retry", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = errorsFor(page);
  let missing = true, intercepted = 0;
  await page.route("**/l2/catalog.json", async route => {
    if (missing) {
      intercepted++;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, models: [] }) });
    } else await route.continue();
  });
  await page.goto("/?world=interlude");
  await expect(page.getByRole("alert")).toContainText(/native/i, { timeout: 90_000 });
  await expect(page.locator("#loading")).toHaveAttribute("data-state", "error");
  await expect(page.getByRole("button", { name: "Reload and retry" })).toBeVisible();
  await expect(page.locator("#canvas")).toBeHidden();
  await expect(page.locator(".world-interface")).toBeHidden();
  await expect(page.getByTestId("entity-count")).toHaveCount(0);
  expect(await page.evaluate(() => window.__nativeSlice === undefined)).toBe(true);
  expect(intercepted).toBeGreaterThan(0);
  if (staged) {
    missing = false;
    await page.getByRole("button", { name: "Reload and retry" }).click();
    await expect(page.locator("#loading")).toHaveCount(0, { timeout: 120_000 });
    await expect(page.getByTestId("entity-count")).toHaveText("2");
    const recovered = await read(page);
    expect(recovered.entities).toHaveLength(2);
    expect(recovered.entities.every(item => !item.isFallback)).toBe(true);
    expect(recovered.nativeTerrain).toBe("source-section-loaded");
    expect(recovered.worldFailure).toBeNull();
  }
  expect(errors).toEqual([]);
});
