import { describe, expect, it } from "vitest";
import fixturesText from "../fixtures/environment/shared-sky-visibility-fixtures.json?raw";
import {
  boxCheckFlags, buildNativeViewFrustum, deprojectScreenPoint, nativeFrustumOfScene, nativeMatrixDeterminant, nativeSceneMatrices, nativeSkySceneMatrices,
  planeDistanceSse, sphereCheckFlags, type NativeViewFrustum, type ViewPose,
} from "../../src/scene/world/bspVisibility/core/nativeViewFrustum";
import { sharedSkyVisibilityRules } from "../../src/scene/world/bspVisibility/sharedSkyVisibilityRules";

interface FrustumFixture {
  readonly role: string; readonly eyeHex: string; readonly worldToCameraHex: string; readonly worldToScreenHex: string; readonly screenToWorldHex: string;
  readonly planesHex: string;
}
interface ConstructionFixture {
  readonly scenario: string; readonly eye: number[]; readonly worldToScreen: number[]; readonly screenToWorld: number[]; readonly planeCount: number;
  readonly determinant: number; readonly corners: number[][]; readonly planes: number[][];
}
interface SphereFixture {
  readonly scene: string; readonly nodeIndex: number; readonly sphereHex: string; readonly sseFlags: number;
  readonly points: readonly { readonly positionHex: string; readonly sseDistancesHex: readonly string[] }[];
}
interface Fixtures {
  readonly pose: { readonly cameraPosition: number[]; readonly horizontalFieldOfViewDegrees: number; readonly viewport: number[]; readonly skyLocation: number[] };
  readonly frusta: readonly FrustumFixture[];
  readonly constructionFixtures: readonly ConstructionFixture[];
  readonly sphereFixtures: readonly SphereFixture[];
}

const fixtures = JSON.parse(fixturesText) as Fixtures;
const float32Array = (hex: string) => new Float32Array(Uint8Array.from(hex.match(/../g)!, byte => parseInt(byte, 16)).buffer);
const hexOf = (values: Float32Array) => [...new Uint8Array(values.buffer, values.byteOffset, values.byteLength)].map(byte => byte.toString(16).padStart(2, "0")).join("");
const float32Hex = (value: number) => hexOf(Float32Array.of(value));
const frustumOf = (role: string): FrustumFixture => fixtures.frusta.find(frustum => frustum.role === role)!;
const planesOf = (role: string): NativeViewFrustum => ({ planes: float32Array(frustumOf(role).planesHex) });
const constants = sharedSkyVisibilityRules.viewFrustum;
const unreplayedMatrixNormalTolerance = 5e-4;
const { nearClip, farClip } = constants;
const northPose: ViewPose = {
  position: { x: fixtures.pose.cameraPosition[0]!, y: fixtures.pose.cameraPosition[1]!, z: fixtures.pose.cameraPosition[2]! },
  forward: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 0, z: 1 }, horizontalFieldOfView: fixtures.pose.horizontalFieldOfViewDegrees * Math.PI / 180,
  viewportWidth: fixtures.pose.viewport[0]!, viewportHeight: fixtures.pose.viewport[1]!,
};

describe("GetViewFrustum 0x10654530 in float32 stores", () => {
  it("rebuilds all four live frusta bit for bit from their scene matrices, the reflections taking the swapped winding", () => {
    for (const frustum of fixtures.frusta) {
      const built = buildNativeViewFrustum(float32Array(frustum.worldToScreenHex), float32Array(frustum.screenToWorldHex), float32Array(frustum.eyeHex),
        constants);
      expect(hexOf(built.planes), frustum.role).toBe(frustum.planesHex);
    }
    expect(nativeMatrixDeterminant(float32Array(frustumOf("reflection-sky").worldToScreenHex))).toBeLessThan(0);
  });

  it("matches the native construction fixtures in determinant, deprojected corners and side planes", () => {
    for (const fixture of fixtures.constructionFixtures.filter(entry => entry.planeCount === 4 && entry.corners.length === 4)) {
      const worldToScreen = Float32Array.from(fixture.worldToScreen), screenToWorld = Float32Array.from(fixture.screenToWorld);
      expect(float32Hex(nativeMatrixDeterminant(worldToScreen)), fixture.scenario).toBe(float32Hex(fixture.determinant));
      const corners = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, y]) => [...deprojectScreenPoint(screenToWorld, x!, y!, 0, nearClip)]);
      expect(corners, fixture.scenario).toEqual(fixture.corners);
      expect(hexOf(buildNativeViewFrustum(worldToScreen, screenToWorld, Float32Array.from(fixture.eye), constants).planes), fixture.scenario)
        .toBe(hexOf(Float32Array.from(fixture.planes.flat())));
    }
  });

  it("reproduces the SSE plane distances and sphere flags of nodes 62, 69, 63 and 71 against the root and sky planes", () => {
    for (const fixture of fixtures.sphereFixtures) {
      const frustum = planesOf(fixture.scene), sphere = float32Array(fixture.sphereHex);
      expect(sphereCheckFlags(frustum, sphere[0]!, sphere[1]!, sphere[2]!, sphere[3]!), `${fixture.scene} ${fixture.nodeIndex}`).toBe(fixture.sseFlags);
      for (const point of fixture.points) {
        const position = float32Array(point.positionHex);
        const distances = [0, 1, 2, 3].map(plane => float32Hex(planeDistanceSse(frustum, plane, position[0]!, position[1]!, position[2]!)));
        expect(distances.slice(0, point.sseDistancesHex.length)).toEqual(point.sseDistancesHex);
      }
    }
  });

  it("culls a box only when it lies wholly outside one plane", () => {
    const frustum = planesOf("main-sky"), [eyeX, eyeY, eyeZ] = float32Array(frustumOf("main-sky").eyeHex);
    expect(boxCheckFlags(frustum, Float32Array.of(eyeX! - 10, eyeY! - 1010, eyeZ! - 10, eyeX! + 10, eyeY! - 990, eyeZ! + 10)) & 1).toBe(1);
    expect(boxCheckFlags(frustum, Float32Array.of(eyeX! - 10, eyeY! + 990, eyeZ! - 10, eyeX! + 10, eyeY! + 1010, eyeZ! + 10)) & 1).toBe(0);
  });

  it("builds the north pose root and sky world-to-camera matrices of the live frame from the camera basis and the sky location", () => {
    const root = nativeSceneMatrices(northPose, nearClip, farClip);
    const skyLocation = { x: fixtures.pose.skyLocation[0]!, y: fixtures.pose.skyLocation[1]!, z: fixtures.pose.skyLocation[2]! };
    const sky = nativeSkySceneMatrices(root, skyLocation);
    for (const [built, role] of [[root, "main-root"], [sky, "main-sky"]] as const) {
      const live = float32Array(frustumOf(role).worldToCameraHex);
      built.worldToCamera.forEach((value, index) => expect(value).toBeCloseTo(live[index]!, 9));
    }
    expect(hexOf(sky.eye)).toBe(frustumOf("main-sky").eyeHex);
    const builtSky = nativeFrustumOfScene(sky, constants).planes, liveSky = planesOf("main-sky").planes;
    builtSky.forEach((value, index) => {
      if (index % 4 !== 3) expect(Math.abs(value - liveSky[index]!)).toBeLessThan(unreplayedMatrixNormalTolerance);
    });
  });
});
