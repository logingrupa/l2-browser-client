import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fixturesText from "../fixtures/environment/shared-sky-visibility-fixtures.json?raw";
import type { NativeViewFrustum } from "../../src/scene/world/bspVisibility/core/nativeViewFrustum";
import { computeSkyLevelVisibilityFrame, decodeSkyLevelVisibility } from "../../src/scene/world/bspVisibility/core/skyLevelVisibilityFrame";
import { committedBspWalkRules } from "../../src/scene/world/bspVisibility/sharedSkyVisibilityRules";
import {
  sharedSkyMatrixConstructionUnreplayedReason, sharedSkySceneZoneDiffersReason, sharedSkyVisibilityGaps,
} from "../../src/scene/world/nativeSkyVisibility";

interface Fixtures {
  readonly pose: { readonly skyZone: number };
  readonly frusta: readonly { readonly role: string; readonly eyeHex: string; readonly planesHex: string }[];
}

const fixtures = JSON.parse(fixturesText) as Fixtures;
const stagedFolder = new URL("../fixtures/environment/skylevel-visibility/", import.meta.url);
const model = decodeSkyLevelVisibility(JSON.parse(readFileSync(new URL("visibility.json", stagedFolder), "utf8")),
  new Uint8Array(readFileSync(new URL("payload.bin", stagedFolder))));
const float32Array = (hex: string) => new Float32Array(Uint8Array.from(hex.match(/../g)!, byte => parseInt(byte, 16)).buffer);
const liveSky = fixtures.frusta.find(frustum => frustum.role === "main-sky")!;
const liveEye = float32Array(liveSky.eyeHex);
const liveFrame = computeSkyLevelVisibilityFrame(model,
  { eye: { x: liveEye[0]!, y: liveEye[1]!, z: liveEye[2]! }, frustum: { planes: float32Array(liveSky.planesHex) } as NativeViewFrustum },
  committedBspWalkRules.selector);

describe("shared sky visibility gaps", () => {
  it("names the unreplayed sky matrix construction before the main view has ever selected the sky", () => {
    expect(sharedSkyVisibilityGaps(fixtures.pose.skyZone, null)).toEqual([sharedSkyMatrixConstructionUnreplayedReason]);
  });

  it("names the unreplayed sky matrix construction first on a walked sky frame", () => {
    expect(sharedSkyVisibilityGaps(fixtures.pose.skyZone, liveFrame)[0]).toBe(sharedSkyMatrixConstructionUnreplayedReason);
  });

  it("names a walked sky frame whose scene zone is not the staged sky zone", () => {
    expect(sharedSkyVisibilityGaps(liveFrame.sceneZone + 1, liveFrame)).toContain(`${sharedSkySceneZoneDiffersReason}:${liveFrame.sceneZone}`);
  });
});
