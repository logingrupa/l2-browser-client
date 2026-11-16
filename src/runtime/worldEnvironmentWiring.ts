import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import { sourceDistanceToWorld } from "../world/sourceFrame";
import type { FogState } from "../materials/ue2/babylon/material";
import { inspectWorldTimeOfDay, type WorldTimeOfDay, type WorldTimeOfDayInspection } from "../scene/world/worldTimeOfDay";
import type { WorldEvent } from "../world/worldTypes";
import type { NativeSection } from "../scene/world/loadNativeSection";

export type CameraFarPlaneSource = "fog-end" | "presentation";

export interface CameraFarPlane {
  readonly maxZ: number;
  readonly source: CameraFarPlaneSource;
}

export interface WorldEnvironmentOptions {
  readonly adapter: Pick<GameWorldAdapter, "subscribe">;
  readonly camera: { maxZ: number };
  readonly timeOfDay: WorldTimeOfDay;
  readonly cameraFog: () => FogState | null;
  readonly presentationFarPlane: number;
}

export interface WorldEnvironmentInspection {
  readonly timeOfDay: WorldTimeOfDayInspection;
  readonly serverPacket: typeof serverPacketGap;
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

const serverPacketGap = { producer: "sandbox-command", status: "unresolved", reason: "server-packet-unresolved" } as const;
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

function deliverEnvironmentEvent(timeOfDay: WorldTimeOfDay, event: WorldEvent): string | null | undefined {
  if (event.type !== "server-time" && event.type !== "environment-ssq-info" && event.type !== "environment-red-sky") return undefined;
  if (timeOfDay.status === "gap") return timeOfDay.reason;
  const { manager } = timeOfDay;
  try {
    if (event.type === "server-time") manager.receiveServerTime(event.gameMinutes);
    else if (event.type === "environment-ssq-info") manager.receiveSsqInfo(event.first, event.second);
    else manager.receiveRedSky(event.timeoutSeconds);
    return null;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return error.message;
  }
}

export function wireWorldEnvironment(options: WorldEnvironmentOptions): WorldEnvironment {
  const { adapter, camera, timeOfDay, presentationFarPlane } = options;
  if (!Number.isFinite(presentationFarPlane) || presentationFarPlane <= 0) throw new RangeError("The presentation far plane must be a positive finite distance.");
  let appliedEventCount = 0, rejectedEventCount = 0, lastRejectedEvent: string | null = null;
  let farPlane: CameraFarPlane = { maxZ: presentationFarPlane, source: "presentation" };
  const unsubscribe = adapter.subscribe(event => {
    const rejection = deliverEnvironmentEvent(timeOfDay, event);
    if (rejection === undefined) return;
    if (rejection === null) { appliedEventCount += 1; return; }
    rejectedEventCount += 1;
    lastRejectedEvent = rejection;
  });
  return {
    update() {
      farPlane = cameraFarPlane(options.cameraFog(), presentationFarPlane);
      camera.maxZ = farPlane.maxZ;
    },
    inspection: () => ({ timeOfDay: inspectWorldTimeOfDay(timeOfDay), serverPacket: serverPacketGap, farPlane, appliedEventCount, rejectedEventCount, lastRejectedEvent }),
    release: unsubscribe,
  };
}
