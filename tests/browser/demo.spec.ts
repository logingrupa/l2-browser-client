import { expect, test, type CDPSession, type Page, type TestInfo } from "@playwright/test";

interface Position {
  x: number;
  y: number;
  z: number;
}

interface EntitySnapshot {
  id: string;
  position: Position;
  authoritativePosition: Position;
  animation: "idle" | "run" | "attack";
  isFallback: boolean;
  screenPosition: { x: number; y: number };
  meshCount: number;
  pose: number[][];
}

interface WorldSnapshot {
  entities: EntitySnapshot[];
  camera: { alpha: number; beta: number; radius: number };
  selectedEntityId: string | null;
  environment: { groundWidth: number; lightIntensity: number };
  sceneMeshCount: number;
  isDisposed: boolean;
}

interface BrowserError {
  message: string;
  url: string;
}

const observedErrors = new WeakMap<Page, BrowserError[]>();
const touchSessions = new WeakMap<Page, CDPSession>();

async function readWorld(page: Page): Promise<WorldSnapshot> {
  return page.evaluate(() => {
    const runtimeWindow = window as Window & {
      __worldDiagnostics?: { snapshot(): WorldSnapshot };
    };
    if (!runtimeWindow.__worldDiagnostics) throw new Error("World diagnostics were not installed.");
    const snapshot = runtimeWindow.__worldDiagnostics.snapshot();
    if (!snapshot.camera) throw new Error("The world camera is missing.");
    return { ...snapshot, camera: snapshot.camera };
  });
}

async function readEntity(page: Page, entityId: string): Promise<EntitySnapshot> {
  const entity = (await readWorld(page)).entities.find((candidate) => candidate.id === entityId);
  if (!entity) throw new Error(`Expected entity ${entityId} to exist.`);
  return entity;
}

async function openDemoControls(page: Page): Promise<void> {
  if (!(await page.getByRole("button", { name: "Pause", exact: true }).isVisible())) {
    await page.getByText("Demo controls", { exact: true }).click();
  }
}

function poseDistance(earlierPose: number[][], laterPose: number[][]): number {
  const earlierAngles = earlierPose.flat();
  return laterPose.flat().reduce((distance, angle, index) => distance + Math.abs(angle - (earlierAngles[index] ?? angle)), 0);
}

function isExpectedMissingAssetError(error: BrowserError, testInfo: TestInfo): boolean {
  return testInfo.annotations.some((annotation) => annotation.type === "expected-asset-404")
    && error.url.endsWith("/assets/missing-character.glb")
    && /^Failed to load resource:.*404/.test(error.message);
}

test.beforeEach(async ({ page, hasTouch }) => {
  const errors: BrowserError[] = [];
  observedErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push({ message: error.message, url: page.url() }));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push({ message: message.text(), url: message.location().url });
  });
  if (hasTouch) {
    // Playwright otherwise advertises one touch point, which cannot represent a pinch.
    const touchSession = await page.context().newCDPSession(page);
    await touchSession.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    touchSessions.set(page, touchSession);
  }
  await page.goto("/");
  await expect(page.getByTestId("world-status")).toHaveText("World ready");
  await openDemoControls(page);
});

test.afterEach(async ({ page }, testInfo) => {
  await touchSessions.get(page)?.detach();
  const unexpectedErrors = (observedErrors.get(page) ?? []).filter((error) => !isExpectedMissingAssetError(error, testInfo));
  expect(unexpectedErrors, "No uncaught exceptions or unexpected browser console errors").toEqual([]);
});

test("loads the authored environment, six visible entities and live diagnostics", async ({ page }) => {
  await expect(page.getByTestId("entity-count")).toHaveText("6");
  await expect(page.locator("[data-entity-id]")).toHaveCount(6);
  await expect(page.getByTestId("target-name")).toHaveText("No target");
  await expect.poll(async () => Number(await page.getByTestId("fps").textContent())).toBeGreaterThan(0);
  await expect(page.getByTestId("coordinates")).toContainText("0.0");

  const snapshot = await readWorld(page);
  expect(snapshot.entities).toHaveLength(6);
  expect(snapshot.entities.every((entity) => entity.meshCount > 0)).toBe(true);
  expect(snapshot.environment.groundWidth).toBeGreaterThan(20);
  expect(snapshot.environment.lightIntensity).toBeGreaterThan(0);
  expect(snapshot.isDisposed).toBe(false);
  for (const displayName of ["Elyra", "Orin", "Seren", "Moss Golem", "Amber Wisp", "Watcher"]) {
    await expect(page.getByRole("button", { name: `Select ${displayName}`, exact: true })).toBeVisible();
  }
});

test("mouse-picks a character and removes its selection, label and owned meshes on despawn", async ({ page }) => {
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const beforeRemoval = await readWorld(page);
  const target = await readEntity(page, "monster-3");
  await page.mouse.click(target.screenPosition.x, target.screenPosition.y);
  await expect(page.getByTestId("target-name")).toHaveText("Watcher");
  expect((await readWorld(page)).selectedEntityId).toBe("monster-3");

  await page.getByRole("button", { name: "Despawn target", exact: true }).click();
  await expect(page.getByTestId("target-name")).toHaveText("No target");
  await expect(page.getByTestId("entity-count")).toHaveText("5");
  await expect(page.locator('[data-entity-id="monster-3"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Despawn target", exact: true })).toBeDisabled();
  const afterRemoval = await readWorld(page);
  expect(afterRemoval.entities.some((entity) => entity.id === "monster-3")).toBe(false);
  expect(afterRemoval.selectedEntityId).toBeNull();
  expect(afterRemoval.sceneMeshCount).toBeLessThan(beforeRemoval.sceneMeshCount);

  await page.getByRole("button", { name: "Spawn", exact: true }).click();
  await expect(page.getByTestId("entity-count")).toHaveText("6");
  await expect(page.getByRole("button", { name: "Select Sentinel 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Select Sentinel 1", exact: true }).click();
  await expect(page.getByTestId("target-name")).toHaveText("Sentinel 1");
  expect((await readWorld(page)).entities.some((entity) => entity.id === "spawned-1")).toBe(true);
});

test("smooths synthetic updates and snaps an explicit teleport immediately", async ({ page }) => {
  const initialRemote = await readEntity(page, "remote-1");
  await expect.poll(async () => {
    const remote = await readEntity(page, "remote-1");
    return Math.hypot(remote.position.x - initialRemote.position.x, remote.position.z - initialRemote.position.z);
  }).toBeGreaterThan(0.2);
  await expect.poll(async () => {
    const remote = await readEntity(page, "remote-1");
    const distanceFromAuthority = Math.hypot(
      remote.position.x - remote.authoritativePosition.x,
      remote.position.z - remote.authoritativePosition.z,
    );
    return distanceFromAuthority > 0.005 && distanceFromAuthority < 0.8;
  }).toBe(true);

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Teleport", exact: true }).click();
  await expect.poll(async () => (await readEntity(page, "local-player")).authoritativePosition.x).toBe(7);
  const teleportedPlayer = await readEntity(page, "local-player");
  expect(teleportedPlayer.position.x).toBeCloseTo(7, 5);
  expect(teleportedPlayer.position.z).toBeCloseTo(0, 5);
  await expect(page.getByTestId("coordinates")).toContainText("7.0");
});

test("ground clicks move authoritative and rendered positions to the picked destination before returning to idle", async ({ page }) => {
  const destination: Position = { x: -2, y: 0, z: 3 };
  const initialPlayer = await readEntity(page, "local-player");
  const initialDistance = Math.hypot(destination.x - initialPlayer.position.x, destination.z - initialPlayer.position.z);
  const screenPosition = await page.evaluate((position) => {
    const runtimeWindow = window as Window & {
      __worldDiagnostics?: { projectPosition(position: Position): { x: number; y: number } };
    };
    if (!runtimeWindow.__worldDiagnostics) throw new Error("World diagnostics were not installed.");
    return runtimeWindow.__worldDiagnostics.projectPosition(position);
  }, destination);
  await page.mouse.click(screenPosition.x, screenPosition.y);

  await expect.poll(async () => {
    const player = await readEntity(page, "local-player");
    const authoritativeDistance = Math.hypot(destination.x - player.authoritativePosition.x, destination.z - player.authoritativePosition.z);
    const renderedDistance = Math.hypot(destination.x - player.position.x, destination.z - player.position.z);
    return player.animation === "run"
      && authoritativeDistance < initialDistance - 0.1
      && authoritativeDistance > 0.1
      && renderedDistance > authoritativeDistance + 0.005
      && renderedDistance < initialDistance;
  }, { intervals: [50, 50, 100] }).toBe(true);
  await expect.poll(async () => (await readEntity(page, "local-player")).animation).toBe("idle");
  await expect.poll(async () => {
    const player = await readEntity(page, "local-player");
    return Math.hypot(destination.x - player.position.x, destination.z - player.position.z);
  }).toBeLessThan(0.1);
  const arrivedPlayer = await readEntity(page, "local-player");
  expect(Math.hypot(destination.x - arrivedPlayer.authoritativePosition.x, destination.z - arrivedPlayer.authoritativePosition.z)).toBeLessThan(0.1);
});

test("transitions between idle, run and attack with animated procedural joints", async ({ page }) => {
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const initialPlayer = await readEntity(page, "local-player");
  expect(initialPlayer.animation).toBe("idle");

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(async () => (await readEntity(page, "local-player")).animation).toBe("run");
  const runningPose = (await readEntity(page, "local-player")).pose;
  await expect.poll(async () => poseDistance(runningPose, (await readEntity(page, "local-player")).pose)).toBeGreaterThan(0.05);

  await page.getByRole("button", { name: "Attack", exact: true }).click();
  await expect.poll(async () => (await readEntity(page, "local-player")).animation).toBe("attack");
  const attackingPose = (await readEntity(page, "local-player")).pose;
  await expect.poll(async () => poseDistance(attackingPose, (await readEntity(page, "local-player")).pose)).toBeGreaterThan(0.05);

  await page.getByRole("button", { name: "Idle", exact: true }).click();
  await expect.poll(async () => (await readEntity(page, "local-player")).animation).toBe("idle");
  await expect(page.locator('[data-entity-id="local-player"]')).toHaveAttribute("data-animation", "idle");
});

test("rotates with right drag and clamps wheel zoom and vertical orbit", async ({ page }) => {
  const beforeRotation = (await readWorld(page)).camera;
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("This test needs a fixed browser viewport.");
  const startX = viewport.width * 0.55;
  const startY = viewport.height * 0.4;
  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(startX + 160, startY + 65, { steps: 12 });
  await page.mouse.up({ button: "right" });
  await expect.poll(async () => Math.abs((await readWorld(page)).camera.alpha - beforeRotation.alpha)).toBeGreaterThan(0.05);

  await page.mouse.wheel(0, -20_000);
  await expect.poll(async () => (await readWorld(page)).camera.radius).toBeCloseTo(10, 1);
  await page.mouse.wheel(0, 20_000);
  await expect.poll(async () => (await readWorld(page)).camera.radius).toBeCloseTo(38, 1);
  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(startX, startY - 1200, { steps: 10 });
  await page.mouse.up({ button: "right" });
  const finalCamera = (await readWorld(page)).camera;
  expect(finalCamera.beta).toBeGreaterThanOrEqual(0.35 - 0.001);
  expect(finalCamera.beta).toBeLessThanOrEqual(1.45 + 0.001);
  expect(finalCamera.radius).toBeGreaterThanOrEqual(10);
  expect(finalCamera.radius).toBeLessThanOrEqual(38);
});

test("replaces a malformed successful model response with a usable animated fallback", async ({ page }) => {
  await page.route("**/assets/missing-character.glb", (route) => route.fulfill({
    status: 200,
    contentType: "model/gltf-binary",
    body: "This response deliberately is not a GLB asset.",
  }));
  const modelResponse = page.waitForResponse("**/assets/missing-character.glb");
  await page.getByRole("button", { name: "Missing model", exact: true }).click();
  expect((await modelResponse).status()).toBe(200);
  await expect(page.getByTestId("entity-count")).toHaveText("7");
  await expect.poll(async () => (await readEntity(page, "spawned-1")).isFallback).toBe(true);
  expect((await readEntity(page, "spawned-1")).meshCount).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Select Fallback Sentinel", exact: true }).click();
  await expect(page.getByTestId("target-name")).toHaveText("Fallback Sentinel");
  await page.getByRole("button", { name: "Despawn target", exact: true }).click();
  await expect(page.getByTestId("entity-count")).toHaveText("6");
});

test("handles a real HTTP 404 model failure without uncaught errors", async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: "expected-asset-404", description: "/assets/missing-character.glb" });
  await page.route("**/assets/missing-character.glb", (route) => route.fulfill({
    status: 404,
    contentType: "text/plain",
    body: "Missing synthetic test model",
  }));
  const modelResponse = page.waitForResponse("**/assets/missing-character.glb");
  await page.getByRole("button", { name: "Missing model", exact: true }).click();
  expect((await modelResponse).status()).toBe(404);
  await expect.poll(async () => (await readEntity(page, "spawned-1")).isFallback).toBe(true);
  await expect(page.getByRole("button", { name: "Select Fallback Sentinel", exact: true })).toBeVisible();
  await expect(page.getByTestId("world-status")).toContainText("Animated placeholder retained");
  await expect(page.getByTestId("entity-count")).toHaveText("7");
});

test.describe("compact touch viewport", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("keeps controls usable without overflow and supports touch orbit and pinch zoom", async ({ page }) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const name of ["Attack", "Run", "Idle", "Spawn", "Teleport"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      const bounds = await button.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button", { name: "Spawn", exact: true }).tap();
    await expect(page.getByTestId("entity-count")).toHaveText("7");
    await page.getByText("Demo controls", { exact: true }).tap();

    const beforeOrbit = (await readWorld(page)).camera.alpha;
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThanOrEqual(2);
    const browserSession = touchSessions.get(page);
    if (!browserSession) throw new Error("Multi-touch browser emulation was not configured.");
    await browserSession.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 190, y: 320 }] });
    for (let move = 1; move <= 8; move += 1) {
      await browserSession.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 190 + move * 10, y: 320 + move * 2 }] });
    }
    await browserSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => Math.abs((await readWorld(page)).camera.alpha - beforeOrbit)).toBeGreaterThan(0.02);

    const pinchCenter = await page.evaluate(() => {
      const canvas = document.querySelector("#canvas");
      if (!canvas) throw new Error("The world canvas is missing.");
      const centerX = window.innerWidth / 2;
      for (const fraction of [0.4, 0.45, 0.5, 0.55]) {
        const centerY = window.innerHeight * fraction;
        if (document.elementFromPoint(centerX - 45, centerY) === canvas
          && document.elementFromPoint(centerX + 45, centerY) === canvas) {
          return { x: centerX, y: centerY };
        }
      }
      throw new Error("No unobstructed canvas area is available for the pinch gesture.");
    });
    const beforePinch = (await readWorld(page)).camera.radius;
    await browserSession.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 0, x: pinchCenter.x - 45, y: pinchCenter.y }, { id: 1, x: pinchCenter.x + 45, y: pinchCenter.y }],
    });
    for (let move = 1; move <= 8; move += 1) {
      const fingerDistance = 45 + move * 6;
      await browserSession.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ id: 0, x: pinchCenter.x - fingerDistance, y: pinchCenter.y }, { id: 1, x: pinchCenter.x + fingerDistance, y: pinchCenter.y }],
      });
    }
    await browserSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => Math.abs((await readWorld(page)).camera.radius - beforePinch)).toBeGreaterThan(0.5);
    const afterPinch = (await readWorld(page)).camera.radius;
    expect(afterPinch).toBeGreaterThanOrEqual(10);
    expect(afterPinch).toBeLessThanOrEqual(38);
  });
});
