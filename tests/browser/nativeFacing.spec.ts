import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { desktopViewport } from "./browserViewports";

const actor = (page: Page) => page.evaluate(() => window.__nativeSlice!.snapshot().entities.find(entity => entity.id === "local-player")!);

test("ground taps turn the native fighter toward two perpendicular movement directions", async ({ page }) => {
  test.skip(!existsSync(resolve("public/l2/catalog.json")), "Requires staged native assets.");
  test.setTimeout(180_000);
  await page.setViewportSize(desktopViewport);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/?authored=1");
  await expect(page.locator("#loading")).toHaveCount(0, { timeout: 120_000 });
  await expect(page.locator("#canvas")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__nativeSlice?.snapshot().entities.filter(entity => entity.hasNativeModel).length), { timeout: 120_000 }).toBe(2);
  const cameraDirectory = resolve("assets/native-world.scene/cameras");
  const savedCameras = await Promise.all((await readdir(cameraDirectory)).filter(file => file.endsWith(".json"))
    .map(async file => JSON.parse(await readFile(resolve(cameraDirectory, file), "utf8")) as { name: string; fov?: number; fovMode?: number }));
  const editorSavedWorldCamera = savedCameras.find(camera => camera.name === "World camera")!;
  const tapProjectionEngine = new NullEngine({ renderWidth: 1440, renderHeight: 900, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 4 });
  const tapProjectionScene = new Scene(tapProjectionEngine); tapProjectionScene.useRightHandedSystem = true;
  try {
    for (const { direction, groundDistanceClearOfFighterAndLabel } of [
      { direction: new Vector3(1, 0, 0), groundDistanceClearOfFighterAndLabel: .7 },
      { direction: new Vector3(0, 0, 1), groundDistanceClearOfFighterAndLabel: 2.2 },
    ]) {
      const start = (await actor(page)).authoritativePosition;
      const state = await page.evaluate(() => window.__nativeSlice!.snapshot().camera);
      if (!state) throw new Error("Native world camera is unavailable.");
      const tapProjectionCamera = new ArcRotateCamera("tap projection", state.alpha, state.beta, state.radius, Vector3.FromArray(state.target), tapProjectionScene);
      tapProjectionCamera.fov = editorSavedWorldCamera.fov ?? .8; tapProjectionCamera.fovMode = editorSavedWorldCamera.fovMode ?? 0;
      tapProjectionCamera.minZ = .03; tapProjectionCamera.maxZ = 5000; tapProjectionScene.activeCamera = tapProjectionCamera;
      tapProjectionScene.updateTransformMatrix(true);
      const destination = new Vector3(start.x, start.y, start.z).add(direction.scale(groundDistanceClearOfFighterAndLabel));
      const point = Vector3.Project(destination, Matrix.IdentityReadOnly, tapProjectionScene.getTransformMatrix(), tapProjectionCamera.viewport.toGlobal(1440, 900));
      expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(1440);
      expect(point.y).toBeGreaterThan(0); expect(point.y).toBeLessThan(900);
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, { x: point.x, y: point.y }),
        "The ground tap must clear character labels and HUD controls.").toBe("canvas");
      await page.mouse.click(point.x, point.y);
      await expect.poll(async () => {
        const position = (await actor(page)).authoritativePosition;
        return Math.hypot(position.x - start.x, position.z - start.z);
      }, { timeout: 20_000 }).toBeGreaterThan(.5);
      await expect.poll(async () => (await actor(page)).animation, { timeout: 20_000 }).toBe("idle");
      await expect.poll(async () => {
        const current = await actor(page), presentedForwardDirection = current.forwardDirection!;
        const displacement = new Vector3(current.authoritativePosition.x - start.x, 0, current.authoritativePosition.z - start.z).normalize();
        return Vector3.Dot(Vector3.FromArray(presentedForwardDirection), displacement);
      }).toBeGreaterThan(.995);
      const end = (await actor(page)).authoritativePosition;
      expect(Vector3.Dot(new Vector3(end.x - start.x, 0, end.z - start.z).normalize(), direction)).toBeGreaterThan(.95);
      tapProjectionCamera.dispose();
    }
    expect(errors).toEqual([]);
  } finally { tapProjectionScene.dispose(); tapProjectionEngine.dispose(); }
});
