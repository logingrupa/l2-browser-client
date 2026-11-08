import { expect, test, type Browser, type Page } from "@playwright/test";
import { assetFixture } from "../fixtures/assetPackageFixture";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readAssetPackage, validatePackageModel } from "../../src/assets/package/readAssetPackage";
import { routeReferenceWorldAsNotStaged } from "./routeReferenceWorldAsNotStaged";

function validatedNativePackage(id: string): string | undefined {
  const receipt = resolve("artifacts/native-assets/conversion-validation.json");
  if (!existsSync(receipt)) return undefined;
  const rows = JSON.parse(readFileSync(receipt, "utf8")) as { id: string; file: string }[];
  const path = rows.find(row => row.id === id)?.file;
  return path && existsSync(path) ? path : undefined;
}
function nativePackage(): string | undefined {
  const verified = validatedNativePackage("interlude:speaking1f_s.wall03");
  if (verified) return verified;
  const directory = resolve("artifacts/native-assets");
  if (!existsSync(directory)) return undefined;
  for (const name of readdirSync(directory)) {
    const manifest = resolve(directory, name, "asset.json"), archive = resolve(directory, name, "asset.l2asset");
    if (!existsSync(manifest) || !existsSync(archive)) continue;
    const asset = JSON.parse(readFileSync(manifest, "utf8"));
    if (asset.source?.object === "speaking1f_s.wall03") return archive;
  }
  return undefined;
}

const nativeIntegrationEvidence = resolve("artifacts/native-integration");
const landscapePhoneContext = { viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true };

async function openLandscapePhonePage(browser: Browser): Promise<Page> {
  const context = await browser.newContext(landscapePhoneContext);
  return context.newPage();
}

async function expectNoHorizontalScrollInPortrait(page: Page): Promise<void> {
  await page.setViewportSize({ width: 430, height: 932 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(430);
}

async function dropNativeWallOnDefaultRoute(page: Page, archive: string): Promise<void> {
  await routeReferenceWorldAsNotStaged(page);
  await page.goto("/");
  await expect(page.getByTestId("entity-count")).toHaveText("6");
  expect(await page.evaluate(() => window.__assetPackageInspection!.snapshot().open)).toBe(false);
  const dropped = await page.evaluateHandle(base64 => {
    const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], "wall.l2asset", { type: "application/zip" }));
    return transfer;
  }, readFileSync(archive).toString("base64"));
  await page.locator("canvas").first().dispatchEvent("drop", { dataTransfer: dropped });
  await dropped.dispose();
  await expect(page.getByRole("dialog", { name: "Asset inspector" })).toBeVisible();
  await expect(page.locator(".asset-import-status")).toContainText("speaking1f_s.wall03 ready");
}

async function openModelFromDeveloperSheet(page: Page, modelPath: string, modelName: string): Promise<void> {
  await routeReferenceWorldAsNotStaged(page);
  await page.goto("/");
  await expect(page.getByTestId("entity-count")).toHaveText("6");
  await page.getByTestId("dev-sheet-toggle").click();
  await page.getByRole("button", { name: "Assets", exact: true }).click();
  await page.getByLabel("Choose an asset package").setInputFiles(modelPath);
  await expect(page.locator(".asset-import-status")).toContainText(`${modelName} ready`, { timeout: 90_000 });
}

test.describe("local asset package inspector", () => {
  test.beforeEach(async ({ page }) => { await page.goto("/tests/browser/assetPackage.html"); await expect(page.getByRole("button", { name: "Assets", exact: true })).toBeVisible(); });

  test("keeps source scale and clip names, preserves a good asset on errors, and releases its engine", async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.getByRole("button", { name: "Assets", exact: true }).click();
    const fixture = await assetFixture();
    await page.getByLabel("Choose an asset package").setInputFiles({ name: "model.l2asset", mimeType: "application/zip", buffer: Buffer.from(fixture.bytes) });
    await expect(page.getByRole("status")).toContainText("Native model fixture ready", { timeout: 30_000 });
    let snapshot = await page.evaluate(() => window.__assetPackageInspection!.snapshot());
    expect(snapshot.preview?.unitScale).toBe(1); expect(snapshot.clips.map(clip => clip.name)).toEqual(["Wait_Native"]);
    expect(snapshot.preview?.bounds).toEqual([[-1, 0, 0], [1, 3, 0]]);
    expect(snapshot.preview?.materials).toContain("NativeMaterial");
    await page.getByRole("button", { name: "Play animation", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__assetPackageInspection!.snapshot().preview?.playing)).toBe(true);
    await page.getByRole("button", { name: "Pause animation", exact: true }).click();
    expect((await page.evaluate(() => window.__assetPackageInspection!.snapshot())).preview?.playing).toBe(false);
    await page.getByLabel("Choose an asset package").setInputFiles({ name: "broken.l2asset", mimeType: "application/zip", buffer: Buffer.from("broken") });
    await expect(page.getByRole("status")).toContainText("Your current asset is still open");
    snapshot = await page.evaluate(() => window.__assetPackageInspection!.snapshot());
    expect(snapshot.name).toBe("Native model fixture");
    expect(await page.evaluate(() => window.__assetHarness!().engines)).toBe(2);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    expect(await page.evaluate(() => window.__assetHarness!())).toEqual({ engines: 1, precision: true, worldDisposed: false, paused: false });
    await expect(page.getByRole("button", { name: "Assets", exact: true })).toBeFocused();
    expect(await page.evaluate(() => window.__assetPackageInspection!.snapshot().preview)).toBeNull();
    expect(errors).toEqual([]);
  });

  test("supports texture and audio packages on a compact viewport and closes with Escape", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.getByRole("button", { name: "Assets", exact: true }).click();
    const texture = await assetFixture("texture");
    await page.getByLabel("Choose an asset package").setInputFiles({ name: "texture.l2asset", mimeType: "application/zip", buffer: Buffer.from(texture.bytes) });
    await expect(page.getByRole("status")).toContainText("Native texture fixture ready");
    await expect(page.getByRole("img", { name: "Native texture fixture" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const audio = await assetFixture("audio");
    await page.getByLabel("Choose an asset package").setInputFiles({ name: "audio.l2asset", mimeType: "application/zip", buffer: Buffer.from(audio.bytes) });
    await expect(page.getByRole("status")).toContainText("Native audio fixture ready");
    await expect(page.getByLabel("Native audio fixture audio")).toBeVisible();
    expect(await page.locator("audio").evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect(await page.evaluate(() => window.__assetHarness!().engines)).toBe(1);
  });
});

test("drops an actual native Interlude conversion into the client without changing world state", async ({ page, browser }) => {
  const archive = nativePackage();
  test.skip(!archive, "Run the native static wall conversion before this evidence check.");
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await dropNativeWallOnDefaultRoute(page, archive!);
  const imported = await page.evaluate(() => window.__assetPackageInspection!.snapshot());
  expect(imported.preview?.unitScale).toBe(1);
  expect(imported.preview?.meshes).toBeGreaterThan(0);
  expect(imported.preview?.materials.length).toBeGreaterThan(0);
  expect(imported.sourceEdition).toBe("interlude");
  await mkdir(nativeIntegrationEvidence, { recursive: true });
  await page.screenshot({ path: resolve(nativeIntegrationEvidence, "asset-package-desktop.png") });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("entity-count")).toHaveText("6");
  expect((await page.evaluate(() => window.__worldDiagnostics!.snapshot())).environment.cameraRelative).toBe(true);
  expect(errors).toEqual([]);
  const phone = await openLandscapePhonePage(browser);
  try {
    await dropNativeWallOnDefaultRoute(phone, archive!);
    await phone.screenshot({ path: resolve(nativeIntegrationEvidence, "asset-package-mobile.png") });
    await expectNoHorizontalScrollInPortrait(phone);
  } finally { await phone.context().close(); }
});

test("decodes and plays actual converted L2SD music, then releases the audio resource", async ({ page }) => {
  const archive = validatedNativePackage("interlude:music/b01_f.ogg");
  test.skip(!archive, "Build the native L2SD music package before this local asset check.");
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const music = await readAssetPackage(new Uint8Array(await readFile(archive!)));
  expect(music.manifest.kind).toBe("audio");
  const audioFile = music.manifest.audio!.file;
  expect(music.manifest.files.find(file => file.path === audioFile)?.mime).toBe("audio/ogg");
  expect(new TextDecoder().decode(music.files.get(audioFile)!.subarray(0, 4))).toBe("OggS");
  await page.goto("/tests/browser/assetPackage.html");
  await page.getByRole("button", { name: "Assets", exact: true }).click();
  await page.getByLabel("Choose an asset package").setInputFiles(archive!);
  await expect(page.getByRole("status")).toContainText(`${music.manifest.name} ready`, { timeout: 30_000 });
  const player = page.locator(".asset-import-panel audio");
  await expect(player).toBeVisible();
  await expect.poll(() => player.evaluate(element => {
    const audio = element as HTMLAudioElement;
    return Number.isFinite(audio.duration) && audio.duration > 0;
  })).toBe(true);
  expect(await player.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
  await player.press("Space");
  await expect.poll(() => player.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  const playback = await player.evaluate(element => {
    const audio = element as HTMLAudioElement;
    return { duration: audio.duration, currentTime: audio.currentTime, paused: audio.paused, error: audio.error?.message ?? null };
  });
  expect(playback.paused).toBe(false); expect(playback.error).toBeNull();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(player).toHaveCount(0);
  expect(await page.evaluate(() => window.__assetHarness!())).toEqual({ engines: 1, precision: true, worldDisposed: false, paused: false });
  expect(await page.evaluate(() => window.__assetPackageInspection!.snapshot().preview)).toBeNull();
  await mkdir(nativeIntegrationEvidence, { recursive: true });
  await writeFile(resolve(nativeIntegrationEvidence, "music-browser-report.json"), JSON.stringify({ archive, audioFile, playback, errors }, null, 2));
  expect(errors).toEqual([]);
});

test("plays an assembled native character with source-duration loops and linked sounds, then opens native audio", async ({ page, browser }) => {
  const modelPath = resolve(process.env.NATIVE_MODEL_PACKAGE ?? validatedNativePackage("interlude:assembly:MFighter-native-body-face0-hair0") ?? validatedNativePackage("interlude:assembly:MFighter-native-body-face0") ?? "artifacts/native-assets/4d47a7564ac2b42124bc19e0d45d1bf02c36aa54bda97546d09a5fbc7f98f1f7/asset.l2asset");
  const audioPath = resolve(process.env.NATIVE_AUDIO_PACKAGE ?? validatedNativePackage("interlude:skillsound.power_strike.power_strike_cast") ?? "artifacts/native-assets/ff2ee23d39ab0ad5ed3284953d058184d48a62cb20482b584e642ef841efa4f4/asset.l2asset");
  test.skip(!existsSync(modelPath) || !existsSync(audioPath), "Build the native assembled character and audio packages before this local asset check.");
  test.setTimeout(180_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const model = await readAssetPackage(new Uint8Array(await readFile(modelPath)));
  const glb = model.files.get(model.manifest.model!.file)!;
  const metadata = validatePackageModel(glb);
  const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + new DataView(glb.buffer, glb.byteOffset, glb.byteLength).getUint32(12, true)))) as { meshes: { primitives: unknown[] }[]; skins: { joints: number[] }[] };
  const expectedMeshes = gltf.meshes.reduce((total, mesh) => total + mesh.primitives.length, 0);
  const expectedBones = gltf.skins.reduce((total, skin) => total + skin.joints.length, 0);
  const audio = await readAssetPackage(new Uint8Array(await readFile(audioPath)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openModelFromDeveloperSheet(page, modelPath, model.manifest.name);
  const initial = await page.evaluate(() => window.__assetPackageInspection!.snapshot());
  expect(initial.preview?.unitScale).toBe(1);
  expect(initial.preview?.skeletons).toBe(gltf.skins.length); expect(initial.preview?.meshes).toBe(expectedMeshes); expect(initial.preview?.bones).toBe(expectedBones);
  expect(initial.clips.map(clip => clip.name)).toEqual(metadata.animations.map(clip => clip.name));
  expect(initial.clips.every((clip, index) => clip.nativeTiming && clip.durationSeconds === metadata.animations[index]!.nativeDurationSeconds)).toBe(true);
  const events = (model.manifest.animationEvents ?? []) as { clip?: string; resolvedFile?: string; timeSeconds?: number }[];
  const soundClip = events.find(event => event.resolvedFile && typeof event.timeSeconds === "number" && event.timeSeconds > 0 && event.timeSeconds < 1)?.clip;
  expect(soundClip).toBeTruthy();
  await page.getByLabel("Native animation", { exact: true }).selectOption({ label: soundClip! });
  await page.getByLabel("Play linked sounds", { exact: true }).check();
  await expect.poll(() => page.evaluate(() => window.__assetPackageInspection!.snapshot().preview?.linkedSounds?.decoded), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Play animation", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__assetPackageInspection!.snapshot().preview?.nativePlayback?.loopCount), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__assetPackageInspection!.snapshot().preview?.linkedSounds?.played), { timeout: 20_000 }).toBeGreaterThan(0);
  const moving = await page.evaluate(() => window.__assetPackageInspection!.snapshot());
  expect(moving.preview?.bonePose).not.toEqual(initial.preview?.bonePose);
  expect(moving.preview?.nativePlayback?.durationSeconds).toBe(initial.clips.find(clip => clip.name === soundClip)!.durationSeconds);
  await page.getByRole("button", { name: "Pause animation", exact: true }).click();
  const pausedTime = await page.evaluate(() => window.__assetPackageInspection!.snapshot().preview?.nativePlayback?.timeSeconds);
  await expect(page.getByRole("button", { name: "Play animation", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__assetPackageInspection!.snapshot().preview?.nativePlayback?.timeSeconds)).toBe(pausedTime);
  await mkdir(nativeIntegrationEvidence, { recursive: true });
  const capturePose = async (clip: string) => {
    await page.getByLabel("Native animation", { exact: true }).selectOption({ label: clip });
    await page.getByRole("button", { name: "Play animation", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__assetPackageInspection!.snapshot().preview?.nativePlayback?.timeSeconds)).toBeGreaterThan(.2);
    await page.getByRole("button", { name: "Pause animation", exact: true }).click();
    const deformation = await page.evaluate(() => window.__assetPackageInspection!.sampleDeformation());
    expect(deformation?.finite).toBe(true); expect(deformation?.parts).toHaveLength(expectedMeshes);
    return { clip, state: await page.evaluate(() => window.__assetPackageInspection!.snapshot()), deformation };
  };
  const running = await capturePose("Run_Hand_MFighter");
  await page.screenshot({ path: resolve(nativeIntegrationEvidence, "assembled-run-desktop.png") });
  const idle = await capturePose("Wait_Hand_MFighter");
  expect(idle.deformation?.parts.map(part => part.checksum)).not.toEqual(running.deformation?.parts.map(part => part.checksum));
  const idleParts = idle.deformation!.parts;
  const idleExtents = [0, 1, 2].map(axis => Math.max(...idleParts.map(part => part.maximum[axis]!)) - Math.min(...idleParts.map(part => part.minimum[axis]!)));
  const bindHeight = initial.preview!.bounds![1]![1]! - initial.preview!.bounds![0]![1]!;
  expect(idleExtents[1]!, "Native standing wait retains the source vertical stature").toBeGreaterThan(bindHeight * .75);
  expect(idleExtents[1]!, "Native standing wait is taller than its horizontal extents").toBeGreaterThan(Math.max(idleExtents[0]!, idleExtents[2]!));
  await page.screenshot({ path: resolve(nativeIntegrationEvidence, "assembled-desktop.png") });
  await page.getByLabel("Choose an asset package").setInputFiles(audioPath);
  await expect(page.locator(".asset-import-status")).toContainText(`${audio.manifest.name} ready`, { timeout: 30_000 });
  const player = page.locator(".asset-import-panel audio");
  await expect(player).toBeVisible();
  expect(await player.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
  await player.press("Space");
  await expect.poll(() => player.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("entity-count")).toHaveText("6");
  expect(await page.evaluate(() => window.__assetPackageInspection!.snapshot().preview)).toBeNull();
  await writeFile(resolve(nativeIntegrationEvidence, "assembled-browser-report.json"), JSON.stringify({ modelPath, audioPath, initial, moving, running, idle, errors }, null, 2));
  expect(errors).toEqual([]);
  const phone = await openLandscapePhonePage(browser);
  try {
    await openModelFromDeveloperSheet(phone, modelPath, model.manifest.name);
    await phone.getByLabel("Native animation", { exact: true }).selectOption({ label: "Wait_Hand_MFighter" });
    await phone.screenshot({ path: resolve(nativeIntegrationEvidence, "assembled-mobile.png") });
    await expectNoHorizontalScrollInPortrait(phone);
  } finally { await phone.context().close(); }
});
