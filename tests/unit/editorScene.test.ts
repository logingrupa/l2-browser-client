import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pack } from "babylonjs-editor-cli";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const projectDirectory = fileURLToPath(new URL("../../", import.meta.url));
const temporaryPrefix = "l2-editor-export-test-";
let fixtureDirectory: string | undefined;

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a serialized object.");
  }
  return value as Record<string, unknown>;
}

function objectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("Expected an array of serialized objects.");
  return value.map(objectValue);
}

function numericArray(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every((coordinate: unknown) => typeof coordinate === "number" && Number.isFinite(coordinate))) {
    throw new Error("Expected finite serialized coordinates.");
  }
  return value as number[];
}

async function readObject(path: string): Promise<Record<string, unknown>> {
  const contents: unknown = JSON.parse(await readFile(path, "utf8"));
  return objectValue(contents);
}

function requireFixtureDirectory(): string {
  if (!fixtureDirectory) throw new Error("The temporary export fixture has not been created.");
  return fixtureDirectory;
}

async function exportFixture(): Promise<Record<string, unknown>> {
  const fixture = requireFixtureDirectory();
  // The official CLI uses POSIX path joins internally, including on Windows.
  await pack(fixture.replaceAll("\\", "/"), { optimize: false });
  return readObject(join(fixture, "public/scene/example.babylon"));
}

function namedObject(value: unknown, name: string): Record<string, unknown> {
  const object = objectArray(value).find((candidate) => candidate.name === name);
  if (!object) throw new Error(`Expected serialized object ${name}.`);
  return object;
}

describe("official Editor CLI scene export", () => {
  beforeEach(async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), temporaryPrefix));
    const fixture = requireFixtureDirectory();
    await mkdir(join(fixture, "src/scripts"), { recursive: true });
    await Promise.all([
      cp(join(projectDirectory, "project.bjseditor"), join(fixture, "project.bjseditor")),
      cp(join(projectDirectory, "assets/example.scene"), join(fixture, "assets/example.scene"), { recursive: true }),
      cp(join(projectDirectory, "src/scripts/world.ts"), join(fixture, "src/scripts/world.ts")),
    ]);
  });

  afterEach(async () => {
    if (!fixtureDirectory) return;
    const resolvedFixture = resolve(fixtureDirectory);
    if (dirname(resolvedFixture) !== resolve(tmpdir()) || !basename(resolvedFixture).startsWith(temporaryPrefix)) {
      throw new Error("Refusing to remove a path outside the temporary export fixture.");
    }
    await rm(resolvedFixture, { recursive: true, force: true });
    fixtureDirectory = undefined;
  });

  it("preserves editable ground geometry, authored camera and lights, and the runtime script attachment", async () => {
    const exportedScene = await exportFixture();
    const ground = namedObject(exportedScene.meshes, "Courtyard ground");
    const positions = numericArray(ground.positions);
    const horizontalCoordinates = positions.filter((_, index) => index % 3 === 0);
    expect(positions.length).toBeGreaterThanOrEqual(12);
    expect(Math.max(...horizontalCoordinates) - Math.min(...horizontalCoordinates)).toBe(28);
    expect(numericArray(ground.indices).length).toBeGreaterThanOrEqual(6);

    const nativeCamera = await readObject(join(projectDirectory, "assets/example.scene/cameras/world-camera.json"));
    const camera = namedObject(exportedScene.cameras, "World camera");
    expect(camera.type).toBe("ArcRotateCamera");
    for (const property of ["alpha", "beta", "radius", "target", "lowerBetaLimit", "upperBetaLimit", "lowerRadiusLimit", "upperRadiusLimit"]) {
      expect(camera[property], `Authored camera ${property}`).toEqual(nativeCamera[property]);
    }
    expect(namedObject(exportedScene.lights, "Sunlight").intensity).toBe(0.65);
    expect(namedObject(exportedScene.lights, "Sky light").intensity).toBe(0.65);

    const scripts = objectArray(objectValue(exportedScene.metadata).scripts);
    expect(scripts).toContainEqual(expect.objectContaining({ enabled: true, key: "scripts/world.ts" }));
    const generatedScripts = await readFile(join(requireFixtureDirectory(), "src/scripts.ts"), "utf8");
    expect(generatedScripts).toContain('from "./scripts/world"');
    expect(generatedScripts).toContain('"scripts/world.ts": scripts_world');
  });

  it("exports a saved native light edit on repack without modifying the original environment", async () => {
    const originalLightPath = join(projectDirectory, "assets/example.scene/lights/sunlight.json");
    const originalLightText = await readFile(originalLightPath, "utf8");
    const firstExport = await exportFixture();
    expect(namedObject(firstExport.lights, "Sunlight").intensity).toBe(0.65);

    const fixtureLightPath = join(requireFixtureDirectory(), "assets/example.scene/lights/sunlight.json");
    const editedLight = await readObject(fixtureLightPath);
    editedLight.intensity = 0.42;
    await writeFile(fixtureLightPath, JSON.stringify(editedLight, null, 2), "utf8");
    const nextExport = await exportFixture();
    expect(namedObject(nextExport.lights, "Sunlight").intensity).toBe(0.42);
    expect((await readObject(fixtureLightPath)).intensity).toBe(0.42);
    expect(await readFile(originalLightPath, "utf8")).toBe(originalLightText);
    expect((await readObject(originalLightPath)).intensity).toBe(0.65);
  });
});
