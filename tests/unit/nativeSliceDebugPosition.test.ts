import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { Scene } from "@babylonjs/core/scene";
import { attachNativeSliceDebugSection } from "../../src/runtime/nativeSliceDebug";
import { defaultNativePlayerProfile } from "../../src/assets/native/loadNativePlayerProfiles";
import type { EntityRegistry } from "../../src/entities/EntityRegistry";
import type { DevSection } from "../../src/ui/devSheet/DevSheet";
import type { VariableInfo } from "../../src/ui/devSheet/types";

interface RecordedReadout { testId: string; value: () => string; variables?: () => VariableInfo[] }

function debugReadoutsFor(localPlayerPosition: { x: number; y: number; z: number } | undefined) {
  vi.stubGlobal("location", { href: "http://127.0.0.1:5173/", search: "", assign: vi.fn() });
  const readouts: RecordedReadout[] = [];
  const group = {
    readout(options: RecordedReadout) { readouts.push(options); },
    button() { return new EventTarget(); },
  };
  attachNativeSliceDebugSection({ group: () => group } as unknown as DevSection, {
    scene: {} as Scene, camera: {} as ArcRotateCamera, registry: () => ({ localPlayerPosition }) as unknown as EntityRegistry,
    playerProfile: defaultNativePlayerProfile, playerChoices: new Map([[defaultNativePlayerProfile.id, defaultNativePlayerProfile]]),
    events: new AbortController().signal,
  });
  return readouts;
}

function nativePositionVariable(readouts: RecordedReadout[]) {
  const positionReadout = readouts.find(readout => readout.testId === "native-debug-position")!;
  return positionReadout.variables!().find(variable => variable.name === "debug.position.native")!;
}

afterEach(() => vi.unstubAllGlobals());

describe("native debug fighter position", () => {
  it("reports native units as (x, z, y) * 100 through the source frame", () => {
    expect(nativePositionVariable(debugReadoutsFor({ x: 212.5, y: -30, z: 794 })).value()).toBe("21250, 79400, -3000");
  });

  it("reports unavailable when the registry has no local player", () => {
    expect(nativePositionVariable(debugReadoutsFor(undefined)).value()).toBe("unavailable");
  });
});
