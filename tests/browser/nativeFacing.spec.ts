import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { nativeSandboxPresentation } from "../../src/scene/presentationConfiguration";

const actor = (page: Page) => page.evaluate(() => window.__nativeSlice!.snapshot().entities.find(entity => entity.id === "local-player")!);

test("ground taps turn the native fighter toward two perpendicular movement directions", async ({ page }) => {
  test.skip(!existsSync(resolve("public/l2/catalog.json")), "Requires staged native assets.");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/?world=interlude");
  await expect(page.locator("#loading")).toHaveCount(0, { timeout: 120_000 });
  await expect(page.locator("#canvas")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__nativeSlice?.snapshot().entities.filter(entity => !entity.isFallback).length), { timeout: 120_000 }).toBe(2);
  const savedCamera = nativeSandboxPresentation.camera;
  const engine = new NullEngine({ renderWidth: 1440, renderHeight: 900, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 4 });
  const scene = new Scene(engine); scene.useRightHandedSystem = true;
  try {
    for (const { direction, distance } of [
      { direction: new Vector3(1, 0, 0), distance: .7 },
      { direction: new Vector3(0, 0, 1), distance: 2.2 },
    ]) {
      const start = (await actor(page)).authoritativePosition;
      const state = await page.evaluate(() => window.__nativeSlice!.snapshot().camera);
      if (!state) throw new Error("Native world camera is unavailable.");
      const camera = new ArcRotateCamera("tap projection", state.alpha, state.beta, state.radius, Vector3.FromArray(state.target), scene);
      camera.fov = savedCamera.fov; camera.fovMode = savedCamera.fovMode;
      camera.minZ = savedCamera.minZ; camera.maxZ = savedCamera.maxZ; scene.activeCamera = camera;
      scene.updateTransformMatrix(true);
      const destination = new Vector3(start.x, start.y, start.z).add(direction.scale(distance));
      const point = Vector3.Project(destination, Matrix.IdentityReadOnly, scene.getTransformMatrix(), camera.viewport.toGlobal(1440, 900));
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
        const current = await actor(page), forward = current.forwardDirection!;
        const displacement = new Vector3(current.authoritativePosition.x - start.x, 0, current.authoritativePosition.z - start.z).normalize();
        return Vector3.Dot(Vector3.FromArray(forward), displacement);
      }).toBeGreaterThan(.995);
      const end = (await actor(page)).authoritativePosition;
      expect(Vector3.Dot(new Vector3(end.x - start.x, 0, end.z - start.z).normalize(), direction)).toBeGreaterThan(.95);
      camera.dispose();
    }
    expect(errors).toEqual([]);
  } finally { scene.dispose(); engine.dispose(); }
});
