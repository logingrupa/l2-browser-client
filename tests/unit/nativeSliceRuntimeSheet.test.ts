import { baseRuntimeSettings, emptyNativeCatalog, runtimeBoundaryMocks, useNativeSliceRuntimeHarness } from "../support/nativeSliceRuntimeHarness";
import { describe, expect, it } from "vitest";
import { formerlyEditorAuthoredStatusLabel } from "../../src/scene/presentationConfiguration";

describe("native slice runtime developer sheet", () => {
  const harness = useNativeSliceRuntimeHarness();
  const { stops, startRuntime } = harness;

  it("lists the received sandbox settings and the scene presentation on the sheet with their provenance label", async () => {
    stops.push(await startRuntime({ ...baseRuntimeSettings, materialEntityId: "Received actor" }, new AbortController().signal));
    const sandboxVariables = runtimeBoundaryMocks.sheetGroups.get("sandbox-settings")!.variables!();
    expect(sandboxVariables.find(variable => variable.name === "sandbox.materialEntityId")!.value()).toBe("Received actor");
    expect(sandboxVariables.some(variable => variable.name.startsWith("sandbox.fighter"))).toBe(false);
    const presentationVariables = runtimeBoundaryMocks.sheetGroups.get("scene-presentation")!.variables!();
    expect(presentationVariables.some(variable => variable.name === "presentation.fog.mode")).toBe(true);
    for (const variable of [...sandboxVariables, ...presentationVariables]) expect(variable.source?.endsWith(formerlyEditorAuthoredStatusLabel)).toBe(true);
  });

  it("starts the sandbox and reports a catalog index failure on the Sandbox tab instead of failing startup", async () => {
    runtimeBoundaryMocks.readCatalog.mockResolvedValue({ ...emptyNativeCatalog, models: [{ id: "musveren:0" }, { id: "musveren:0" }] });
    stops.push(await startRuntime(baseRuntimeSettings, new AbortController().signal));
    expect(runtimeBoundaryMocks.registries).toHaveLength(1);
    expect(runtimeBoundaryMocks.sheetGroups.has("catalog-index")).toBe(true);
  });

  it("mounts the sandbox pickers and one native window layer, and releases the layer once with the runtime", async () => {
    const stop = await startRuntime(baseRuntimeSettings, new AbortController().signal);
    for (const pickerGroupId of ["tile", "spawn", "equip", "cast", "window"]) expect(runtimeBoundaryMocks.sheetGroups.has(pickerGroupId)).toBe(true);
    expect(runtimeBoundaryMocks.sandboxWindowLayer).toHaveBeenCalledOnce();
    expect(runtimeBoundaryMocks.releaseSandboxWindowLayer).not.toHaveBeenCalled();
    stop();
    stop();
    expect(runtimeBoundaryMocks.releaseSandboxWindowLayer).toHaveBeenCalledOnce();
  });

  it("adds no catalog index note when the index builds", async () => {
    stops.push(await startRuntime(baseRuntimeSettings, new AbortController().signal));
    expect(runtimeBoundaryMocks.sheetGroups.has("catalog-index")).toBe(false);
  });
});
