import type { Scene } from "@babylonjs/core/scene";
import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import type { Vector3 } from "../../shared/math/vector3";
import { cameraViewPose } from "./bspVisibility/babylonTileVisibilityTargets";
import { nativeSceneMatrices, type ViewPose } from "./bspVisibility/core/nativeViewFrustum";
import {
  computeSkyLevelVisibilityFrame, decodeSkyLevelVisibility, skyLevelSceneOfPose, type SkyLevelVisibilityFrame, type SkyLevelVisibilityModel,
} from "./bspVisibility/core/skyLevelVisibilityFrame";
import { committedBspWalkRules } from "./bspVisibility/sharedSkyVisibilityRules";
import { decodeNativeJsonResource } from "./loadNativeSection";
import { isPlainRecord } from "./nativeManifestRecordGuards";
import type { NativeSharedSkySource } from "./nativeSharedSkySource";
import { bindSkyDrawQueue, type SkyPartMesh } from "./skyDrawQueueBinding";

interface SkySnapshotPlacement {
  readonly skyLocation: Vector3;
  readonly skyZoneIndex: number;
  readonly partSourceMaterials: readonly string[];
}

export interface LoadedNativeSkyVisibility extends SkySnapshotPlacement {
  readonly model: SkyLevelVisibilityModel;
}

export interface NativeSkyVisibilityInspection {
  readonly drawn: boolean;
  readonly sceneZone: number;
  readonly acceptedNodes: number;
  readonly acceptedSurfaces: number;
  readonly draws: number;
  readonly runs: number;
  readonly runParts: readonly number[];
  readonly orderWrites: number;
  readonly unstagedAcceptedNodes: readonly number[];
}

export interface NativeSkyVisibilityDriver {
  step(drawn: boolean): void;
  inspection(): NativeSkyVisibilityInspection | null;
  gaps(): string[];
}

export const skyMaterialSortingUnresolvedReason = "sky-material-requires-sorting-unresolved";
export const sharedSkyMatrixConstructionUnreplayedReason = "shared-sky-matrix-construction-unreplayed";
export const sharedSkySceneZoneDiffersReason = "shared-sky-scene-zone-differs";
export const sharedSkyAcceptedNodeUnstagedReason = "shared-sky-accepted-node-unstaged";
const skySnapshotLabel = "Native shared sky snapshot";
const skyVisibilityLabel = "Native shared sky visibility";

const rotationAxes = ["Pitch", "Yaw", "Roll"] as const;

function isUnrotated(rotation: unknown): boolean {
  const value = isPlainRecord(rotation) ? rotation.value : undefined;
  return value === null || (isPlainRecord(value) && rotationAxes.every(axis => value[axis] === 0));
}

function partSourceMaterialsOf(parts: unknown): string[] {
  if (!Array.isArray(parts) || !parts.every(part => isPlainRecord(part) && typeof part.sourceMaterial === "string" && part.sourceMaterial)) {
    throw new Error(`${skySnapshotLabel} must name the source material of every part.`);
  }
  return parts.map(part => (part as { sourceMaterial: string }).sourceMaterial);
}

function skySnapshotPlacementOf(snapshot: unknown): SkySnapshotPlacement {
  if (!isPlainRecord(snapshot)) throw new Error(`${skySnapshotLabel} must be a record.`);
  const position = snapshot.sourceSkyZonePosition;
  if (!Array.isArray(position) || position.length !== 3 || !position.every(value => typeof value === "number" && Number.isFinite(value))) {
    throw new Error(`${skySnapshotLabel} must hold the three source coordinates of its sky zone.`);
  }
  if (!isUnrotated(snapshot.sourceSkyZoneRotation)) {
    throw new Error(`${skySnapshotLabel} rotates its sky zone; the sky scene matrices port only an unrotated sky zone.`);
  }
  const skyZoneIndex = snapshot.skyZoneIndex;
  if (typeof skyZoneIndex !== "number" || !Number.isSafeInteger(skyZoneIndex) || skyZoneIndex < 0) throw new Error(`${skySnapshotLabel} must name its sky zone index.`);
  const [x, y, z] = position as number[];
  return { skyLocation: { x: x!, y: y!, z: z! }, skyZoneIndex, partSourceMaterials: partSourceMaterialsOf(snapshot.parts) };
}

export async function loadNativeSkyVisibility(source: NativeSharedSkySource, signal: AbortSignal): Promise<LoadedNativeSkyVisibility | null> {
  if (source.visibility === null) return null;
  const { asset, payload } = source.visibility;
  const [assetBytes, payloadBytes, snapshotBytes] = await Promise.all([
    fetchVerifiedNativeResource(asset.resource, asset.sha256, signal, asset.bytes), fetchVerifiedNativeResource(payload.resource, payload.sha256, signal, payload.bytes),
    fetchVerifiedNativeResource(source.snapshot.resource, source.snapshot.sha256, signal, source.snapshot.bytes)]);
  return { model: decodeSkyLevelVisibility(decodeNativeJsonResource(assetBytes, skyVisibilityLabel), payloadBytes),
    ...skySnapshotPlacementOf(decodeNativeJsonResource(snapshotBytes, skySnapshotLabel)) };
}

function poseKey(pose: ViewPose): string {
  const { position, forward, up } = pose;
  return [position.x, position.y, position.z, forward.x, forward.y, forward.z, up.x, up.y, up.z, pose.horizontalFieldOfView, pose.viewportWidth,
    pose.viewportHeight].map(Math.fround).join(",");
}

export function sharedSkyVisibilityGaps(skyZoneIndex: number, frame: SkyLevelVisibilityFrame | null): string[] {
  if (frame === null) return [sharedSkyMatrixConstructionUnreplayedReason];
  return [sharedSkyMatrixConstructionUnreplayedReason,
    ...(frame.sceneZone === skyZoneIndex ? [] : [`${sharedSkySceneZoneDiffersReason}:${frame.sceneZone}`]),
    ...(frame.unstagedAcceptedNodes.length === 0 ? [] : [`${sharedSkyAcceptedNodeUnstagedReason}:${frame.unstagedAcceptedNodes.length}`]),
    ...frame.unresolvedSortingParts.map(part => `${skyMaterialSortingUnresolvedReason}:${part}`)];
}

export function driveNativeSkyVisibility(scene: Scene, meshes: readonly SkyPartMesh[], loaded: LoadedNativeSkyVisibility): NativeSkyVisibilityDriver {
  const queue = bindSkyDrawQueue(meshes, loaded.partSourceMaterials, loaded.model), { frustum, selector } = committedBspWalkRules;
  let latest: SkyLevelVisibilityFrame | null = null, latestKey: string | null = null, drawnLast = false;
  return {
    step(drawn) {
      drawnLast = drawn;
      if (!drawn) { queue.hide(); return; }
      const pose = cameraViewPose(scene);
      if (pose === null) return;
      const key = poseKey(pose);
      if (key !== latestKey) {
        latestKey = key;
        const skyScene = skyLevelSceneOfPose(nativeSceneMatrices(pose, frustum.nearClip, frustum.farClip), loaded.skyLocation, frustum);
        latest = computeSkyLevelVisibilityFrame(loaded.model, skyScene, selector);
      }
      if (latest !== null) queue.apply(latest);
    },
    inspection() {
      if (latest === null) return null;
      const accepted = [...latest.acceptedNodes];
      return { drawn: drawnLast, sceneZone: latest.sceneZone, acceptedNodes: accepted.length,
        acceptedSurfaces: new Set(accepted.map(node => loaded.model.nodeSurface[node])).size, draws: latest.draws.length, runs: latest.runs.length,
        runParts: latest.runs.map(run => run.part), orderWrites: queue.orderWrites, unstagedAcceptedNodes: latest.unstagedAcceptedNodes };
    },
    gaps: () => sharedSkyVisibilityGaps(loaded.skyZoneIndex, latest),
  };
}
