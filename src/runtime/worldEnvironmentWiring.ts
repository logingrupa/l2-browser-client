import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import { sourceDistanceToWorld } from "../world/sourceFrame";
import type { FogState } from "../materials/ue2/babylon/material";
import type { WorldEnvironmentClock, WorldEnvironmentSample } from "../scene/world/lighting/worldEnvironmentClock";
import type { NativeSection } from "../scene/world/loadNativeSection";

export type CameraFarPlaneSource = "fog-end" | "presentation";

export interface CameraFarPlane {
  readonly maxZ: number;
  readonly source: CameraFarPlaneSource;
}

export interface WorldEnvironmentOptions {
  readonly adapter: Pick<GameWorldAdapter, "subscribe">;
  readonly camera: { maxZ: number };
  readonly environmentClock: WorldEnvironmentClock | null;
  readonly cameraFog: () => FogState | null;
  readonly presentationFarPlane: number;
}

export interface WorldEnvironmentInspection {
  readonly clock: WorldEnvironmentSample | null;
  readonly farPlane: CameraFarPlane;
  readonly appliedEventCount: number;
  readonly rejectedEventCount: number;
  readonly lastRejectedEvent: string | null;
}

export interface WorldEnvironment {
  update(): void;
  inspection(): WorldEnvironmentInspection;
  release(): void;
}

const environmentClockAbsentReason = "environment-clock-absent: the loaded world has no lighting resource";
const noCameraZone = -1;

export function cameraFogOnZoneChange(section: Pick<NativeSection, "tileVisibility" | "inspection">): () => FogState | null {
  let readCameraZone: number | null = null, fog: FogState | null = null;
  return () => {
    const cameraZone = section.tileVisibility?.frame()?.cameraZone ?? noCameraZone;
    if (cameraZone === readCameraZone) return fog;
    readCameraZone = cameraZone;
    const lighting = section.inspection().lighting;
    fog = lighting !== undefined && "cameraEnvironment" in lighting ? lighting.cameraEnvironment.fog : null;
    return fog;
  };
}

export function cameraFarPlane(fog: FogState | null, presentationFarPlane: number): CameraFarPlane {
  if (fog !== null && fog.enabled && fog.fogEnd !== null) return { maxZ: sourceDistanceToWorld(fog.fogEnd), source: "fog-end" };
  return { maxZ: presentationFarPlane, source: "presentation" };
}

export function wireWorldEnvironment(options: WorldEnvironmentOptions): WorldEnvironment {
  const { adapter, camera, environmentClock, presentationFarPlane } = options;
  if (!Number.isFinite(presentationFarPlane) || presentationFarPlane <= 0) throw new RangeError("The presentation far plane must be a positive finite distance.");
  let appliedEventCount = 0, rejectedEventCount = 0, lastRejectedEvent: string | null = null;
  let farPlane: CameraFarPlane = { maxZ: presentationFarPlane, source: "presentation" };
  const unsubscribe = adapter.subscribe(event => {
    if (event.type !== "environment") return;
    if (environmentClock === null) { rejectedEventCount += 1; lastRejectedEvent = environmentClockAbsentReason; return; }
    try {
      environmentClock.applyEnvironmentEvent(event);
      appliedEventCount += 1;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      rejectedEventCount += 1; lastRejectedEvent = error.message;
    }
  });
  return {
    update() {
      farPlane = cameraFarPlane(options.cameraFog(), presentationFarPlane);
      camera.maxZ = farPlane.maxZ;
    },
    inspection: () => ({ clock: environmentClock?.sample() ?? null, farPlane, appliedEventCount, rejectedEventCount, lastRejectedEvent }),
    release: unsubscribe,
  };
}
