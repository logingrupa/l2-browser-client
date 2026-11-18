import { afterEach, describe, expect, it, vi } from "vitest";

const constructedEngineOptions: unknown[] = [];

vi.mock("@babylonjs/core/Engines/webgpuEngine", () => {
  class RecordingWebGPUEngine {
    static readonly IsSupportedAsync = Promise.resolve(true);
    readonly name = "WebGPU";
    constructor(_canvas: unknown, options: unknown) { constructedEngineOptions.push(options); }
    async initAsync(): Promise<void> {}
    async prepareGlslangAndTintAsync(): Promise<void> {}
  }
  return { WebGPUEngine: RecordingWebGPUEngine };
});

const compilerGlobals = globalThis as typeof globalThis & { glslang?: (path: string) => Promise<unknown>; twgsl?: (path: string) => Promise<unknown> };

afterEach(() => {
  constructedEngineOptions.length = 0;
  delete compilerGlobals.glslang;
  delete compilerGlobals.twgsl;
});

describe("createWebGPUEngine", () => {
  it("asks the device for texture-compression-bc so native DXT mip chains can upload as BC textures", async () => {
    compilerGlobals.glslang = async () => ({});
    compilerGlobals.twgsl = async () => ({});
    const { createWebGPUEngine } = await import("../../src/engine/createWebGPUEngine");
    await createWebGPUEngine({ dataset: {} } as HTMLCanvasElement);
    expect(constructedEngineOptions).toHaveLength(1);
    expect(constructedEngineOptions[0]).toMatchObject({ deviceDescriptor: { requiredFeatures: ["texture-compression-bc"] } });
  });
});
