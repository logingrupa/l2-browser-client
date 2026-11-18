import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fixturesText from "../fixtures/environment/shared-sky-visibility-fixtures.json?raw";
import { nativeSceneMatrices, type NativeViewFrustum, type ViewPose } from "../../src/scene/world/bspVisibility/core/nativeViewFrustum";
import {
  computeSkyLevelVisibilityFrame, decodeSkyLevelVisibility, orderSkyLevelDraws, skyLevelSceneOfPose, type SkyLevelScene,
} from "../../src/scene/world/bspVisibility/core/skyLevelVisibilityFrame";
import { committedBspWalkRules } from "../../src/scene/world/bspVisibility/sharedSkyVisibilityRules";

interface OrderedDraw { readonly route: string; readonly material: string; readonly section: number | null; readonly nodeIndices: readonly number[] }
interface QueueFixture { readonly scenario: string; readonly inputSectionPerNode?: number[]; readonly expectedSectionOrder?: number[];
  readonly inputNodeOrder?: number[]; readonly expectedLabels?: string[]; readonly output: readonly { readonly section?: number; readonly nodeIndices?: number[] }[] }
interface Fixtures {
  readonly pose: { readonly cameraPosition: number[]; readonly horizontalFieldOfViewDegrees: number; readonly viewport: number[]; readonly skyLocation: number[];
    readonly skyZone: number };
  readonly frusta: readonly { readonly role: string; readonly eyeHex: string; readonly planesHex: string }[];
  readonly submittedNodes: readonly number[];
  readonly submittedSurfaceCount: number;
  readonly orderedDraws: readonly OrderedDraw[];
  readonly queueFixtures: readonly QueueFixture[];
}

const fixtures = JSON.parse(fixturesText) as Fixtures;
const stagedFolder = new URL("../fixtures/environment/skylevel-visibility/", import.meta.url);
const model = decodeSkyLevelVisibility(JSON.parse(readFileSync(new URL("visibility.json", stagedFolder), "utf8")),
  new Uint8Array(readFileSync(new URL("payload.bin", stagedFolder))));
const float32Array = (hex: string) => new Float32Array(Uint8Array.from(hex.match(/../g)!, byte => parseInt(byte, 16)).buffer);
const liveSky = fixtures.frusta.find(frustum => frustum.role === "main-sky")!;
const skyLocation = { x: fixtures.pose.skyLocation[0]!, y: fixtures.pose.skyLocation[1]!, z: fixtures.pose.skyLocation[2]! };
const liveEye = float32Array(liveSky.eyeHex);
const liveScene: SkyLevelScene = { eye: { x: liveEye[0]!, y: liveEye[1]!, z: liveEye[2]! }, frustum: { planes: float32Array(liveSky.planesHex) } as NativeViewFrustum };
const northPose: ViewPose = {
  position: { x: fixtures.pose.cameraPosition[0]!, y: fixtures.pose.cameraPosition[1]!, z: fixtures.pose.cameraPosition[2]! },
  forward: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 0, z: 1 }, horizontalFieldOfView: fixtures.pose.horizontalFieldOfViewDegrees * Math.PI / 180,
  viewportWidth: fixtures.pose.viewport[0]!, viewportHeight: fixtures.pose.viewport[1]!,
};
const bspDraws = fixtures.orderedDraws.filter(draw => draw.route !== "actor");

describe("shared SkyLevel visibility at the RM-21 20_21 north pose", () => {
  const frame = computeSkyLevelVisibilityFrame(model, liveScene, committedBspWalkRules.selector);

  it("seeds the walk with the PointRegion zone of the sky eye", () => {
    expect(frame.sceneZone).toBe(fixtures.pose.skyZone);
  });

  it("accepts the 682 submitted nodes over 255 surfaces with the native sky planes", () => {
    expect([...frame.acceptedNodes].sort((left, right) => left - right)).toEqual(fixtures.submittedNodes);
    expect(new Set([...frame.acceptedNodes].map(node => model.nodeSurface[node])).size).toBe(fixtures.submittedSurfaceCount);
  });

  it("rebuilds the 679 captured draws with the actor slot between the unsorted section flush and the sorted queue", () => {
    const rebuilt: { route: string; section: number | null; nodeIndices: number[] }[] =
      frame.draws.map(draw => ({ route: draw.route, section: draw.section, nodeIndices: [...draw.nodes] }));
    rebuilt.splice(frame.actorSlotDrawIndex, 0, { route: "actor", section: null, nodeIndices: [] });
    expect(rebuilt).toEqual(fixtures.orderedDraws.map(draw => ({ route: draw.route, section: draw.section, nodeIndices: draw.nodeIndices })));
  });

  it("merges consecutive same-material draws into the material runs the browser submits", () => {
    const materialOfNode = new Map(bspDraws.flatMap(draw => draw.nodeIndices.map(node => [node, draw.material] as const)));
    const capturedRuns = bspDraws.map(draw => draw.material).filter((material, index, all) => index === 0 || all[index - 1] !== material);
    expect(frame.runs.map(run => materialOfNode.get(run.nodes[0]!))).toEqual(capturedRuns);
    expect(frame.runs.every(run => run.nodes.every(node => materialOfNode.get(node) === materialOfNode.get(run.nodes[0]!)))).toBe(true);
    expect(frame.runs.flatMap(run => run.nodes)).toEqual(bspDraws.flatMap(draw => draw.nodeIndices));
    expect(frame.unresolvedSortingParts).toEqual([]);
  });

  it("stages an index range for every node it accepts at this pose", () => {
    expect(frame.unstagedAcceptedNodes).toEqual([]);
  });

  it("counts an accepted drawable node without a staged index range and leaves it out of the queue instead of dropping it unnamed", () => {
    const droppedNode = frame.draws[1]!.nodes[0]!, nodeRange = Int32Array.from(model.nodeRange);
    nodeRange[droppedNode] = -1;
    const reduced = computeSkyLevelVisibilityFrame({ ...model, nodeRange }, liveScene, committedBspWalkRules.selector);
    expect(reduced.unstagedAcceptedNodes).toEqual([droppedNode]);
    expect(reduced.acceptedNodes).toHaveLength(frame.acceptedNodes.length - 1);
    expect(reduced.draws.flatMap(draw => draw.nodes)).not.toContain(droppedNode);
  });

  it("builds the sky scene from the camera pose and the sky location", () => {
    const scene = skyLevelSceneOfPose(nativeSceneMatrices(northPose, committedBspWalkRules.frustum.nearClip, committedBspWalkRules.frustum.farClip),
      skyLocation, committedBspWalkRules.frustum);
    expect(scene.eye).toEqual(liveScene.eye);
    const accepted = [...computeSkyLevelVisibilityFrame(model, scene, committedBspWalkRules.selector).acceptedNodes];
    expect(accepted.sort((left, right) => left - right)).toEqual(fixtures.submittedNodes);
  });
});

describe("sky draw queue fixtures", () => {
  it("flushes unsorted sections in reverse first-encounter order with append order kept", () => {
    const fixture = fixtures.queueFixtures.find(entry => entry.scenario === "non-sorted-section-first-encounter")!;
    const draws = orderSkyLevelDraws(fixture.inputSectionPerNode!.map((_, node) => node), node => fixture.inputSectionPerNode![node]!, () => false);
    expect(draws.draws.map(draw => draw.section)).toEqual(fixture.expectedSectionOrder);
    expect(draws.draws.map(draw => [...draw.nodes])).toEqual(fixture.output.map(row => row.nodeIndices));
  });

  it("prepends every sorted BSP node, so the sorted flush is the reverse of the visit order", () => {
    const fixture = fixtures.queueFixtures.find(entry => entry.scenario === "BSP-visit-order")!;
    const draws = orderSkyLevelDraws(fixture.inputNodeOrder!, () => 0, () => true);
    expect(draws.draws.map(draw => `BSP${draw.nodes[0]}`)).toEqual(fixture.expectedLabels);
    expect(draws.actorSlotDrawIndex).toBe(0);
  });
});
