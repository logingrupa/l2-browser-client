import type { Mesh } from "@babylonjs/core/Meshes/mesh";
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
import { bindSkyDrawQueue } from "./skyDrawQueueBinding";

export interface LoadedNativeSkyVisibility {
  readonly model: SkyLevelVisibilityModel;
  readonly skyLocation: Vector3;
}

export interface NativeSkyVisibilityInspection {
  readonly sceneZone: number;
  readonly acceptedNodes: number;
  readonly acceptedSurfaces: number;
  readonly draws: number;
  readonly runs: number;
  readonly runParts: readonly number[];
  readonly orderWrites: number;
  readonly gaps: readonly string[];
}

export interface NativeSkyVisibilityDriver {
  step(): void;
  inspection(): NativeSkyVisibilityInspection | null;
}

export const skyMaterialSortingUnresolvedReason = "sky-material-requires-sorting-unresolved";
const skySnapshotLabel = "Native shared sky snapshot";
const skyVisibilityLabel = "Native shared sky visibility";

function skyLocationOf(snapshot: unknown): Vector3 {
  const position = isPlainRecord(snapshot) ? snapshot.sourceSkyZonePosition : undefined;
  if (!Array.isArray(position) || position.length !== 3 || !position.every(value => typeof value === "number" && Number.isFinite(value))) {
    throw new Error(`${skySnapshotLabel} must hold the three source coordinates of its sky zone.`);
  }
  const [x, y, z] = position as number[];
  return { x: x!, y: y!, z: z! };
}

export async function loadNativeSkyVisibility(source: NativeSharedSkySource, signal: AbortSignal): Promise<LoadedNativeSkyVisibility | null> {
  if (source.visibility === null) return null;
  const { asset, payload } = source.visibility;
  const [assetBytes, payloadBytes, snapshotBytes] = await Promise.all([
    fetchVerifiedNativeResource(asset.resource, asset.sha256, signal, asset.bytes), fetchVerifiedNativeResource(payload.resource, payload.sha256, signal, payload.bytes),
    fetchVerifiedNativeResource(source.snapshot.resource, source.snapshot.sha256, signal, source.snapshot.bytes)]);
  return { model: decodeSkyLevelVisibility(decodeNativeJsonResource(assetBytes, skyVisibilityLabel), payloadBytes),
    skyLocation: skyLocationOf(decodeNativeJsonResource(snapshotBytes, skySnapshotLabel)) };
}

function poseKey(pose: ViewPose): string {
  const { position, forward, up } = pose;
  return [position.x, position.y, position.z, forward.x, forward.y, forward.z, up.x, up.y, up.z, pose.horizontalFieldOfView, pose.viewportWidth,
    pose.viewportHeight].map(Math.fround).join(",");
}

export function driveNativeSkyVisibility(scene: Scene, meshes: readonly Mesh[], loaded: LoadedNativeSkyVisibility): NativeSkyVisibilityDriver {
  const queue = bindSkyDrawQueue(meshes, loaded.model), { frustum, selector } = committedBspWalkRules;
  let latest: SkyLevelVisibilityFrame | null = null, latestKey: string | null = null;
  return {
    step() {
      const pose = cameraViewPose(scene);
      if (pose === null) return;
      const key = poseKey(pose);
      if (key === latestKey) return;
      latestKey = key;
      const skyScene = skyLevelSceneOfPose(nativeSceneMatrices(pose, frustum.nearClip, frustum.farClip), loaded.skyLocation, frustum);
      latest = computeSkyLevelVisibilityFrame(loaded.model, skyScene, selector);
      queue.apply(latest);
    },
    inspection() {
      if (latest === null) return null;
      const accepted = [...latest.acceptedNodes];
      return { sceneZone: latest.sceneZone, acceptedNodes: accepted.length, acceptedSurfaces: new Set(accepted.map(node => loaded.model.nodeSurface[node])).size,
        draws: latest.draws.length, runs: latest.runs.length, runParts: latest.runs.map(run => run.part), orderWrites: queue.orderWrites,
        gaps: latest.unresolvedSortingParts.map(part => `${skyMaterialSortingUnresolvedReason}:${part}`) };
    },
  };
}
