import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import type { VariableInfo } from "../../src/ui/devSheet/types";
import { createWorldRuntime, referenceWorldNotStagedStatus } from "../../src/runtime/createWorldRuntime";
import { formerlyEditorAuthoredStatusLabel } from "../../src/scene/presentationConfiguration";

const boundary = vi.hoisted(() => ({
  statuses: [] as string[],
  sheetGroups: new Map<string, { variables?: () => VariableInfo[] }>(),
  sectionIdentifiers: [] as string[],
  registryOptions: [] as { ground: (position: { x: number; y: number; z: number }) => { x: number; y: number; z: number } }[],
}));

vi.mock("../../src/scene/getWorldCanvas", () => ({ getWorldCanvas: () => ({ dataset: {} }) }));
vi.mock("../../src/camera/WorldCamera", () => ({ attachWorldCamera: () => () => undefined }));
vi.mock("../../src/entities/attachTargeting", () => ({ attachTargeting: () => () => undefined }));
vi.mock("../../src/ui/AssetImportPanel", () => ({ attachAssetImport: () => () => undefined }));
vi.mock("../../src/assets/native/nativeOrProceduralCharacter", () => ({
  loadNativeAppearanceSet: () => Promise.resolve(null), nativeOrProceduralCharacterFactory: () => () => undefined,
}));
vi.mock("../../src/world/MockWorldAdapter", () => ({
  MockWorldAdapter: class { advance(): void {} dispose(): void {} },
}));
vi.mock("../../src/entities/EntityRegistry", () => ({
  EntityRegistry: class {
    selectedEntityId = null;
    localPlayerPosition = null;
    constructor(_scene: unknown, _adapter: unknown, _labels: unknown, _status: unknown, options: (typeof boundary.registryOptions)[number]) {
      boundary.registryOptions.push(options);
    }
    snapshot(): unknown[] { return []; }
    update(): void {}
    dispose(): void {}
  },
}));
vi.mock("../../src/ui/WorldInterface", () => ({
  WorldInterface: class {
    labels = {};
    root = { querySelector: () => null };
    sheet = {
      section: (identifier: string) => {
        boundary.sectionIdentifiers.push(identifier);
        return {
          group: (groupIdentifier: string, _title: string, options: { variables?: () => VariableInfo[] }) => {
            boundary.sheetGroups.set(groupIdentifier, options);
            return { readout: () => undefined };
          },
        };
      },
    };
    showStatus(message: string): void { boundary.statuses.push(message); }
    update(): void {}
    dispose(): void {}
  },
}));

describe("default route world runtime", () => {
  let engine: NullEngine;
  let scene: Scene;
  let camera: ArcRotateCamera;
  beforeEach(() => {
    vi.stubGlobal("window", new EventTarget());
    engine = new NullEngine();
    scene = new Scene(engine);
    camera = new ArcRotateCamera("World camera", 1, 1, 26, Vector3.Zero(), scene);
    boundary.statuses.length = 0;
    boundary.sheetGroups.clear();
    boundary.sectionIdentifiers.length = 0;
    boundary.registryOptions.length = 0;
  });
  afterEach(() => {
    scene.dispose();
    engine.dispose();
    vi.unstubAllGlobals();
  });

  it("reports an unstaged reference world visibly and keeps mock actors on their own height", () => {
    const stop = createWorldRuntime(scene, camera);
    expect(boundary.statuses).toEqual([referenceWorldNotStagedStatus]);
    const snapshot = window.__worldDiagnostics!.snapshot();
    expect(snapshot.environment.mode).toBe("not-staged");
    expect(snapshot.environment.groundWidth).toBe(0);
    expect(snapshot.camera).toEqual({ alpha: 1, beta: 1, radius: 26 });
    expect(boundary.registryOptions[0]!.ground({ x: 3, y: 0, z: -2 })).toEqual({ x: 3, y: 0, z: -2 });
    stop();
    expect(window.__worldDiagnostics).toBeUndefined();
  });

  it("lists the reference scene presentation values on the World section with the formerly Editor-authored label", () => {
    const stop = createWorldRuntime(scene, camera);
    expect(boundary.sectionIdentifiers).toEqual(["world"]);
    const variables = boundary.sheetGroups.get("scene-presentation")!.variables!();
    expect(variables.length).toBeGreaterThan(0);
    expect(variables.every(variable => variable.status === "presentation")).toBe(true);
    expect(variables.every(variable => variable.source?.endsWith(formerlyEditorAuthoredStatusLabel))).toBe(true);
    expect(variables.find(variable => variable.name === "presentation.camera.radius")?.value?.()).toBe("26");
    stop();
  });
});
